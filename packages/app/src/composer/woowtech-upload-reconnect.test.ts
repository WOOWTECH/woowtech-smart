import { beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";
import { uploadFileAttachments, type ComposerSendClient } from "./actions";
import {
  UPLOAD_ATTEMPTS,
  uploadAcrossReconnects,
  uploadErrorMessage,
  waitForConnectedHostClient,
  type ReconnectingClient,
} from "./woowtech-upload-reconnect";

type UploadResult = Awaited<ReturnType<ComposerSendClient["uploadFile"]>>;

function connectionLost(message = "Connection changed during file upload"): Error {
  return Object.assign(new Error(message), {
    name: "DaemonConnectionError",
    code: "DAEMON_CONNECTION_LOST",
  });
}

function requestTimeout(): Error {
  return Object.assign(new Error("Timeout waiting for message (60000ms)"), {
    name: "DaemonConnectionError",
    code: "DAEMON_REQUEST_TIMEOUT",
  });
}

const uploadedFile = {
  type: "uploaded_file" as const,
  id: "upload_1",
  fileName: "測試 附件.txt",
  mimeType: "text/plain",
  size: 3,
  path: "/uploads/upload_1/測試 附件.txt",
};

function composerClient(uploadFile: ComposerSendClient["uploadFile"]): ComposerSendClient {
  return { sendAgentMessage: async () => {}, uploadFile };
}

function fakeConnection(initiallyConnected: boolean) {
  const listeners = new Set<() => void>();
  let connected = initiallyConnected;
  const client: ReconnectingClient & { connect: () => void; listeners: Set<() => void> } = {
    get isConnected() {
      return connected;
    },
    listeners,
    subscribeConnectionStatus(listener) {
      listeners.add(listener);
      listener();
      return () => {
        listeners.delete(listener);
      };
    },
    connect() {
      connected = true;
      for (const listener of listeners) listener();
    },
  };
  return client;
}

function fakeHostStore<TClient extends ReconnectingClient>(initial: TClient | null) {
  const listeners = new Set<() => void>();
  let client = initial;
  return {
    listeners,
    subscribe(_serverId: string, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => ({ client }),
    switchTo(next: TClient) {
      client = next;
      for (const listener of listeners) listener();
    },
  };
}

describe("uploads across a reconnect", () => {
  it("sends the upload again on the reconnected client after the connection is lost", async () => {
    const attempts: string[] = [];
    const result = await uploadAcrossReconnects({
      client: "before",
      reconnect: async () => "after",
      upload: async (client) => {
        attempts.push(client);
        if (client === "before") throw connectionLost();
        return "uploaded";
      },
    });

    expect(result).toBe("uploaded");
    expect(attempts).toEqual(["before", "after"]);
  });

  it.each([
    ["a daemon error", new Error("Upload size mismatch: expected 3, received 2.")],
    ["a request timeout", requestTimeout()],
  ])("does not send again after %s", async (_label, failure) => {
    const reconnect = vi.fn(async () => "after");
    let attempts = 0;
    await expect(
      uploadAcrossReconnects({
        client: "before",
        reconnect,
        upload: async () => {
          attempts += 1;
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(attempts).toBe(1);
    expect(reconnect).not.toHaveBeenCalled();
  });

  it("sends again after a socket that closed before the client noticed", async () => {
    const attempts: string[] = [];
    const result = await uploadAcrossReconnects({
      client: "before",
      reconnect: async () => "after",
      upload: async (client) => {
        attempts.push(client);
        if (client === "before") throw new Error("WebSocket not open (readyState=3)");
        return "uploaded";
      },
    });

    expect(result).toBe("uploaded");
    expect(attempts).toEqual(["before", "after"]);
  });

  it("fails with the lost connection when the host does not come back", async () => {
    const lost = connectionLost();
    await expect(
      uploadAcrossReconnects({
        client: "before",
        reconnect: async () => null,
        upload: async () => {
          throw lost;
        },
      }),
    ).rejects.toBe(lost);
  });

  it(`gives up after ${UPLOAD_ATTEMPTS} attempts`, async () => {
    let attempts = 0;
    await expect(
      uploadAcrossReconnects({
        client: "before",
        reconnect: async () => "again",
        upload: async () => {
          attempts += 1;
          throw connectionLost();
        },
      }),
    ).rejects.toThrow("Connection changed during file upload");
    expect(attempts).toBe(UPLOAD_ATTEMPTS);
  });

  it("keeps a picked file pending until the host is back, then attaches it", async () => {
    const sent: string[] = [];
    const afterReconnect = composerClient(async (file): Promise<UploadResult> => {
      sent.push(`after:${file.fileName}`);
      return { requestId: "req-2", file: uploadedFile, error: null };
    });
    const uploaded = await uploadFileAttachments({
      client: composerClient(async (file) => {
        sent.push(`before:${file.fileName}`);
        throw connectionLost("Transport not connected (status: disconnected)");
      }),
      files: [
        {
          fileName: "測試 附件.txt",
          mimeType: "text/plain",
          readBytes: async () => new Uint8Array([1, 2, 3]),
        },
      ],
      reconnect: async () => afterReconnect,
    });

    expect(sent).toEqual(["before:測試 附件.txt", "after:測試 附件.txt"]);
    expect(uploaded).toEqual([{ kind: "file", attachment: uploadedFile }]);
  });
});

describe("waiting for the host's client", () => {
  it("returns the client when it reconnects", async () => {
    const client = fakeConnection(false);
    const store = fakeHostStore(client);
    const waiting = waitForConnectedHostClient({ store, serverId: "srv", timeoutMs: 60_000 });

    client.connect();

    await expect(waiting).resolves.toBe(client);
    expect(client.listeners.size).toBe(0);
    expect(store.listeners.size).toBe(0);
  });

  it("returns the client the host switches to", async () => {
    const dropped = fakeConnection(false);
    const store = fakeHostStore(dropped);
    const waiting = waitForConnectedHostClient({ store, serverId: "srv", timeoutMs: 60_000 });
    const replacement = fakeConnection(true);

    store.switchTo(replacement);

    await expect(waiting).resolves.toBe(replacement);
    expect(dropped.listeners.size).toBe(0);
    expect(replacement.listeners.size).toBe(0);
  });

  it("returns a connected client at once", async () => {
    const client = fakeConnection(true);
    const store = fakeHostStore(client);

    await expect(
      waitForConnectedHostClient({ store, serverId: "srv", timeoutMs: 60_000 }),
    ).resolves.toBe(client);
    expect(client.listeners.size).toBe(0);
    expect(store.listeners.size).toBe(0);
  });

  it("returns null when the host is not back in time", async () => {
    const client = fakeConnection(false);
    const store = fakeHostStore(client);

    await expect(
      waitForConnectedHostClient({ store, serverId: "srv", timeoutMs: 1 }),
    ).resolves.toBeNull();
    expect(client.listeners.size).toBe(0);
    expect(store.listeners.size).toBe(0);
  });
});

describe("the upload failure message", () => {
  beforeAll(async () => {
    if (!i18n.isInitialized) {
      await i18n.init();
    }
  });

  it("says in Traditional Chinese that the connection to the host was lost", () => {
    const t = i18n.getFixedT("zh-TW");
    expect(uploadErrorMessage(connectionLost(), t)).toBe(
      "與主機的連線中斷，檔案沒有上傳。主機連回來後請再加入一次。",
    );
    expect(uploadErrorMessage(new Error("Upload size mismatch"), t)).toBe("Upload size mismatch");
  });
});
