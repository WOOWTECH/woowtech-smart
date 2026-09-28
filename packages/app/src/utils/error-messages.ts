import { i18n } from "@/i18n/i18next";

/**
 * woowtech smart: a request that failed because the host connection is down. The daemon client
 * says so in English ("Transport not connected (status: disconnected)"), which the app showed as is.
 */
export function isHostConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.message.startsWith("Transport not connected")) return true;
  if (error.message.startsWith("WebSocket not open")) return true;
  return (
    error.name === "DaemonConnectionError" &&
    (error as Error & { code?: unknown }).code === "DAEMON_CONNECTION_LOST"
  );
}

export function toErrorMessage(error: unknown): string {
  if (isHostConnectionError(error)) {
    return i18n.t("workspace.terminal.hostDisconnected");
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
