import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

import { isPlatform } from "../../../../test-utils/platform.js";
import { extractNpmTarball, NpmTarballError, npmTarballEntryPath } from "./woowtech-npm-tarball.js";

// A small ustar writer, so the tests never depend on a system tar.
interface Entry {
  name: string;
  type?: string;
  data?: string | Buffer;
  mode?: number;
  prefix?: string;
  breakChecksum?: boolean;
}

function octal(header: Buffer, value: number, offset: number, length: number): void {
  header.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length, "ascii");
}

function block(entry: Entry): Buffer {
  const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? "");
  const header = Buffer.alloc(512);
  header.write(entry.name, 0, 100, "utf8");
  octal(header, entry.mode ?? 0o644, 100, 8);
  octal(header, 0, 108, 8);
  octal(header, 0, 116, 8);
  octal(header, data.length, 124, 12);
  octal(header, 0, 136, 12);
  header.fill(" ", 148, 156);
  header.write(entry.type ?? "0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  header.write(entry.prefix ?? "", 345, 155, "utf8");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(
    `${(entry.breakChecksum ? sum + 1 : sum).toString(8).padStart(6, "0")}\0 `,
    148,
    8,
    "ascii",
  );
  const padding = Buffer.alloc((512 - (data.length % 512)) % 512);
  return Buffer.concat([header, data, padding]);
}

function pax(records: Record<string, string>): Entry {
  const body = Object.entries(records)
    .map(([key, value]) => {
      const record = ` ${key}=${value}\n`;
      let length = record.length + 1;
      while (`${length}${record}`.length !== length) length += 1;
      return `${length}${record}`;
    })
    .join("");
  return { name: "PaxHeader", type: "x", data: body };
}

function tarball(entries: Entry[]): Uint8Array {
  return gzipSync(Buffer.concat([...entries.map(block), Buffer.alloc(1024)]));
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function destination(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "woowtech-tarball-"));
  tempDirs.push(dir);
  return dir;
}

function listFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"),
    )
    .sort();
}

describe("extractNpmTarball", () => {
  it("writes an npm package's directories and files under package/", async () => {
    const dest = destination();
    await extractNpmTarball({
      bytes: tarball([
        { name: "package/", type: "5", mode: 0o755 },
        { name: "package/package.json", data: '{"name":"sdk"}' },
        { name: "package/sdk.mjs", data: "export {};\n" },
        { name: "package/vendor/run.sh", data: "#!/bin/sh\n", mode: 0o755 },
      ]),
      destination: dest,
    });
    expect(listFiles(dest)).toEqual([
      "package/package.json",
      "package/sdk.mjs",
      "package/vendor/run.sh",
    ]);
    expect(readFileSync(path.join(dest, "package", "package.json"), "utf8")).toBe('{"name":"sdk"}');
  });

  it.skipIf(isPlatform("win32"))("keeps the execute bit and nothing more on POSIX", async () => {
    const dest = destination();
    await extractNpmTarball({
      bytes: tarball([
        { name: "package/run.sh", data: "#!/bin/sh\n", mode: 0o4777 },
        { name: "package/data.txt", data: "x", mode: 0o600 },
      ]),
      destination: dest,
    });
    expect(statSync(path.join(dest, "package", "run.sh")).mode & 0o7777).toBe(0o755);
    expect(statSync(path.join(dest, "package", "data.txt")).mode & 0o7777).toBe(0o644);
  });

  it("reads long names from pax headers, GNU long names and the ustar prefix", async () => {
    const dest = destination();
    const deep = `package/${"d".repeat(90)}/${"e".repeat(30)}.js`;
    await extractNpmTarball({
      bytes: tarball([
        pax({ path: deep }),
        { name: "package/truncated-pax-name", data: "pax" },
        { name: "././@LongLink", type: "L", data: `package/${"g".repeat(120)}.js\0` },
        { name: "package/truncated-gnu-name", data: "gnu" },
        { name: "file.js", prefix: `package/${"p".repeat(40)}`, data: "prefix" },
      ]),
      destination: dest,
    });
    expect(listFiles(dest)).toEqual(
      [deep, `package/${"g".repeat(120)}.js`, `package/${"p".repeat(40)}/file.js`].sort(),
    );
    expect(readFileSync(path.join(dest, ...deep.split("/")), "utf8")).toBe("pax");
  });

  it.each([
    ["a parent folder", { name: "package/../evil.js" }],
    ["an absolute path", { name: "/package/evil.js" }],
    ["a drive letter", { name: "C:/package/evil.js" }],
    ["a backslash", { name: "package\\..\\evil.js" }],
    ["a stream name", { name: "package/a.js:hidden" }],
    ["a Windows device name", { name: "package/aux.js" }],
    ["a trailing dot", { name: "package/a." }],
    ["a trailing space", { name: "package/a " }],
    ["a path outside package/", { name: "other/a.js" }],
    ["a symlink", { name: "package/link", type: "2" }],
    ["a hard link", { name: "package/link", type: "1" }],
    ["a device", { name: "package/dev", type: "3" }],
    ["a bad checksum", { name: "package/a.js", breakChecksum: true }],
  ] satisfies Array<[string, Entry]>)("refuses %s and writes nothing", async (_reason, entry) => {
    const dest = destination();
    await expect(
      extractNpmTarball({
        bytes: tarball([{ name: "package/ok.js", data: "ok" }, entry]),
        destination: dest,
      }),
    ).rejects.toThrow(NpmTarballError);
    expect(listFiles(dest)).toEqual([]);
  });

  it("refuses a truncated archive, a duplicate name and archives over the limits", async () => {
    const whole = Buffer.concat([block({ name: "package/a.js", data: "x".repeat(2000) })]);
    const cases: Array<Parameters<typeof extractNpmTarball>[0]> = [
      { bytes: gzipSync(whole.subarray(0, 1024)), destination: destination() },
      {
        bytes: tarball([
          { name: "package/a.js", data: "1" },
          { name: "package/a.js", data: "2" },
        ]),
        destination: destination(),
      },
      {
        bytes: tarball([{ name: "package/a.js", data: "x".repeat(100) }]),
        destination: destination(),
        limits: { maxUnpackedBytes: 99 },
      },
      {
        bytes: tarball([
          { name: "package/a.js", data: "1" },
          { name: "package/b.js", data: "2" },
        ]),
        destination: destination(),
        limits: { maxEntries: 1 },
      },
    ];
    for (const input of cases) {
      await expect(extractNpmTarball(input)).rejects.toThrow(NpmTarballError);
      expect(listFiles(input.destination)).toEqual([]);
    }
  });
});

describe("npmTarballEntryPath", () => {
  it("drops a leading ./ and a directory's trailing slash", () => {
    expect(npmTarballEntryPath("./package/lib/")).toBe("package/lib");
    expect(npmTarballEntryPath("package/COM10.js")).toBe("package/COM10.js");
  });

  it("refuses Windows device names with or without an extension, in any case", () => {
    for (const name of ["package/CON", "package/nul.txt", "package/Com1.js", "package/lpt9"]) {
      expect(() => npmTarballEntryPath(name)).toThrow(NpmTarballError);
    }
  });
});
