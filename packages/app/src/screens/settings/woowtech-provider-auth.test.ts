import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { describeProviderAuth, type ProviderAuthEntry } from "./woowtech-provider-auth";

// woowtech smart: Claude's login state in the provider list (woowtech/README.md §3).

const TRADITIONAL_CHINESE = {
  available: "可用",
  needsLogin: "需要登入",
  needsLoginHint: "請在主機上執行 claude auth login，或設定 API key。",
  subscription: "已使用 Claude 訂閱登入",
  signedIn: "已登入",
  apiKey: "使用 API key（按用量計費），不是 Claude 訂閱",
  authToken: "已設定 ANTHROPIC_AUTH_TOKEN",
  oauthToken: "已設定 CLAUDE_CODE_OAUTH_TOKEN",
  configured: "已設定認證資訊",
  unknown: "無法確認登入狀態",
};

const ENGLISH = {
  available: "Available",
  needsLogin: "Login required",
  needsLoginHint: "Run claude auth login on the host, or set an API key.",
  subscription: "Signed in with a Claude subscription",
  signedIn: "Signed in",
  apiKey: "Uses an API key (billed per use), not a Claude subscription",
  authToken: "ANTHROPIC_AUTH_TOKEN is set",
  oauthToken: "CLAUDE_CODE_OAUTH_TOKEN is set",
  configured: "Credentials are set",
  unknown: "Login status unknown",
};

function ready(auth: ProviderAuthEntry["auth"]): ProviderAuthEntry {
  return { status: "ready", enabled: true, auth };
}

beforeAll(async () => {
  if (!i18n.isInitialized) await i18n.init();
});

describe.each([
  ["zh-TW", TRADITIONAL_CHINESE],
  ["en", ENGLISH],
] as const)("Claude's login state in %s", (language, copy) => {
  const t = () => i18n.getFixedT(language);

  it("asks for a login with a warning", () => {
    expect(describeProviderAuth(ready({ state: "needs_login" }), t())).toEqual({
      tone: "warning",
      label: copy.needsLogin,
      detail: copy.needsLoginHint,
    });
  });

  it.each([
    [{ state: "signed_in", method: "subscription" }, "subscription"],
    [{ state: "signed_in" }, "signedIn"],
    [{ state: "configured", method: "api_key" }, "apiKey"],
    [{ state: "configured", method: "auth_token" }, "authToken"],
    [{ state: "configured", method: "oauth_token" }, "oauthToken"],
    [{ state: "configured" }, "configured"],
    [{ state: "unknown", method: "cloud_provider" }, "unknown"],
    [{ state: "unknown", method: "api_key_helper" }, "unknown"],
    [{ state: "unknown" }, "unknown"],
  ] as const)("keeps %j available and explains it", (auth, detail) => {
    expect(describeProviderAuth(ready(auth), t())).toEqual({
      tone: "success",
      label: copy.available,
      detail: copy[detail],
    });
  });

  it("reads a state or method added later as unknown or as its state", () => {
    expect(describeProviderAuth(ready({ state: "expired" }), t())?.detail).toBe(copy.unknown);
    expect(
      describeProviderAuth(ready({ state: "configured", method: "gateway" }), t())?.detail,
    ).toBe(copy.configured);
    expect(describeProviderAuth(ready({ state: "signed_in", method: "sso" }), t())?.detail).toBe(
      copy.signedIn,
    );
  });
});

describe("entries that show no login state", () => {
  const t = () => i18n.getFixedT("zh-TW");

  it("leaves an old daemon's entry, which has none, as it was", () => {
    expect(describeProviderAuth({ status: "ready", enabled: true }, t())).toBeNull();
  });

  it.each(["loading", "error", "unavailable"])("leaves a provider that is %s alone", (status) => {
    expect(
      describeProviderAuth({ status, enabled: true, auth: { state: "needs_login" } }, t()),
    ).toBeNull();
  });

  it("leaves a disabled provider alone", () => {
    expect(
      describeProviderAuth(
        { status: "ready", enabled: false, auth: { state: "needs_login" } },
        t(),
      ),
    ).toBeNull();
  });
});
