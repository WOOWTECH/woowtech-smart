import { BRAND_RELAY } from "@getpaseo/protocol/brand-relay";
import type { ConnectionOffer } from "@getpaseo/protocol/connection-offer";
import {
  normalizeHostPort,
  parseHostPort,
  shouldUseTlsForDefaultHostedRelay,
} from "@getpaseo/protocol/daemon-endpoints";
import { DEFAULT_SSH_DAEMON_PORT } from "@getpaseo/protocol/ssh-transport";
import {
  hostHasConnection,
  type HostConnection,
  type HostProfile,
  type RelayHostConnection,
} from "@/types/host-connection";
import { isBrowserRuntime, isLoopbackHostname } from "./woowtech-localhost-probe-policy";
import { formatDaemonKeyFingerprint } from "./woowtech-offer-link";

// woowtech smart (fork-owned; woowtech/README.md, 19): the question the app asks before a pairing
// link, a probe or a direct connection adds or changes a host, as upstream asks since 364e6456e
// (runtime/host-confirmation.ts there; the names and the HostConfirmations API match it so the
// upstream version can replace this one). The fork also blocks a link that would replace a saved
// host's key, asks when a probe reports the id of a saved host, and asks when a browser adds a
// direct host on another machine. host-runtime.ts imports this module, so it must not import
// host-runtime.ts back.

/** O3 (owner, 2026-10-27): false asks about a changed key instead, as upstream does. */
export const BLOCK_KEY_CHANGE = true;

interface RequestBase {
  /** Identifies this question, so an answer shown for it never answers a newer one. */
  id: number;
  serverId: string;
}

export interface NewHostRequest extends RequestBase {
  kind: "newHost";
  keyFingerprint: string;
  relayEndpoint: string;
  usesProductRelay: boolean;
}

export interface ChangedConnectionRequest extends RequestBase {
  kind: "changedConnection";
  savedLabel: string;
  savedRelayEndpoints: string[];
  keyFingerprint: string;
  relayEndpoint: string;
  usesProductRelay: boolean;
}

/** Shown, never approved: the answer is always no. */
export interface KeyChangedRequest extends RequestBase {
  kind: "keyChanged";
  savedLabel: string;
}

export interface DirectConnectionToSavedHostRequest extends RequestBase {
  kind: "directConnectionToSavedHost";
  savedLabel: string;
  endpoint: string;
}

export interface NewDirectHostRequest extends RequestBase {
  kind: "newDirectHost";
  endpoint: string;
}

export type HostConfirmationRequest =
  | NewHostRequest
  | ChangedConnectionRequest
  | KeyChangedRequest
  | DirectConnectionToSavedHostRequest
  | NewDirectHostRequest;

type WithoutId<Request> = Request extends unknown ? Omit<Request, "id"> : never;
type HostConfirmationQuestion = WithoutId<HostConfirmationRequest>;

export class HostConfirmationDeclinedError extends Error {
  override name = "HostConfirmationDeclinedError";

  constructor() {
    super("The user did not confirm this host");
  }
}

export function isHostConfirmationDeclined(error: unknown): boolean {
  return error instanceof HostConfirmationDeclinedError;
}

export interface ProbedConnectionInput {
  serverId: string;
  connection: HostConnection;
  savedHosts: HostProfile[];
  /** The app runs in a browser tab (isBrowserRuntime). */
  browser: boolean;
  /** window.location.hostname; null without a window. */
  pageHostname: string | null;
}

export interface ProbedHostInput {
  serverId: string;
  connection: HostConnection;
  savedHosts: HostProfile[];
  /** The probe's open client. */
  client: { close(): Promise<void> };
}

export interface HostConfirmationsOptions {
  blockKeyChange?: boolean;
}

interface PendingConfirmation {
  request: HostConfirmationRequest;
  resolve: (approved: boolean) => void;
}

