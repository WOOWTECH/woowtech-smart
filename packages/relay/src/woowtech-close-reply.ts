// woowtech smart (woowtech/README.md section 11): under the relay's compatibility date the runtime
// does not answer a Close frame on a hibernated WebSocket, so the peer that closed waits for its
// own timeout. Measured against relay.woowtech.io on 2026-10-07: 20 s, then 1006. A daemon that
// stops waits for its relay sockets to close, and was killed by its 10 s shutdown deadline every
// time. Answering the frame in webSocketClose completes the closing handshake at once.

/** Codes that only describe a close locally; a Close frame may not carry them (RFC 6455 7.4.1). */
const UNSENDABLE_CLOSE_CODES = new Set([1004, 1005, 1006, 1015]);

export function answerCloseFrame(ws: WebSocket, code: number, reason: string): void {
  const sendableCode = UNSENDABLE_CLOSE_CODES.has(code) ? 1000 : code;
  try {
    ws.close(sendableCode, reason);
  } catch {
    // The socket is already closed: there is nothing left to answer.
  }
}
