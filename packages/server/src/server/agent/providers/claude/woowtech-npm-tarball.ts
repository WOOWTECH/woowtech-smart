// woowtech smart: unpacks the Claude Agent SDK's npm tarball in JS (woowtech/README.md §3, plan
// G15). Running the `tar` on PATH failed on Windows when it was Git's GNU tar, which reads C:\…
// as host:path, and Windows' bsdtar takes ANSI arguments. The tarball's sha512 is checked before
// this runs; the checks here are defense in depth: regular files and folders only, every path
// inside package/, nothing a Windows path could reinterpret, size and count limits, and the whole
// archive validated before the first byte is written.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";

export class NpmTarballError extends Error {
  constructor(public readonly reason: string) {
    super(`Refused the npm tarball: ${reason}`);
    this.name = "NpmTarballError";
  }
}

export interface NpmTarballLimits {
  /** File bytes after unpacking; the SDK needs about 5 MB. */
  maxUnpackedBytes: number;
  maxEntries: number;
}

const DEFAULT_LIMITS: NpmTarballLimits = {
  maxUnpackedBytes: 64 * 1024 * 1024,
  maxEntries: 10_000,
};

export interface NpmTarballExtraction {
  bytes: Uint8Array;
  /** An empty folder; the archive's package/ lands inside it. */
  destination: string;
  platform?: NodeJS.Platform;
  limits?: Partial<NpmTarballLimits>;
}

interface TarEntry {
  path: string;
  kind: "file" | "directory";
  mode: number;
  data: Buffer;
}

const BLOCK = 512;
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Validates one entry name and returns the relative POSIX path it may be written to. */
export function npmTarballEntryPath(rawName: string): string {
  const name = rawName.replace(/^(\.\/)+/, "").replace(/\/+$/, "");
  if (name === "" || name.includes("\0") || name.includes("\\") || name.includes(":")) {
    throw new NpmTarballError(`unsafe entry name ${JSON.stringify(rawName)}`);
  }
  const segments = name.split("/");
  for (const segment of segments) {
    if (
      segment === "" ||
      segment === "." ||
      segment === ".." ||
      /[. ]$/.test(segment) ||
      WINDOWS_DEVICE.test(segment)
    ) {
      throw new NpmTarballError(`unsafe entry name ${JSON.stringify(rawName)}`);
    }
  }
  if (segments[0] !== "package") {
    throw new NpmTarballError(`entry outside package/: ${JSON.stringify(rawName)}`);
  }
  return name;
}

function readString(header: Buffer, offset: number, length: number): string {
  const field = header.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
}

function readOctal(header: Buffer, offset: number, length: number): number {
  const text = readString(header, offset, length).trim();
  if (!/^[0-7]+$/.test(text)) {
    throw new NpmTarballError("a header field is not an octal number");
  }
  return Number.parseInt(text, 8);
}

function verifyChecksum(header: Buffer): void {
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) {
    sum += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (sum !== readOctal(header, 148, 8)) {
    throw new NpmTarballError("a header checksum does not match");
  }
}

function parsePax(data: Buffer): Map<string, string> {
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    const length = Number.parseInt(data.subarray(offset, space).toString("ascii"), 10);
    if (
      space === -1 ||
      !Number.isSafeInteger(length) ||
      length <= 0 ||
      offset + length > data.length
    ) {
      throw new NpmTarballError("a pax header is malformed");
    }
    const record = data.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals === -1) {
      throw new NpmTarballError("a pax header is malformed");
    }
    records.set(record.slice(0, equals), record.slice(equals + 1));
    offset += length;
  }
  return records;
}

function isEndBlock(header: Buffer): boolean {
  return header.every((byte) => byte === 0);
}

interface TarBlock {
  header: Buffer;
  type: string;
  data: Buffer;
  next: number;
}

