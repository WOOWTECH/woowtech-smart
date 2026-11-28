import { expect, test, vi } from "vitest";
import { createPreferenceSync, type RemoteActions } from "./preference-sync";
import { preferencesSchema } from "../../shared/preferences-settings";

test("sends a queued edit after a successful write with an unchanged revision", async () => {
  const original = preferencesSchema.parse({});
  const next = { ...original, hoverDelaySeconds: 1.5 };
  let resolveFirst!: (value: boolean) => void;
  const first = new Promise<boolean>((resolve) => {
    resolveFirst = resolve;
  });
  const sync = createPreferenceSync({
    apply: vi.fn(),
    defaults: () => original,
    legacy: () => null,
    markMigrated: vi.fn(),
  });
  const actions: RemoteActions = {
    save: vi.fn().mockReturnValueOnce(first).mockResolvedValue(true),
    reset: vi.fn(),
    reload: vi.fn(async () => {
      sync.report({ status: "ready", values: original, revision: "r0" }, actions);
    }),
  };
  sync.report({ status: "ready", values: original, revision: "r0" }, actions);
  // The shared cached record remains at r0 for a successful no-op write.
  sync.request({ ...original });
  sync.request(next);
  resolveFirst(true);
  await vi.waitFor(() => expect(actions.save).toHaveBeenCalledTimes(2), { timeout: 1000 });
  expect(actions.save).toHaveBeenLastCalledWith(next, "r0");
});

test("resumes a later edit after a successful no-op exhausted the cached revision", async () => {
  const original = preferencesSchema.parse({});
  const sync = createPreferenceSync({
    apply: vi.fn(),
    defaults: () => original,
    legacy: () => null,
    markMigrated: vi.fn(),
  });
  const actions: RemoteActions = {
    save: vi.fn().mockResolvedValue(true),
    reset: vi.fn(),
    reload: vi.fn(async () => {
      sync.report({ status: "ready", values: original, revision: "r0" }, actions);
    }),
  };
  sync.report({ status: "ready", values: original, revision: "r0" }, actions);
  sync.request({ ...original });
  await vi.waitFor(() => expect(sync.status().pending).toBe(false));
  sync.request({ ...original, hoverDelaySeconds: 2.5 });
  await vi.waitFor(() => expect(actions.save).toHaveBeenCalledTimes(2), { timeout: 1000 });
});

test("keeps draining when another save finishes inside the revision refresh", async () => {
  const original = preferencesSchema.parse({});
  const second = { ...original, hoverDelaySeconds: 1.5 };
  const third = { ...original, hoverDelaySeconds: 2.5 };
  let resolveFirst!: (value: boolean) => void;
  const first = new Promise<boolean>((resolve) => {
    resolveFirst = resolve;
  });
  const sync = createPreferenceSync({
    apply: vi.fn(),
    defaults: () => original,
    legacy: () => null,
    markMigrated: vi.fn(),
  });
  let reads = 0;
  const actions: RemoteActions = {
    save: vi.fn().mockReturnValueOnce(first).mockResolvedValue(true),
    reset: vi.fn(),
    reload: vi.fn(async () => {
      sync.report({ status: "ready", values: original, revision: "r0" }, actions);
      if (++reads === 1) sync.request(third);
    }),
  };
  sync.report({ status: "ready", values: original, revision: "r0" }, actions);
  sync.request({ ...original });
  sync.request(second);
  resolveFirst(true);
  await vi.waitFor(() => expect(actions.save).toHaveBeenCalledTimes(3), { timeout: 1000 });
  expect(actions.save).toHaveBeenLastCalledWith(third, "r0");
});

test("waits for a new report instead of repeatedly reloading an unsuccessful read", async () => {
  const original = preferencesSchema.parse({});
  const sync = createPreferenceSync({
    apply: vi.fn(),
    defaults: () => original,
    legacy: () => null,
    markMigrated: vi.fn(),
  });
  const actions: RemoteActions = {
    save: vi.fn().mockResolvedValue(true),
    reset: vi.fn(),
    // The watcher's unsuccessful read settles without reporting any revision.
    reload: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error("offline")),
  };
  sync.report({ status: "ready", values: original, revision: "r0" }, actions);
  sync.request({ ...original });
  await vi.waitFor(() => expect(sync.status().pending).toBe(false));
  sync.request({ ...original, hoverDelaySeconds: 2.5 });
  await vi.waitFor(() => expect(actions.reload).toHaveBeenCalled());
  expect(actions.reload).toHaveBeenCalledTimes(1);
  expect(sync.status().pending).toBe(true);
  sync.report({ status: "ready", values: original, revision: "r0" }, actions);
  await vi.waitFor(() => expect(actions.save).toHaveBeenCalledTimes(2));
});
