import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadEditorTargetIcon } from "./woowtech-editor-icons.js";

// woowtech smart: an editor's logo ships only as a cleared PNG; otherwise the "Open in" menu
// shows its text badge (woowtech/README.md section 22).
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
});
