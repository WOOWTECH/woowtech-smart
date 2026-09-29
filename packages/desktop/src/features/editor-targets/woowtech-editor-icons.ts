import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type { EditorTargetIcon } from "./target.js";

// woowtech smart: vendor logos ship only where the owner has cleared them
// (woowtech/vendor-marks.mjs, woowtech/README.md section 22). An editor's upstream logo ships
// as its PNG in assets/editor-targets; an editor whose PNG is not there shows its text badge,
// which the app draws from the vendor id, and Finder the folder symbol that Explorer and Files
// already use.
export async function loadEditorTargetIcon(
  fileName: string,
  file: string,
): Promise<EditorTargetIcon> {
  if (existsSync(file)) {
    const bytes = await readFile(file);
    return { kind: "image", dataUrl: `data:image/png;base64,${bytes.toString("base64")}` };
  }
  const vendor = fileName.replace(/\.png$/, "");
  if (vendor === "finder") return { kind: "symbol", name: "folder" };
  return { kind: "badge", vendor };
}
