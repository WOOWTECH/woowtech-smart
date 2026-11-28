import pino from "pino";
import { expect, test } from "vitest";
import type { SessionOutboundMessage } from "../../messages.js";
import { UsageSession } from "./usage-session.js";

test("lists reports from usage sources", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const requested: Array<{ forceRefresh?: boolean; reportIds?: string[] }> = [];
  const entry = {
    id: "fixture:one",
    account: {},
    fetchedAt: "2026-01-01T00:00:00.000Z",
    sourceId: "fixture",
    sourceLabel: "Fixture",
    report: { status: "available" as const, windows: [] },
  };
  const usage = new UsageSession({
    isEnabled: () => true,
    emit: (message) => emitted.push(message),
    runtime: {
      async listUsageReports(options) {
        requested.push({ forceRefresh: options.forceRefresh, reportIds: options.reportIds });
        options.onReport?.(entry);
        return [entry];
      },
      async listLegacyUsage() {
        return { fetchedAt: "2026-01-01T00:00:00.000Z", providers: [] };
      },
    },
    logger: pino({ level: "silent" }),
  });

  await usage.handleListReports({ type: "usage.list_reports.request", requestId: "list" });
  expect(requested).toEqual([{ forceRefresh: undefined, reportIds: undefined }]);
  expect(emitted).toEqual([
    { type: "usage.list_reports.update", payload: { requestId: "list", report: entry } },
    { type: "usage.list_reports.response", payload: { requestId: "list", error: null } },
  ]);
});

test("surfaces a legacy usage-list failure as an rpc_error envelope", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const usage = new UsageSession({
    isEnabled: () => true,
    emit: (message) => emitted.push(message),
    runtime: {
      async listUsageReports() {
        return [];
      },
      async listLegacyUsage(): Promise<never> {
        throw new Error("quota service down");
      },
    },
    logger: pino({ level: "silent" }),
  });
  await usage.handleLegacyList({ type: "provider.usage.list.request", requestId: "u1" });
  expect(emitted[0]).toMatchObject({
    type: "rpc_error",
    payload: { requestId: "u1", code: "provider_usage_list_failed" },
  });
});

test("request failures terminate with an error response and no updates", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const usage = new UsageSession({
    isEnabled: () => true,
    emit: (message) => emitted.push(message),
    logger: pino({ level: "silent" }),
  });
  await usage.handleListReports({ type: "usage.list_reports.request", requestId: "failed" });
  expect(emitted).toEqual([
    {
      type: "usage.list_reports.response",
      payload: { requestId: "failed", error: "Plugin runtime is unavailable" },
    },
  ]);
});

test("off rejects both protocols before runtime discovery and turning on restores reports", async () => {
  let enabled = false;
  let calls = 0;
  const emitted: SessionOutboundMessage[] = [];
  const usage = new UsageSession({
    isEnabled: () => enabled,
    emit: (message) => emitted.push(message),
    logger: pino({ level: "silent" }),
    runtime: {
      async listUsageReports() {
        calls++;
        return [];
      },
      async listLegacyUsage() {
        calls++;
        return { fetchedAt: "now", providers: [] };
      },
    },
  });
  await usage.handleListReports({ type: "usage.list_reports.request", requestId: "off" });
  await usage.handleLegacyList({ type: "provider.usage.list.request", requestId: "old" });
  expect(calls).toBe(0);
  expect(emitted[0]).toMatchObject({ payload: { error: "Usage is off on this host." } });
  expect(emitted[1]).toMatchObject({
    type: "rpc_error",
    payload: { error: "Usage is off on this host." },
  });
  enabled = true;
  await usage.handleListReports({ type: "usage.list_reports.request", requestId: "on" });
  expect(calls).toBe(1);
  expect(emitted[2]).toMatchObject({ payload: { error: null } });
});

// COMPAT(providerUsageList): added in v0.17.4 for the v0.10.2 response shape;
// remove after 2027-05-26 once supported clients use plugin usage reports.
test("serves plugin-backed usage to a v0.10.2 client through the legacy RPC", async () => {
  const emitted: SessionOutboundMessage[] = [];
  const result = {
    fetchedAt: "2026-11-26T00:00:00.000Z",
    providers: [
      {
        providerId: "claude",
        displayName: "Claude",
        status: "available" as const,
        planLabel: "Pro",
        windows: [{ id: "session", label: "Session", usedPct: 25, remainingPct: 75 }],
      },
    ],
  };
  let legacyCalls = 0;
  const usage = new UsageSession({
    isEnabled: () => true,
    emit: (message) => emitted.push(message),
    logger: pino({ level: "silent" }),
    runtime: {
      async listUsageReports() {
        throw new Error("Legacy clients do not request streamed usage reports");
      },
      async listLegacyUsage() {
        legacyCalls++;
        return result;
      },
    },
  });
  await usage.handleLegacyList({ type: "provider.usage.list.request", requestId: "v0102" });
  expect(legacyCalls).toBe(1);
  expect(emitted).toEqual([
    {
      type: "provider.usage.list.response",
      payload: { requestId: "v0102", ...result },
    },
  ]);
});
