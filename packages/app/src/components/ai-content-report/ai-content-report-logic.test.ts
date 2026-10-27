import { describe, expect, it, vi } from "vitest";
import { reportPlatform, sendReport } from "./ai-content-report-logic";

describe("reportPlatform", () => {
  it("names the phone platforms after the OS", () => {
    expect(reportPlatform("ios", false)).toBe("ios");
    expect(reportPlatform("android", false)).toBe("android");
  });
  it("tells the desktop App (Electron) from the web app in a browser", () => {
    expect(reportPlatform("web", true)).toBe("desktop");
    expect(reportPlatform("web", false)).toBe("web");
  });
});

describe("sendReport", () => {
  it("passes the exact serialized request to an injected transport", async () => {
    const transport = vi.fn(async () => ({
      status: 201,
      body: {
        schemaVersion: 1 as const,
        receiptId: "air_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        receivedAt: "2026-10-13T12:00:00.000Z",
      },
      retryAfter: null,
    }));
    await expect(sendReport({ reportedContent: null }, transport)).resolves.toMatchObject({
      schemaVersion: 1,
    });
    expect(transport).toHaveBeenCalledWith('{"reportedContent":null}');
  });
  it("rejects HTTP success without a valid server receipt", async () => {
    await expect(
      sendReport({}, async () => ({ status: 201, body: { ok: true }, retryAfter: null })),
    ).rejects.toThrow("invalid_receipt");
  });
});
