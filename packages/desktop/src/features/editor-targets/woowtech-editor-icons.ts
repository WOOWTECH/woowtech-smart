import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type { EditorTargetIcon } from "./target.js";

// woowtech smart: vendor logos ship only where the owner has cleared them
// (woowtech/vendor-marks.mjs, woowtech/README.md sections 22 and 25). An editor's logo ships in
// assets/editor-targets as upstream's PNG, or as the vendor's own SVG beside where the PNG was
// (Microsoft publishes the VS Code icon as SVG). An editor whose logo is not there shows its text
// badge, which the app draws from the vendor id, and Finder the folder symbol that Explorer and
// Files already use.
export async function loadEditorTargetIcon(
  fileName: string,
  file: string,
): Promise<EditorTargetIcon> {
  if (existsSync(file)) {
    const bytes = await readFile(file);
    return { kind: "image", dataUrl: `data:image/png;base64,${bytes.toString("base64")}` };
  }
  const svg = file.replace(/\.png$/, ".svg");
  if (svg !== file && existsSync(svg)) {
    const bytes = await readFile(svg);
    return { kind: "image", dataUrl: `data:image/svg+xml;base64,${bytes.toString("base64")}` };
  }
  const vendor = fileName.replace(/\.png$/, "");
  if (vendor === "finder") return { kind: "symbol", name: "folder" };
  return { kind: "badge", vendor };
}
