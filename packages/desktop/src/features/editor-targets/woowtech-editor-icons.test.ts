import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadEditorTargetIcon } from "./woowtech-editor-icons.js";

/** The editor icons the desktop app ships (electron-builder packs the whole folder). */
const SHIPPED_ICONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../assets/editor-targets",
);

// woowtech smart: an editor's logo ships only once cleared, as upstream's PNG or the vendor's own
// SVG; otherwise the "Open in" menu shows its text badge (woowtech/README.md sections 22 and 25).
describe("editor target icons", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "woowtech-editor-icons-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("shows an editor's text badge when its logo does not ship", async () => {
    expect(await loadEditorTargetIcon("vscode.png", path.join(directory, "vscode.png"))).toEqual({
      kind: "badge",
      vendor: "vscode",
    });
    expect(
      await loadEditorTargetIcon("android-studio.png", path.join(directory, "android-studio.png")),
    ).toEqual({ kind: "badge", vendor: "android-studio" });
  });

  it("shows the folder symbol for Finder when its logo does not ship", async () => {
    expect(await loadEditorTargetIcon("finder.png", path.join(directory, "finder.png"))).toEqual({
      kind: "symbol",
      name: "folder",
    });
  });

  it("shows a logo that ships, as upstream does", async () => {
    const file = path.join(directory, "zed.png");
    await writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    expect(await loadEditorTargetIcon("zed.png", file)).toEqual({
      kind: "image",
      dataUrl: "data:image/png;base64,iVBORw==",
    });
  });

  // woowtech smart: a vendor's own file can take the place of upstream's PNG, such as the VS Code
  // icon Microsoft publishes as SVG, once it is cleared to show (woowtech/README.md section 25).
  it("shows the vendor's own SVG where it ships in place of upstream's PNG, byte for byte", async () => {
    const svg = '<svg viewBox="0 0 100 100"><path d="M0 0h100v100H0z" fill="#007ACC"/></svg>\n';
    await writeFile(path.join(directory, "vscode.svg"), svg);

    expect(await loadEditorTargetIcon("vscode.png", path.join(directory, "vscode.png"))).toEqual({
      kind: "image",
      dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
    });
  });

  // woowtech smart: VS Code keeps its text badge until the app shows its icon only beside "Open in
  // VS Code"; Zed's own icon ships (woowtech/README.md section 25).
  it("shows VS Code's text badge and Zed's own icon, from the icons the desktop app ships", async () => {
    expect(
      await loadEditorTargetIcon("vscode.png", path.join(SHIPPED_ICONS, "vscode.png")),
    ).toEqual({ kind: "badge", vendor: "vscode" });
    const zed = await readFile(path.join(SHIPPED_ICONS, "zed.png"));
    expect(await loadEditorTargetIcon("zed.png", path.join(SHIPPED_ICONS, "zed.png"))).toEqual({
      kind: "image",
      dataUrl: `data:image/png;base64,${zed.toString("base64")}`,
    });
  });

  it("prefers upstream's PNG when both ship", async () => {
    await writeFile(path.join(directory, "zed.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(path.join(directory, "zed.svg"), "<svg/>");

    expect(await loadEditorTargetIcon("zed.png", path.join(directory, "zed.png"))).toEqual({
      kind: "image",
      dataUrl: "data:image/png;base64,iVBORw==",
    });
  });
});
