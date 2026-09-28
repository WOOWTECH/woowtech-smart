import { describe, expect, test } from "vitest";
import { z } from "zod";
import { CompactProviderSnapshotSchema, ProviderSnapshotEntrySchema } from "./messages.js";
import { compactProviderSnapshot, expandProviderSnapshot } from "./provider-snapshot-codec.js";
import { validateWSOutboundMessage } from "./validation/ws-outbound.js";

// woowtech smart: the display-only login state a provider snapshot entry may carry
// (woowtech/README.md §3). Old apps and old daemons are both still on the wire.

const claudeEntry = {
  provider: "claude",
  status: "ready" as const,
  enabled: true,
  label: "Claude",
  modes: [],
  defaultModeId: null,
  models: [{ provider: "claude", id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" }],
};
const signedOut = { ...claudeEntry, auth: { state: "needs_login" } };
const apiKey = { ...claudeEntry, auth: { state: "configured", method: "api_key" } };

// The entry schema of an app released before the login state existed.
const { auth: _auth, ...legacyShape } = ProviderSnapshotEntrySchema.shape;
const LegacyProviderSnapshotEntrySchema = z.object(legacyShape);

describe("provider login state on the wire", () => {
  test("a new app keeps the login state a new daemon sends", () => {
    expect(ProviderSnapshotEntrySchema.parse(signedOut)).toEqual(signedOut);
    expect(ProviderSnapshotEntrySchema.parse(apiKey)).toEqual(apiKey);
  });

  test("a new app reads an old daemon's entry, which has none", () => {
    const parsed = ProviderSnapshotEntrySchema.parse(claudeEntry);
    expect(parsed).toEqual(claudeEntry);
    expect(Object.keys(parsed)).not.toContain("auth");
  });

  test("an old app still parses a new daemon's entry and ignores the login state", () => {
    expect(LegacyProviderSnapshotEntrySchema.parse(apiKey)).toEqual(claudeEntry);
  });

  test("states and methods added later still parse", () => {
    const later = { ...claudeEntry, auth: { state: "expired", method: "gateway" } };
    expect(ProviderSnapshotEntrySchema.parse(later)).toEqual(later);
  });

  test("the compact snapshot keeps it through the schema and the codec", () => {
    const compact = CompactProviderSnapshotSchema.parse(compactProviderSnapshot([apiKey]));
    expect(expandProviderSnapshot(compact)).toEqual([apiKey]);
  });

  test("the generated validator the app runs keeps it in a snapshot update", () => {
    const envelope = {
      type: "session",
      message: {
        type: "providers_snapshot_update",
        payload: {
          entries: [signedOut],
          generatedAt: "2026-09-29T00:00:00.000Z",
        },
      },
    };
    expect(validateWSOutboundMessage(envelope)).toEqual({ success: true, data: envelope });
  });
});