function readBlock(tar: Buffer, offset: number, pax: Map<string, string>): TarBlock {
  const header = tar.subarray(offset, offset + BLOCK);
  verifyChecksum(header);
  const size = pax.has("size") ? Number(pax.get("size")) : readOctal(header, 124, 12);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new NpmTarballError("an entry size is invalid");
  }
  const dataStart = offset + BLOCK;
  if (dataStart + size > tar.length) {
    throw new NpmTarballError("the archive is truncated");
  }
  return {
    header,
    type: String.fromCharCode(header[156] || 0x30),
    data: tar.subarray(dataStart, dataStart + size),
    next: dataStart + Math.ceil(size / BLOCK) * BLOCK,
  };
}

function cString(data: Buffer): string {
  const end = data.indexOf(0);
  return data.subarray(0, end === -1 ? data.length : end).toString("utf8");
}

function headerName(header: Buffer): string {
  const ustar = readString(header, 257, 6) === "ustar" && readString(header, 263, 2) === "00";
  const prefix = ustar ? readString(header, 345, 155) : "";
  const name = readString(header, 0, 100);
  return prefix ? `${prefix}/${name}` : name;
}

function entryKind(type: string, name: string): TarEntry["kind"] {
  if (type === "0" || type === "7") return "file";
  if (type === "5") return "directory";
  throw new NpmTarballError(`unsupported entry type ${JSON.stringify(type)} for ${name}`);
}

interface ParsedArchive {
  entries: TarEntry[];
  seen: Set<string>;
  unpackedBytes: number;
}

function addEntry(archive: ParsedArchive, entry: TarEntry, limits: NpmTarballLimits): void {
  const key = entry.path.toLowerCase();
  if (entry.kind === "file" && archive.seen.has(key)) {
    throw new NpmTarballError(`duplicate entry ${entry.path}`);
  }
  archive.seen.add(key);
  archive.unpackedBytes += entry.kind === "file" ? entry.data.length : 0;
  if (
    archive.entries.length + 1 > limits.maxEntries ||
    archive.unpackedBytes > limits.maxUnpackedBytes
  ) {
    throw new NpmTarballError("the archive exceeds the size or entry limit");
  }
  archive.entries.push(entry);
}

function parseEntries(tar: Buffer, limits: NpmTarballLimits): TarEntry[] {
  const archive: ParsedArchive = { entries: [], seen: new Set(), unpackedBytes: 0 };
  let longName: string | null = null;
  let pax = new Map<string, string>();
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    if (isEndBlock(tar.subarray(offset, offset + BLOCK))) {
      return archive.entries;
    }
    const block = readBlock(tar, offset, pax);
    offset = block.next;
    if (block.type === "x") {
      pax = parsePax(block.data);
    } else if (block.type === "L") {
      longName = cString(block.data);
    } else if (block.type !== "g") {
      const rawName = pax.get("path") ?? longName ?? headerName(block.header);
      longName = null;
      pax = new Map();
      const kind = entryKind(block.type, rawName);
      const entryPath = npmTarballEntryPath(rawName);
      const mode = readOctal(block.header, 100, 8);
      addEntry(archive, { path: entryPath, kind, mode, data: block.data }, limits);
    }
  }
  throw new NpmTarballError("the archive is truncated");
}

export async function extractNpmTarball(input: NpmTarballExtraction): Promise<void> {
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  const platform = input.platform ?? process.platform;
  let tar: Buffer;
  try {
    // Headers and padding add to the file bytes; this bounds a decompression bomb.
    tar = gunzipSync(input.bytes, { maxOutputLength: limits.maxUnpackedBytes + 64 * 1024 * 1024 });
  } catch (error) {
    throw new NpmTarballError(`the archive does not unpack (${(error as Error).message})`);
  }
  const entries = parseEntries(tar, limits);
  for (const entry of entries) {
    const target = path.join(input.destination, ...entry.path.split("/"));
    if (entry.kind === "directory") {
      await mkdir(target, { recursive: true });
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    // wx never writes through a file or link that is already there.
    await writeFile(target, entry.data, {
      flag: "wx",
      ...(platform === "win32" ? {} : { mode: entry.mode & 0o111 ? 0o755 : 0o644 }),
    });
  }
}
