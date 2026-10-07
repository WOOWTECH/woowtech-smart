// woowtech smart: tests for woowtech-close-reply.ts (woowtech/README.md section 11).
import { describe, expect, it, vi } from "vitest";
import { RelayDurableObject } from "./cloudflare-adapter.js";
import { answerCloseFrame } from "./woowtech-close-reply.js";

type DurableObjectStateArg = ConstructorParameters<typeof RelayDurableObject>[0];

function createSocket(attachment: unknown = null) {
  return {
    send: vi.fn(),
    close: vi.fn(),
    serializeAttachment: vi.fn(),
    deserializeAttachment: vi.fn(() => attachment),
  };
}

function createRelay(): RelayDurableObject {
  const state = { acceptWebSocket: vi.fn(), getWebSockets: vi.fn(() => []) };
  return new RelayDurableObject(state as unknown as DurableObjectStateArg);
}

describe("answering a Close frame", () => {
  it("sends the peer's code and reason back", () => {
    const ws = createSocket();
    answerCloseFrame(ws as unknown as WebSocket, 1001, "going away");
    expect(ws.close).toHaveBeenCalledWith(1001, "going away");
  });

  it("answers with 1000 when the peer's code may not be sent in a frame", () => {
    for (const code of [1004, 1005, 1006, 1015]) {
      const ws = createSocket();
      answerCloseFrame(ws as unknown as WebSocket, code, "");
      expect(ws.close).toHaveBeenCalledWith(1000, "");
    }
  });

  it("does nothing more when the socket is already closed", () => {
    const ws = createSocket();
    ws.close.mockImplementation(() => {
      throw new Error("WebSocket already closed");
    });
    expect(() => answerCloseFrame(ws as unknown as WebSocket, 1000, "")).not.toThrow();
  });
});

describe("the relay Durable Object", () => {
  it("answers the Close frame of a daemon's data socket", () => {
    const daemonData = createSocket({
      version: "2",
      role: "server",
      connectionId: "clt_a",
      serverId: "srv_test",
      createdAt: 0,
    });
    createRelay().webSocketClose(daemonData as unknown as WebSocket, 1000, "", true);
    expect(daemonData.close).toHaveBeenCalledWith(1000, "");
  });

  it("answers the Close frame of an app's socket", () => {
    const app = createSocket({
      version: "2",
      role: "client",
      connectionId: "clt_a",
      serverId: "srv_test",
      createdAt: 0,
    });
    createRelay().webSocketClose(app as unknown as WebSocket, 1005, "", true);
    expect(app.close).toHaveBeenCalledWith(1000, "");
  });

  it("answers a socket it knows nothing about", () => {
    const unknown = createSocket(null);
    createRelay().webSocketClose(unknown as unknown as WebSocket, 1000, "", true);
    expect(unknown.close).toHaveBeenCalledWith(1000, "");
  });
});
