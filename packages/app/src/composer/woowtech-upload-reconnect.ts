// woowtech smart: an attachment upload that loses its connection is sent again once the host
// is back, instead of disappearing. On Android the daemon closes the socket while the file
// picker keeps the app in the background past its lease, so the pick lands on a reconnect.

/** Upload attempts per file, counting the first one. */
export const UPLOAD_ATTEMPTS = 3;

/** How long an interrupted upload waits for the host to come back before it fails. */
export const UPLOAD_RECONNECT_WAIT_MS = 60_000;

/**
 * The daemon client's errors for a connection that closed or changed under a request. A socket
 * the client has not seen close yet throws the transport's "WebSocket not open" on send.
 */
export function isConnectionLostError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "DaemonConnectionError") {
    return (error as Error & { code?: unknown }).code === "DAEMON_CONNECTION_LOST";
  }
  return (
    error.message.startsWith("Transport not connected") ||
    error.message.startsWith("WebSocket not open")
  );
}

/**
 * What the composer shows when an upload fails for good. A lost connection gets translated
 * text instead of the client's English message.
 */
export function uploadErrorMessage(error: unknown, t: (key: string) => string): string {
  if (isConnectionLostError(error)) {
    return t("woowtech.composer.uploadConnectionLost");
  }
  return error instanceof Error ? error.message : t("composer.errors.uploadFailed");
}

/**
 * Runs `upload`. When the connection is lost, waits for `reconnect` and runs it again on the
 * client that returns. Any other failure, or a host that does not come back, is thrown as is.
 */
export async function uploadAcrossReconnects<TClient, TResult>(input: {
  client: TClient;
  upload: (client: TClient) => Promise<TResult>;
  reconnect?: () => Promise<TClient | null>;
}): Promise<TResult> {
  let client = input.client;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await input.upload(client);
    } catch (error) {
      if (attempt >= UPLOAD_ATTEMPTS || !input.reconnect || !isConnectionLostError(error)) {
        throw error;
      }
      const reconnected = await input.reconnect();
      if (!reconnected) {
        throw error;
      }
      client = reconnected;
    }
  }
}

/** A daemon client as far as waiting for its connection goes. */
export interface ReconnectingClient {
  readonly isConnected: boolean;
  subscribeConnectionStatus(listener: () => void): () => void;
}

/** The part of the host runtime store that says which client a host uses now. */
export interface HostClientSource<TClient extends ReconnectingClient> {
  subscribe(serverId: string, listener: () => void): () => void;
  getSnapshot(serverId: string): { client: TClient | null } | null;
}

/**
 * The host's client once it is connected, or null when none is within `timeoutMs`. A client
 * reconnects by itself, and the host runtime can also switch the host to a new client.
 */
export function waitForConnectedHostClient<TClient extends ReconnectingClient>(input: {
  store: HostClientSource<TClient>;
  serverId: string;
  timeoutMs: number;
}): Promise<TClient | null> {
  let resolveResult: (client: TClient | null) => void = () => {};
  const result = new Promise<TClient | null>((resolve) => {
    resolveResult = resolve;
  });
  let settled = false;
  let watchedClient: TClient | null = null;
  let unwatchClient = (): void => {};
  let unwatchStore = (): void => {};
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const finish = (client: TClient | null): void => {
    if (settled) return;
    settled = true;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    unwatchClient();
    unwatchStore();
    resolveResult(client);
  };
  const check = (): void => {
    if (watchedClient?.isConnected) finish(watchedClient);
  };
  const watch = (): void => {
    const client = input.store.getSnapshot(input.serverId)?.client ?? null;
    if (client !== watchedClient) {
      unwatchClient();
      unwatchClient = (): void => {};
      watchedClient = client;
      // subscribeConnectionStatus reports the current state at once, which can finish here.
      const unsubscribe = client?.subscribeConnectionStatus(check);
      if (unsubscribe && settled) unsubscribe();
      else if (unsubscribe) unwatchClient = unsubscribe;
    }
    check();
  };
  unwatchStore = input.store.subscribe(input.serverId, watch);
  timeoutHandle = setTimeout(() => finish(null), input.timeoutMs);
  watch();
  return result;
}
