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

/** A relay as the sheet shows it: where it is, and whether the connection to it is encrypted. */
export interface RelayShown {
  endpoint: string;
  useTls: boolean;
}

export interface NewHostRequest extends RequestBase {
  kind: "newHost";
  keyFingerprint: string;
  relayEndpoint: string;
  relayUseTls: boolean;
  usesProductRelay: boolean;
}

export interface ChangedConnectionRequest extends RequestBase {
  kind: "changedConnection";
  savedLabel: string;
  savedRelays: RelayShown[];
  keyFingerprint: string;
  relayEndpoint: string;
  relayUseTls: boolean;
  usesProductRelay: boolean;
}

/** Shown, never approved: the link's key is not the key the saved host has, or reports itself. */
export interface KeyChangedRequest extends RequestBase {
  kind: "keyChanged";
  savedLabel: string;
}

/**
 * Shown, never approved: the saved host has no key to compare the link's with, and its own daemon
 * could not give one just now.
 */
export interface KeyUnverifiedRequest extends RequestBase {
  kind: "keyUnverified";
  savedLabel: string;
}

export interface DirectConnectionToSavedHostRequest extends RequestBase {
  kind: "directConnectionToSavedHost";
  savedLabel: string;
  endpoint: string;
}

/**
 * A connection a saved host already has now comes with another host id (`serverId`). The store
 * merges by connection too, so saving would give that saved host the new id.
 */
export interface HostIdChangedRequest extends RequestBase {
  kind: "hostIdChanged";
  savedServerId: string;
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
  | KeyUnverifiedRequest
  | DirectConnectionToSavedHostRequest
  | HostIdChangedRequest
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
  /**
   * The app probes by itself (the boot probe, the configured daemon, the initial connection hint):
   * a refusal is then remembered, since these retry. What the user starts is asked every time.
   */
  background?: boolean;
  /** The app runs in a browser tab (isBrowserRuntime). */
  browser: boolean;
  /** window.location.hostname; null without a window or a location. */
  pageHostname: string | null;
}

export interface ProbedHostInput {
  serverId: string;
  connection: HostConnection;
  savedHosts: HostProfile[];
  /** The probe's open client. */
  client: { close(): Promise<void> };
  /** See ProbedConnectionInput.background. */
  background?: boolean;
}

export interface ConfirmLinkOptions {
  /**
   * The key the saved host's own daemon reports, or null when that cannot be read now. Asked only
   * for a saved host with no relay connection, which has no key of its own to compare with.
   */
  readDaemonKey?: (saved: HostProfile) => Promise<string | null>;
}

export interface HostConfirmationsOptions {
  blockKeyChange?: boolean;
}

interface Outcome {
  approved: boolean;
  /** false: a newer question took this one's place, so the user never said no. */
  answered: boolean;
}

interface PendingConfirmation {
  request: HostConfirmationRequest;
  settle: (outcome: Outcome) => void;
}

