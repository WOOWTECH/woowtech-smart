// woowtech smart: tests for woowtech-attachment-extension.ts (woowtech/README.md section 21).
import { describe, expect, it } from "vitest";
import type { DesktopAttachmentBridge } from "./desktop-attachment-bridge";
import { createDesktopAttachmentStore } from "./desktop-attachment-store";
import { attachmentExtensionFromName } from "./woowtech-attachment-extension";

/** What the main process accepts (packages/desktop/src/features/attachments.ts EXTENSION_PATTERN). */
const MAIN_PROCESS_EXTENSION = /^\.[A-Za-z0-9]{1,16}$/;

describe("the extension of an attachment's name", () => {
  it.each([
    ["report.pdf", ".pdf"],
    ["/Users/me/Documents/report.PDF", ".PDF"],
    ["測試 附件 (final)#1.txt", ".txt"],
    ["what?.png", ".png"],
    ["100%.png", ".png"],
    ["archive.tar.gz", ".gz"],
  ])("is read from the last segment of %s", (name, extension) => {
    expect(attachmentExtensionFromName(name)).toBe(extension);
  });

  it.each([
    ["/Users/me/.config/tool/Makefile"],
    ["C:\\Users\\me\\.cfg\\README"],
    [".env"],
    ["trailing."],
    ["notes.v2-final"],
    ["image.averyveryverylongext"],
    [""],
    [null],
  ])("is empty for %s, which has none the desktop accepts", (name) => {
    expect(attachmentExtensionFromName(name)).toBe("");
  });
});

describe("a desktop attachment copied from a file", () => {
  function store() {
    const copies: { sourcePath: string; extension?: string | null }[] = [];
    const bridge = {
      copyFile: async (input: { sourcePath: string; extension?: string | null }) => {
        copies.push(input);
        return { path: `/managed/${copies.length}`, byteSize: 1 };
      },
    } as unknown as DesktopAttachmentBridge;
    return { attachments: createDesktopAttachmentStore(bridge), copies };
  }

  it("gets an extension the main process accepts when the file has none and its folder has a dot", async () => {
    const { attachments, copies } = store();
    await attachments.save({
      id: "att_1",
      mimeType: "application/octet-stream",
      source: { kind: "file_uri", uri: "file:///Users/me/.config/tool/Makefile" },
    });
    expect(copies[0]?.sourcePath).toBe("/Users/me/.config/tool/Makefile");
    expect(copies[0]?.extension).toMatch(MAIN_PROCESS_EXTENSION);
  });

  it("keeps the extension of a name with # or ?", async () => {
    const { attachments, copies } = store();
    await attachments.save({
      id: "att_2",
      mimeType: "text/plain",
      fileName: "測試 附件 (final)#1.txt",
      source: { kind: "file_uri", uri: "file:///Users/me/.local/share/a/%E6%B8%AC%E8%A9%A6.txt" },
    });
    expect(copies[0]?.extension).toBe(".txt");
  });
});