/**
 * Owns the one host confirmation the app is waiting on. Pairing entry points ask through
 * `confirmLink`, the host runtime's probe through `confirmProbedConnection`; the sheet reads
 * `getPending` and replies with `answer`. A question waits until it is answered, whether or not
 * a sheet is showing it.
 */
export class HostConfirmations {
  private pending: PendingConfirmation | null = null;
  private nextRequestId = 1;
  private readonly listeners = new Set<() => void>();
  /** serverId|connection id pairs the user refused in this run. */
  private readonly declinedProbes = new Set<string>();
  private readonly blockKeyChange: boolean;

  constructor(options: HostConfirmationsOptions = {}) {
    this.blockKeyChange = options.blockKeyChange ?? BLOCK_KEY_CHANGE;
  }

  getPending(): HostConfirmationRequest | null {
    return this.pending?.request ?? null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Answers the request with `requestId`; an answer for any other request is ignored. */
  answer(requestId: number, approved: boolean): void {
    const current = this.pending;
    if (!current || current.request.id !== requestId) return;
    this.pending = null;
    this.emit();
    current.resolve(approved && current.request.kind !== "keyChanged");
  }

  /** Resolves true without asking when the link matches a saved host exactly. */
  confirmLink(offer: ConnectionOffer, savedHosts: HostProfile[]): Promise<boolean> {
    const connection = relayConnectionFromOffer(offer);
    const saved = savedHosts.find((host) => host.serverId === offer.serverId);
    const shown = {
      serverId: offer.serverId,
      keyFingerprint: formatDaemonKeyFingerprint(connection.daemonPublicKeyB64),
      relayEndpoint: connection.relayEndpoint,
      usesProductRelay: isProductRelay(connection),
    };
    if (!saved) return this.ask({ kind: "newHost", ...shown });
    if (hostHasConnection(saved, connection)) return Promise.resolve(true);

    const savedRelays = saved.connections.filter(isRelayConnection);
    // A relay connection's id has no key in it, so approving a new key replaces the saved key
    // with the link's: whoever holds the new key then answers as the saved host.
    const keyChanged =
      savedRelays.length > 0 &&
      savedRelays.every((relay) => relay.daemonPublicKeyB64 !== connection.daemonPublicKeyB64);
    if (keyChanged && this.blockKeyChange) {
      return this.ask({ kind: "keyChanged", serverId: offer.serverId, savedLabel: saved.label });
    }
    return this.ask({
      kind: "changedConnection",
      ...shown,
      savedLabel: saved.label,
      savedRelayEndpoints: savedRelays.map((relay) => relay.relayEndpoint),
    });
  }

  /**
   * Asks before a probe's connection joins a saved host (the daemon's reported id is all that
   * ties them) and before a browser adds a new host on another machine. A pair refused once is
   * refused again without asking for the rest of this run.
   */
  async confirmProbedConnection(input: ProbedConnectionInput): Promise<boolean> {
    const saved = input.savedHosts.find((host) => host.serverId === input.serverId);
    if (saved && hostHasConnection(saved, input.connection)) return true;
    const declinedKey = `${input.serverId}|${input.connection.id}`;
    if (this.declinedProbes.has(declinedKey)) return false;
    const question = probedConnectionQuestion(input, saved);
    if (!question) return true;
    const approved = await this.ask(question);
    if (!approved) this.declinedProbes.add(declinedKey);
    return approved;
  }

  resetForTests(): void {
    const open = this.pending;
    this.pending = null;
    this.declinedProbes.clear();
    open?.resolve(false);
    this.emit();
  }

  private ask(question: HostConfirmationQuestion): Promise<boolean> {
    // One question at a time: a newer one answers the unanswered one with no.
    this.pending?.resolve(false);
    const request: HostConfirmationRequest = { ...question, id: this.nextRequestId++ };
    return new Promise<boolean>((resolve) => {
      this.pending = { request, resolve };
      this.emit();
    });
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

/** The app's one confirmation store: the sheet at the app root shows its questions. */
export const hostConfirmations = new HostConfirmations();

function isRelayConnection(connection: HostConnection): connection is RelayHostConnection {
  return connection.type === "relay";
}

function isProductRelay(connection: RelayHostConnection): boolean {
  return connection.relayEndpoint === BRAND_RELAY.endpoint && connection.useTls === true;
}

/** The relay connection an offer saves: built exactly as HostRuntimeStore.upsertConnectionFromOffer does. */
export function relayConnectionFromOffer(offer: ConnectionOffer): RelayHostConnection {
  // COMPAT(oldRelayOfferTls): added in v0.1.73, remove after 2026-11-10 with host-runtime.ts's.
  const useTls = offer.relay.useTls ?? shouldUseTlsForDefaultHostedRelay(offer.relay.endpoint);
  const relayEndpoint = normalizeHostPort(offer.relay.endpoint);
  return {
    id: useTls ? `relay:wss:${relayEndpoint}` : `relay:${relayEndpoint}`,
    type: "relay",
    relayEndpoint,
    useTls,
    daemonPublicKeyB64: offer.daemonPublicKeyB64.trim(),
  };
}

function probedConnectionQuestion(
  input: ProbedConnectionInput,
  saved: HostProfile | undefined,
): HostConfirmationQuestion | null {
  const endpoint = describeConnection(input.connection);
  if (saved) {
    return {
      kind: "directConnectionToSavedHost",
      serverId: input.serverId,
      savedLabel: saved.label,
      endpoint,
    };
  }
  // Upstream adds new direct hosts without asking. In a browser, this site's origin can then
  // reach that daemon, so the fork asks, except for this computer and for the daemon whose own
  // page this is (its initial connection hint).
  const asksInBrowser =
    input.browser &&
    input.connection.type === "directTcp" &&
    isAnotherMachine(input.connection.endpoint, input.pageHostname);
  return asksInBrowser ? { kind: "newDirectHost", serverId: input.serverId, endpoint } : null;
}

function isAnotherMachine(endpoint: string, pageHostname: string | null): boolean {
  const { host, isIpv6 } = parseHostPort(endpoint);
  if (isLoopbackHostname(host)) return false;
  // window.location.hostname keeps an IPv6 address in brackets.
  const urlHost = isIpv6 ? `[${host}]` : host;
  return urlHost.toLowerCase() !== pageHostname?.toLowerCase();
}

function describeConnection(connection: HostConnection): string {
  switch (connection.type) {
    case "directTcp":
      return connection.useTls ? `${connection.endpoint} (TLS)` : connection.endpoint;
    case "remoteSsh": {
      const sshTarget =
        connection.sshPort === undefined
          ? connection.host
          : `${connection.host}:${connection.sshPort}`;
      return `ssh ${sshTarget} → ${connection.daemonPort ?? DEFAULT_SSH_DAEMON_PORT}`;
    }
    case "directSocket":
    case "directPipe":
      return connection.path;
    case "relay":
      return connection.relayEndpoint;
  }
}

function currentPageHostname(): string | null {
  if (typeof window === "undefined") return null;
  return window.location.hostname || null;
}

/**
 * HostRuntimeStore.probeAndUpsertConnection's hook, between learning the daemon's id and saving:
 * asks when needed; on "no" closes the probe's client and throws HostConfirmationDeclinedError.
 * The client stays open while the user decides, for the store to use after a yes.
 */
export async function confirmProbedHost(input: ProbedHostInput): Promise<void> {
  const approved = await hostConfirmations.confirmProbedConnection({
    serverId: input.serverId,
    connection: input.connection,
    savedHosts: input.savedHosts,
    browser: isBrowserRuntime(),
    pageHostname: currentPageHostname(),
  });
  if (approved) return;
  await input.client.close().catch(() => undefined);
  throw new HostConfirmationDeclinedError();
}
