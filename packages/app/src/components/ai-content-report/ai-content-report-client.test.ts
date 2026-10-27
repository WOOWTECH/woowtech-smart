import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The endpoint is written into the build (app.config.js extra.aiContentReportUrl).
vi.mock("expo-constants", () => ({
  default: {
    expoConfig: {
      extra: { aiContentReportUrl: "https://reports.example.invalid/v1/ai-content-reports" },
    },
  },
}));

const RECEIPT = {
  schemaVersion: 1,
  receiptId: "air_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  receivedAt: "2026-10-27T00:00:00.000Z",
};

// The first import of the client pulls in the app's platform code. It took 3-5 s on a Mac with
// nothing else running, close to the 5 s a test may run, and vitest.config.ts records that large
// imports take over 10 s on GitHub's 2-core runner. Do it under the hook timeout, as the app's other
// tests with a large import do, so the tests below only import it again after resetModules, which
// is quick.
beforeAll(async () => {
  await import("./ai-content-report-client");
}, 120_000);

/** Sends one report through the client and returns the body the transport was given. */
async function sentBody(): Promise<Record<string, unknown>> {
  // Imported per test, after resetModules: getIsElectron() keeps a true answer for good.
  const { submitAiContentReport } = await import("./ai-content-report-client");
  const bodies: string[] = [];
  const transport = async (body: string) => {
    bodies.push(body);
    return { status: 201, body: RECEIPT, retryAfter: null };
  };
  await submitAiContentReport(
    { reason: "other", locale: "zh-TW", reportedContent: null },
    { transport, generateId: () => "report-id" },
  );
  expect(bodies).toHaveLength(1);
  return JSON.parse(bodies[0]) as Record<string, unknown>;
}

describe("submitAiContentReport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("sends platform web from the web app in a browser", async () => {
    vi.stubGlobal("window", {});
    expect(await sentBody()).toEqual({
      schemaVersion: 1,
      reportId: "report-id",
      reason: "other",
      platform: "web",
      appVersion: expect.any(String),
      locale: "zh-TW",
      reportedContent: null,
    });
  });

  it("sends platform desktop from the desktop App, which has the Electron bridge", async () => {
    vi.stubGlobal("window", { paseoDesktop: {} });
    expect((await sentBody()).platform).toBe("desktop");
  });
});
