// woowtech smart (woowtech/README.md section 21): the desktop's main process copies an attachment to
// a file named after its extension, and refuses an extension that is not 1-16 letters or digits
// (packages/desktop/src/features/attachments.ts normalizeExtension), with an English error that
// shows the local path. Upstream took the extension from the whole source path when the file name
// had none, so a file without one inside a folder with a dot (~/.config/tool/Makefile) gave
// ".config/tool/Makefile". The extension now comes from the last path segment only, and only when
// the main process accepts it.

/** The extensions the main process accepts (normalizeExtension's EXTENSION_PATTERN). */
const ACCEPTED_EXTENSION = /^\.[A-Za-z0-9]{1,16}$/;

/** The extension of the last segment of `name` (a file name or a path), or "" when it has none the desktop accepts. */
export function attachmentExtensionFromName(name: string | null | undefined): string {
  if (!name) {
    return "";
  }
  const baseName = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = baseName.lastIndexOf(".");
  if (dot <= 0 || dot === baseName.length - 1) {
    return "";
  }
  const extension = baseName.slice(dot);
  return ACCEPTED_EXTENSION.test(extension) ? extension : "";
}
