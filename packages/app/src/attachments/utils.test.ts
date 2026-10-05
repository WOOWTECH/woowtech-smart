import { describe, expect, it } from "vitest";
import {
  createImageSourceCacheKey,
  createPreviewAttachmentId,
  fileUriToPath,
  localFileSourceToPath,
  parseDataUrl,
  parseImageDataUrl,
  pathToFileUri,
} from "./utils";

describe("pathToFileUri", () => {
  it("converts POSIX absolute paths to file URIs", () => {
    expect(pathToFileUri("/home/user/file.txt")).toBe("file:///home/user/file.txt");
  });

  it("converts Windows drive-letter paths to file URIs", () => {
    expect(pathToFileUri("C:\\Users\\file.txt")).toBe("file:///C:/Users/file.txt");
  });

  it("converts UNC paths to host-based file URIs", () => {
    expect(pathToFileUri("\\\\server\\share\\dir")).toBe("file://server/share/dir");
  });

  it("passes through file URIs unchanged", () => {
    expect(pathToFileUri("file:///already/uri")).toBe("file:///already/uri");
  });

  it("passes through relative paths unchanged", () => {
    expect(pathToFileUri("relative/path")).toBe("relative/path");
  });

  // woowtech smart: a name with #, ? or % stays whole for whatever parses the URI.
  it("percent-encodes the characters a URL parser would cut at or misread", () => {
    expect(pathToFileUri("/Users/a/shot#1.png")).toBe("file:///Users/a/shot%231.png");
    expect(pathToFileUri("/Users/a/what?.png")).toBe("file:///Users/a/what%3F.png");
    expect(pathToFileUri("/Users/a/100%.png")).toBe("file:///Users/a/100%25.png");
    expect(pathToFileUri("C:\\Users\\a\\shot#1.png")).toBe("file:///C:/Users/a/shot%231.png");
    expect(pathToFileUri("\\\\server\\share\\shot#1.png")).toBe("file://server/share/shot%231.png");
  });

  it("round-trips through fileUriToPath and through URL parsing", () => {
    for (const path of [
      "/Users/a/shot#1.png",
      "/Users/a/what?.png",
      "/Users/a/100%.png",
      "/Users/a/a%20b.png",
      "/Users/a/中文 檔名.png",
    ]) {
      const uri = pathToFileUri(path);
      expect(fileUriToPath(uri)).toBe(path);
      expect(decodeURIComponent(new URL(uri).pathname)).toBe(path);
    }
  });
});

describe("fileUriToPath", () => {
  it("converts Windows drive-letter file URIs back to paths", () => {
    expect(fileUriToPath("file:///C:/Users/file.txt")).toBe("C:/Users/file.txt");
  });

  it("converts host-based file URIs back to UNC paths", () => {
    expect(fileUriToPath("file://server/share/shot%231.png")).toBe("\\\\server\\share\\shot#1.png");
  });
});

describe("localFileSourceToPath", () => {
  it("decodes markdown-encoded Windows drive-letter paths", () => {
    expect(localFileSourceToPath("C:%5CUsers%5Cfile.txt")).toBe("C:/Users/file.txt");
  });

  it("preserves literal percent sequences in plain local paths", () => {
    expect(localFileSourceToPath("/tmp/image%20with%20literal%20percent.png")).toBe(
      "/tmp/image%20with%20literal%20percent.png",
    );
  });
});

describe("parseDataUrl", () => {
  it("accepts base64 data URLs with media-type parameters", () => {
    expect(parseDataUrl("data:image/png;charset=utf-8;name=preview;base64,AAECAw==")).toEqual({
      mimeType: "image/png",
      base64: "AAECAw==",
    });
  });

  it("rejects non-base64 data URLs", () => {
    expect(() => parseDataUrl("data:image/png,not-base64")).toThrow(
      "Attachment data URL is not base64 encoded.",
    );
  });
});

describe("parseImageDataUrl", () => {
  it("returns a compact cache key for image data URLs", () => {
    const dataUrl = `data:image/png;base64,${"a".repeat(512)}`;

    expect(parseImageDataUrl(dataUrl)).toMatchObject({
      mimeType: "image/png",
      base64: "a".repeat(512),
    });
    expect(createImageSourceCacheKey(dataUrl)).toMatch(/^data-image:image\/png:512:/);
    expect(createImageSourceCacheKey(dataUrl)).not.toContain("a".repeat(128));
  });

  it("ignores non-image data URLs", () => {
    expect(parseImageDataUrl("data:text/plain;base64,SGVsbG8=")).toBeNull();
  });

  it("ignores SVG data URLs", () => {
    expect(parseImageDataUrl("data:image/svg+xml;base64,PHN2ZyAvPg==")).toBeNull();
  });

  it("distinguishes image data that differs only in the middle", () => {
    const prefix = "a".repeat(64);
    const suffix = "z".repeat(64);
    const first = `data:image/png;base64,${prefix}${"b".repeat(256)}${suffix}`;
    const second = `data:image/png;base64,${prefix}${"c".repeat(256)}${suffix}`;

    expect(createImageSourceCacheKey(first)).not.toBe(createImageSourceCacheKey(second));
  });

  it("gives equal-length preview content distinct attachment identities", () => {
    expect(
      createPreviewAttachmentId({
        mimeType: "image/png",
        contentLength: 512,
        contentKey: "first-content",
      }),
    ).not.toBe(
      createPreviewAttachmentId({
        mimeType: "image/png",
        contentLength: 512,
        contentKey: "second-content",
      }),
    );
  });
});
