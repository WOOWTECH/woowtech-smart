import { describe, expect, it } from "vitest";
import {
  buildProtocolToastXml,
  escapeToastXml,
  shouldUseProtocolToast,
} from "./woowtech-windows-toast.js";

describe("protocol toast XML", () => {
  it("launches the agent link through the registered protocol", () => {
    expect(
      buildProtocolToastXml({
        launch: "woowtech-smart://h/srv/agent/agt",
        title: "工作完成了",
        body: "點一下查看結果。",
        iconUrl:
          "file:///C:/Users/a%20b/AppData/Local/Programs/woowtech%20smart/resources/icon.png",
        silent: false,
      }),
    ).toBe(
      '<toast activationType="protocol" launch="woowtech-smart://h/srv/agent/agt">' +
        '<visual><binding template="ToastGeneric"><text>工作完成了</text><text>點一下查看結果。</text>' +
        '<image placement="appLogoOverride" src="file:///C:/Users/a%20b/AppData/Local/Programs/woowtech%20smart/resources/icon.png"/>' +
        "</binding></visual></toast>",
    );
  });

  it("mutes the toast when sounds are off and omits missing parts", () => {
    expect(
      buildProtocolToastXml({
        launch: "woowtech-smart://h/s/agent/a",
        title: "需要你的授權",
        silent: true,
      }),
    ).toBe(
      '<toast activationType="protocol" launch="woowtech-smart://h/s/agent/a">' +
        '<visual><binding template="ToastGeneric"><text>需要你的授權</text></binding></visual>' +
        '<audio silent="true"/></toast>',
    );
  });

  it("escapes markup and drops characters XML cannot carry", () => {
    const bell = String.fromCharCode(7);
    const loneSurrogate = String.fromCharCode(0xd800);
    const nonCharacter = String.fromCharCode(0xfffe);
    expect(escapeToastXml(`a<b>&"c"'d'${bell}${loneSurrogate}${nonCharacter}e`)).toBe(
      "a&lt;b&gt;&amp;&quot;c&quot;&apos;d&apos;e",
    );
    const xml = buildProtocolToastXml({
      launch: "woowtech-smart://h/s%26x/agent/a",
      title: "<script>",
      body: "line 1\nline 2\ttab 😀",
      silent: false,
    });
    expect(xml).toContain('launch="woowtech-smart://h/s%26x/agent/a"');
    expect(xml).toContain("<text>&lt;script&gt;</text>");
    expect(xml).toContain("<text>line 1\nline 2\ttab 😀</text>");
  });
});

describe("protocol toast policy", () => {
  const base = {
    platform: "win32" as NodeJS.Platform,
    isPackaged: true,
    protocolRegistered: true,
    hasAgentTarget: true,
  };

  it("is used only for packaged Windows agent notifications with the scheme registered", () => {
    expect(shouldUseProtocolToast(base)).toBe(true);
    expect(shouldUseProtocolToast({ ...base, platform: "darwin" })).toBe(false);
    expect(shouldUseProtocolToast({ ...base, platform: "linux" })).toBe(false);
    expect(shouldUseProtocolToast({ ...base, isPackaged: false })).toBe(false);
    expect(shouldUseProtocolToast({ ...base, protocolRegistered: false })).toBe(false);
    expect(shouldUseProtocolToast({ ...base, hasAgentTarget: false })).toBe(false);
  });
});
