import { promisify } from "node:util";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  createClaudeAgentSdkSource,
  loadClaudeAgentSdk,
  type ClaudeAgentSdkModule,
} from "./claude-agent-sdk-runtime.js";

let root: string;
const prefix = "claude-agent-sdk-0.3.246";
const missingLocal = async (): Promise<ClaudeAgentSdkModule> => {
  throw Object.assign(new Error("fixture missing"), { code: "ERR_MODULE_NOT_FOUND" });
};
beforeEach(async () => {
  await mkdir(path.resolve(".dev/f11-repair/fixtures"), { recursive: true });
  root = await mkdtemp(path.resolve(".dev/f11-repair/fixtures/repair-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function tarball(files: Record<string, string>) {
  const source = await mkdtemp(path.join(root, "source-"));
  await mkdir(path.join(source, "package"));
  for (const [file, text] of Object.entries(files))
    await writeFile(path.join(source, "package", file), text);
  const archive = path.join(source, "sdk.tgz");
  execFileSync("tar", ["-czf", archive, "-C", source, "package"], {
    env: { PATH: "/usr/bin:/bin", HOME: root },
  });
  const bytes = new Uint8Array(await readFile(archive));
  return { bytes, integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}` };
}
async function legacy(source: string) {
  const dir = path.join(root, "runtime", prefix, "package");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "sdk.mjs"), source);
  return dir;
}
test("quarantines a syntax-broken managed SDK and imports one verified replacement", async () => {
  await legacy("export const = broken;");
  const replacement = await tarball({ "sdk.mjs": 'export const source = "repaired";' });
  let downloads = 0;
  const sdk = await loadClaudeAgentSdk({
    runtimeDir: path.join(root, "runtime"),
    importLocal: missingLocal,
    fetchTarball: async () => {
      downloads++;
      return replacement.bytes;
    },
    integrity: replacement.integrity,
  });
  expect((sdk as unknown as { source: string }).source).toBe("repaired");
  expect(downloads).toBe(1);
  expect(
    (await readdir(path.join(root, "runtime"))).filter((name) => name.includes(".quarantine-"))
      .length,
  ).toBe(1);
});

test.each(["missing-entry", "top-level-throw"])(
  "repairs %s only inside managed runtime",
  async (failure) => {
    const directory = await legacy('throw new Error("fixture-private-detail");');
    if (failure === "missing-entry") await rm(path.join(directory, "sdk.mjs"));
    const replacement = await tarball({ "sdk.mjs": 'export const source = "repaired";' });
    const options = {
      runtimeDir: path.join(root, "runtime"),
      importLocal: missingLocal,
      integrity: replacement.integrity,
      fetchTarball: async () => replacement.bytes,
    };
    expect(((await loadClaudeAgentSdk(options)) as unknown as { source: string }).source).toBe(
      "repaired",
    );
    const name = JSON.parse(
      await readFile(path.join(options.runtimeDir, `${prefix}.json`), "utf8"),
    );
    expect(name).toMatch(/\.generation-[a-f0-9-]+$/);
  },
);

test("never repairs local SDK evaluation errors", async () => {
  const localError = new Error("fixture local failure");
  await legacy('export const source = "untouched";');
  let downloads = 0;
  await expect(
    loadClaudeAgentSdk({
      runtimeDir: path.join(root, "runtime"),
      importLocal: async () => {
        throw localError;
      },
      fetchTarball: async () => {
        downloads++;
        return new Uint8Array();
      },
    }),
  ).rejects.toBe(localError);
  expect(downloads).toBe(0);
  expect(await readdir(path.join(root, "runtime"))).toEqual([prefix]);
});

test("bounds repair to one download, removes unpublished failures and retries on the next call", async () => {
  await legacy('throw new Error("legacy private detail");');
  const broken = await tarball({ "sdk.mjs": 'throw new Error("new private detail");' });
  let downloads = 0;
  const options = {
    runtimeDir: path.join(root, "runtime"),
    importLocal: missingLocal,
    integrity: broken.integrity,
    fetchTarball: async () => {
      downloads++;
      return broken.bytes;
    },
  };
  await expect(loadClaudeAgentSdk(options)).rejects.toThrow("[woowtech:claude-sdk:runtime]");
  expect(downloads).toBe(1);
  const files = await readdir(options.runtimeDir);
  expect(files.length).toBe(1);
  expect(files[0]).toContain(".quarantine-");
  const good = await tarball({ "sdk.mjs": 'export const source = "next";' });
  const sdk = await loadClaudeAgentSdk({
    ...options,
    integrity: good.integrity,
    fetchTarball: async () => {
      downloads++;
      return good.bytes;
    },
  });
  expect((sdk as unknown as { source: string }).source).toBe("next");
  expect(downloads).toBe(2);
});

test("a failed repair still refuses an unpinned tarball before importing it", async () => {
  await legacy('throw new Error("broken");');
  const good = await tarball({ "sdk.mjs": 'export const source = "good";' });
  const wrong = await tarball({ "sdk.mjs": 'export const source = "wrong";' });
  await expect(
    loadClaudeAgentSdk({
      runtimeDir: path.join(root, "runtime"),
      importLocal: missingLocal,
      integrity: good.integrity,
      fetchTarball: async () => wrong.bytes,
    }),
  ).rejects.toMatchObject({ name: "ClaudeAgentSdkIntegrityError" });
  expect(
    (await readdir(path.join(root, "runtime"))).every((name) => name.includes(".quarantine-")),
  ).toBe(true);
});

test.each([
  "../outside",
  `${prefix}.generation-../../outside`,
  "claude-agent-sdk-9.9.9.generation-00000000-0000-4000-8000-000000000000",
  "not-json",
])("refuses unsafe pointer %s without downloading or moving anything", async (target) => {
  const runtimeDir = path.join(root, "runtime");
  await mkdir(runtimeDir);
  const pointer = path.join(runtimeDir, `${prefix}.json`);
  await writeFile(pointer, target === "not-json" ? target : JSON.stringify(target));
  let downloads = 0;
  await expect(
    loadClaudeAgentSdk({
      runtimeDir,
      importLocal: missingLocal,
      fetchTarball: async () => {
        downloads++;
        return new Uint8Array();
      },
    }),
  ).rejects.toThrow("[woowtech:claude-sdk:runtime]");
  expect(downloads).toBe(0);
  expect(await readdir(runtimeDir)).toEqual([`${prefix}.json`]);
});

test.each(["root", "selected", "entry", "dependency", "pointer"])(
  "refuses %s symlinks without touching their targets",
  async (kind) => {
    const runtimeDir = path.join(root, "runtime");
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "sentinel"), "untouched");
    if (kind === "root") await symlink(outside, runtimeDir);
    else {
      await mkdir(runtimeDir);
      if (kind === "selected") await symlink(outside, path.join(runtimeDir, prefix));
      else if (kind === "pointer")
        await symlink(path.join(outside, "sentinel"), path.join(runtimeDir, `${prefix}.json`));
      else {
        const packageDir = await legacy('export const source = "unused";');
        if (kind === "entry") await rm(path.join(packageDir, "sdk.mjs"));
        await symlink(
          path.join(outside, "sentinel"),
          path.join(packageDir, kind === "entry" ? "sdk.mjs" : "dependency.mjs"),
        );
      }
    }
    let downloads = 0;
    await expect(
      loadClaudeAgentSdk({
        runtimeDir,
        importLocal: missingLocal,
        fetchTarball: async () => {
          downloads++;
          return new Uint8Array();
        },
      }),
    ).rejects.toThrow("[woowtech:claude-sdk:runtime]");
    expect(downloads).toBe(0);
    expect(await readdir(outside)).toEqual(["sentinel"]);
    expect(await readFile(path.join(outside, "sentinel"), "utf8")).toBe("untouched");
  },
);

test("deduplicates in-flight loads, retries rejected loads and caches success per source owner", async () => {
  const replacement = await tarball({ "sdk.mjs": 'export const source = "shared";' });
  let downloads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const source = createClaudeAgentSdkSource(() =>
    loadClaudeAgentSdk({
      runtimeDir: path.join(root, "runtime"),
      importLocal: missingLocal,
      integrity: replacement.integrity,
      fetchTarball: async () => {
        downloads++;
        if (downloads === 1) {
          await gate;
          throw new Error("fixture failure");
        }
        return replacement.bytes;
      },
    }),
  );
  expect(source.peek()).toBeNull();
  const first = source.ensure();
  const concurrent = source.ensure();
  expect(first).toBe(concurrent);
  const rejection = expect(first).rejects.toBeInstanceOf(Error);
  release();
  await rejection;
  expect(downloads).toBe(1);
  const sdk = await source.ensure();
  expect(downloads).toBe(2);
  expect(source.peek()).toBe(sdk);
  expect(await source.ensure()).toBe(sdk);
  expect(downloads).toBe(2);
});

test("real Node ESM relative-dependency failure cache is escaped by a unique physical generation", async () => {
  const packageDir = await legacy('export { source } from "./dependency.mjs";');
  await writeFile(
    path.join(packageDir, "dependency.mjs"),
    'throw new Error("fixture stale dependency");',
  );
  const good = await tarball({
    "sdk.mjs": 'export { source } from "./dependency.mjs";',
    "dependency.mjs": 'export const source = "fresh relative dependency";',
  });
  const brokenFresh = await tarball({
    "sdk.mjs": 'export { source } from "./dependency.mjs";',
    "dependency.mjs": 'throw new Error("fixture broken fresh dependency");',
  });
  const input = path.join(root, "child-input.json");
  await writeFile(
    input,
    JSON.stringify({
      runtimeDir: path.join(root, "runtime"),
      packageDir,
      bytes: Buffer.from(good.bytes).toString("base64"),
      integrity: good.integrity,
      brokenBytes: Buffer.from(brokenFresh.bytes).toString("base64"),
      brokenIntegrity: brokenFresh.integrity,
    }),
  );
  const moduleUrl = new URL("./claude-agent-sdk-runtime.ts", import.meta.url).href;
  const script = `import { readFile, writeFile } from 'node:fs/promises';
    import { pathToFileURL } from 'node:url';
    import { loadClaudeAgentSdk } from ${JSON.stringify(moduleUrl)};
    const f = JSON.parse(await readFile(process.argv[1], 'utf8'));
    const url = pathToFileURL(f.packageDir + '/sdk.mjs').href;
    let stale = 0;
    try { await import(url); } catch { stale++; }
    await writeFile(f.packageDir + '/dependency.mjs', 'export const source = "changed in place";');
    try { await import(url + '?entry-only-bust'); } catch { stale++; }
    const sdk = await loadClaudeAgentSdk({ runtimeDir: f.runtimeDir, importLocal: async () => { throw Object.assign(new Error('missing'), {code:'ERR_MODULE_NOT_FOUND'}); }, integrity:f.integrity, fetchTarball:async () => Buffer.from(f.bytes,'base64') });
    const freshOptions = {runtimeDir:f.runtimeDir + '-fresh', importLocal:async () => {throw Object.assign(new Error('missing'), {code:'ERR_MODULE_NOT_FOUND'});}};
    let freshFailures = 0;
    try {await loadClaudeAgentSdk({...freshOptions, integrity:f.brokenIntegrity, fetchTarball:async () => Buffer.from(f.brokenBytes,'base64')});} catch {freshFailures++;}
    const recovered = await loadClaudeAgentSdk({...freshOptions, integrity:f.integrity, fetchTarball:async () => Buffer.from(f.bytes,'base64')});
    console.log(JSON.stringify({ stale, source:sdk.source, freshFailures, recovered:recovered.source }));`;
  const result = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script, input],
    {
      env: {
        PATH: "/usr/bin:/bin",
        HOME: root,
        TMPDIR: root,
        CLAUDE_CONFIG_DIR: root,
        PASEO_HOME: root,
        TSX_DISABLE_CACHE: "1",
        ELECTRON_RUN_AS_NODE: "1",
      },
      timeout: 10_000,
    },
  );
  expect(JSON.parse(result.stdout)).toEqual({
    stale: 2,
    source: "fresh relative dependency",
    freshFailures: 1,
    recovered: "fresh relative dependency",
  });
});

test("a missing pointer target is retried without scanning or changing other versions", async () => {
  const runtimeDir = path.join(root, "runtime");
  await mkdir(runtimeDir);
  await writeFile(
    path.join(runtimeDir, `${prefix}.json`),
    JSON.stringify(`${prefix}.generation-00000000-0000-4000-8000-000000000000`),
  );
  await symlink(
    path.join(root, "outside-do-not-touch"),
    path.join(runtimeDir, "claude-agent-sdk-other"),
  );
  const good = await tarball({ "sdk.mjs": 'export const source = "missing-target-retry";' });
  const sdk = await loadClaudeAgentSdk({
    runtimeDir,
    importLocal: missingLocal,
    integrity: good.integrity,
    fetchTarball: async () => good.bytes,
  });
  expect((sdk as unknown as { source: string }).source).toBe("missing-target-retry");
  expect((await readdir(runtimeDir)).includes("claude-agent-sdk-other")).toBe(true);
});

test("independent concurrent owners atomically publish successful generations without deleting each other", async () => {
  const runtimeDir = path.join(root, "runtime");
  const good = await tarball({ "sdk.mjs": 'export const source = "concurrent";' });
  const options = {
    runtimeDir,
    importLocal: missingLocal,
    integrity: good.integrity,
    fetchTarball: async () => good.bytes,
  };
  const results = await Promise.all([loadClaudeAgentSdk(options), loadClaudeAgentSdk(options)]);
  expect(results.map((sdk) => (sdk as unknown as { source: string }).source)).toEqual([
    "concurrent",
    "concurrent",
  ]);
  const files = await readdir(runtimeDir);
  const generations = files.filter((name) => name.includes(".generation-"));
  expect(generations).toHaveLength(2);
  const selected: unknown = JSON.parse(
    await readFile(path.join(runtimeDir, `${prefix}.json`), "utf8"),
  );
  expect(generations).toContain(selected);
  expect(files).toHaveLength(3);
});
