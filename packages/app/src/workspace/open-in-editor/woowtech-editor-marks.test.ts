import { beforeAll, describe, expect, it } from "vitest";
import { EDITOR_ICON_STYLES } from "@/components/icons/woowtech-vendor-mark-styles.gen";
import { i18n } from "@/i18n/i18next";
import type { DesktopOpenTargetIcon } from "@/workspace/desktop-open-targets";
import { GENERIC_EDITOR_ICON, editorIconAlone } from "./woowtech-editor-marks";

// woowtech smart: the desktop "Open in" button (woowtech/README.md section 25). Its label names the
// editor it opens, in Microsoft's "Open in VS Code" format. The workspace header shows the button
// without its label, so the editor's icon stands alone there: Google's and Microsoft's marks may
// only appear beside their product's name, so there they give way to the generic editor icon. The
// menu beside the button names every editor, so it keeps each editor's own icon.

const IMAGE: DesktopOpenTargetIcon = {
  kind: "image",
  dataUrl: "data:image/svg+xml;base64,PHN2Zz4=",
};

describe("the desktop Open in button", () => {
  beforeAll(async () => {
    if (!i18n.isInitialized) {
      await i18n.init();
    }
  });

  it("reads Open in VS Code, and 在 VS Code 中開啟 in Traditional Chinese", () => {
    expect(i18n.t("woowtech.openInEditor.openIn", { lng: "en", target: "VS Code" })).toBe(
      "Open in VS Code",
    );
    expect(i18n.t("woowtech.openInEditor.openIn", { lng: "zh-TW", target: "VS Code" })).toBe(
      "在 VS Code 中開啟",
    );
    expect(i18n.t("woowtech.openInEditor.openIn", { lng: "ja", target: "Zed" })).toBe(
      "Open in Zed",
    );
  });

  it("draws the generic editor icon where VS Code's icon would stand alone", () => {
    expect(EDITOR_ICON_STYLES.vscode).toEqual({ color: "original", onlyBesideName: true });
    expect(editorIconAlone({ editorId: "vscode", icon: IMAGE })).toEqual(GENERIC_EDITOR_ICON);
    expect(GENERIC_EDITOR_ICON).toEqual({ kind: "symbol", name: "terminal" });
  });

  it("draws the generic editor icon for any mark that may only appear beside its name", () => {
    const styles = { "android-studio": { color: "original", onlyBesideName: true } } as const;
    expect(editorIconAlone({ editorId: "android-studio", icon: IMAGE }, styles)).toEqual(
      GENERIC_EDITOR_ICON,
    );
  });

  it("keeps Zed's own icon alone, and every badge and symbol", () => {
    expect(EDITOR_ICON_STYLES.zed).toEqual({ color: "original" });
    expect(editorIconAlone({ editorId: "zed", icon: IMAGE })).toBe(IMAGE);
    const badge: DesktopOpenTargetIcon = { kind: "badge", vendor: "android-studio" };
    expect(editorIconAlone({ editorId: "android-studio", icon: badge })).toBe(badge);
    const folder: DesktopOpenTargetIcon = { kind: "symbol", name: "folder" };
    expect(editorIconAlone({ editorId: "finder", icon: folder })).toBe(folder);
  });
});