function isBlockedKind(request: HostConfirmationRequest): boolean {
  return request.kind === "keyChanged" || request.kind === "keyUnverified";
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
  /** serverId|connection id pairs the user refused to a background probe in this run. */
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
    current.settle({ approved: approved && !isBlockedKind(current.request), answered: true });
  }

  /** Resolves true without asking when the link matches a saved host exactly. */
  async confirmLink(
    offer: ConnectionOffer,
    savedHosts: HostProfile[],
    options: ConfirmLinkOptions = {},
  ): Promise<boolean> {
    const connection = relayConnectionFromOffer(offer);
    const holder = holderOfConnection(savedHosts, offer.serverId, connection);
    if (holder) return this.ask(hostIdChangedQuestion(offer.serverId, holder, connection));

    const saved = savedHosts.find((host) => host.serverId === offer.serverId);
    const shown = {
      serverId: offer.serverId,
      keyFingerprint: formatDaemonKeyFingerprint(connection.daemonPublicKeyB64),
      relayEndpoint: connection.relayEndpoint,
      relayUseTls: connection.useTls === true,
      usesProductRelay: isProductRelay(connection),
    };
    if (!saved) return this.ask({ kind: "newHost", ...shown });
    if (hostHasConnection(saved, connection)) return true;

    const savedRelays = saved.connections.filter(isRelayConnection);
    // A relay connection's id has no key in it, so approving a new key replaces the saved key
    // with the link's: whoever holds the new key then answers as the saved host.
    let key: KeyVerdict = "same";
    if (this.blockKeyChange) {
      key =
        savedRelays.length > 0
          ? keyAmongRelays(savedRelays, connection)
          : await keyOfSavedDaemon(saved, connection, options);
    }
    if (key === "different") {
      return this.ask({ kind: "keyChanged", serverId: offer.serverId, savedLabel: saved.label });
    }
    if (key === "unknown") {
      return this.ask({ kind: "keyUnverified", serverId: offer.serverId, savedLabel: saved.label });
    }
    return this.ask({
      kind: "changedConnection",
      ...shown,
      savedLabel: saved.label,
      savedRelays: savedRelays.map(relayShown),
    });
  }

  /**
   * Asks before a probe's connection joins a saved host (the daemon's reported id is all that
   * ties them), before a connection a saved host has takes another id, and before a browser adds
   * a new host on another machine. A pair refused to a background probe is refused again without
   * asking for the rest of this run; anything the user starts asks every time.
   */
  async confirmProbedConnection(input: ProbedConnectionInput): Promise<boolean> {
    const saved = input.savedHosts.find((host) => host.serverId === input.serverId);
    if (saved && hostHasConnection(saved, input.connection)) return true;
    const background = input.background === true;
    const declinedKey = `${input.serverId}|${input.connection.id}`;
    if (background && this.declinedProbes.has(declinedKey)) return false;
    const holder = holderOfConnection(input.savedHosts, input.serverId, input.connection);
    const question = holder
      ? hostIdChangedQuestion(input.serverId, holder, input.connection)
      : probedConnectionQuestion(input, saved);
    if (!question) return true;
    const outcome = await this.askForOutcome(question);
    if (!outcome.approved && outcome.answered && background) this.declinedProbes.add(declinedKey);
    return outcome.approved;
  }

  resetForTests(): void {
    const open = this.pending;
    this.pending = null;
    this.declinedProbes.clear();
    open?.settle({ approved: false, answered: false });
    this.emit();
  }

  private async ask(question: HostConfirmationQuestion): Promise<boolean> {
    return (await this.askForOutcome(question)).approved;
  }

  private askForOutcome(question: HostConfirmationQuestion): Promise<Outcome> {
    // One question at a time: a newer one answers the unanswered one with no.
    this.pending?.settle({ approved: false, answered: false });
    const request: HostConfirmationRequest = { ...question, id: this.nextRequestId++ };
    return new Promise<Outcome>((resolve) => {
      this.pending = { request, settle: resolve };
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

type KeyVerdict = "same" | "different" | "unknown";

// host-runtime.ts's isPlaceholderServerId: the stand-in id of a host whose daemon has not said who
// it is. The probe that learns the real id is meant to replace it.
const PLACEHOLDER_SERVER_ID_PREFIX = "local:";

/**
 * Saving merges by connection as well as by id, and gives the merged host the id just learned. The
 * saved host that has `connection` under another id, if any: not a placeholder, which is meant to
 * take the real id.
 */
function holderOfConnection(
  savedHosts: HostProfile[],
  serverId: string,
  connection: HostConnection,
): HostProfile | undefined {
  return savedHosts.find(
    (host) =>
      host.serverId !== serverId &&
      !host.serverId.startsWith(PLACEHOLDER_SERVER_ID_PREFIX) &&
      hostHasConnection(host, connection),
  );
}

function isRelayConnection(connection: HostConnection): connection is RelayHostConnection {
  return connection.type === "relay";
}

function relayShown(relay: RelayHostConnection): RelayShown {
  return { endpoint: relay.relayEndpoint, useTls: relay.useTls === true };
}

function isProductRelay(connection: RelayHostConnection): boolean {
  return connection.relayEndpoint === BRAND_RELAY.endpoint && connection.useTls === true;
}

/** Whether the link's key is one the saved host's relay connections already hold. */
function keyAmongRelays(savedRelays: RelayHostConnection[], link: RelayHostConnection): KeyVerdict {
  return savedRelays.some((relay) => relay.daemonPublicKeyB64 === link.daemonPublicKeyB64)
    ? "same"
    : "different";
}

/**
 * A saved host with only direct connections saved no key, so its own daemon is asked for the key
 * it uses. Nothing to ask with, or no answer, is "unknown": the link is not trusted for it.
 */
async function keyOfSavedDaemon(
  saved: HostProfile,
  link: RelayHostConnection,
  options: ConfirmLinkOptions,
): Promise<KeyVerdict> {
  let daemonKey: string | null = null;
  try {
    daemonKey = (await options.readDaemonKey?.(saved)) ?? null;
  } catch {
    daemonKey = null;
  }
  if (daemonKey === null) return "unknown";
  return daemonKey === link.daemonPublicKeyB64 ? "same" : "different";
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

function hostIdChangedQuestion(
  reportedServerId: string,
  holder: HostProfile,
  connection: HostConnection,
): HostConfirmationQuestion {
  return {
    kind: "hostIdChanged",
    serverId: reportedServerId,
    savedServerId: holder.serverId,
    savedLabel: holder.label,
    endpoint: describeConnection(connection),
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
  // React Native sets window, but a release build has no window.location.
  return window.location?.hostname || null;
}

/**
 * HostRuntimeStore.probeAndUpsertConnection's hook, between learning the daemon's id and saving:
 * asks when needed; on "no" closes the probe's client and throws HostConfirmationDeclinedError.
 * The client stays open while the user decides, for the store to use after a yes. If anything
 * here throws, the client is closed too: the probe is dropped and nothing else holds it.
 */
export async function confirmProbedHost(input: ProbedHostInput): Promise<void> {
  let approved: boolean;
  try {
    const browser = isBrowserRuntime();
    approved = await hostConfirmations.confirmProbedConnection({
      serverId: input.serverId,
      connection: input.connection,
      savedHosts: input.savedHosts,
      background: input.background,
      browser,
      pageHostname: browser ? currentPageHostname() : null,
    });
  } catch (error) {
    await input.client.close().catch(() => undefined);
    throw error;
  }
  if (approved) return;
  await input.client.close().catch(() => undefined);
  throw new HostConfirmationDeclinedError();
}
