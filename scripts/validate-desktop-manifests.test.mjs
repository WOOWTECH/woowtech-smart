import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { validateDesktopManifests } from "./validate-desktop-manifests.mjs";

const releaseDate = "2026-09-04T00:00:00.000Z";
const scriptPath = fileURLToPath(new URL("./validate-desktop-manifests.mjs", import.meta.url));

function withManifest(contents, run) {
  const dir = mkdtempSync(path.join(tmpdir(), "paseo-validate-desktop-manifest-"));
  const manifestPath = path.join(dir, "latest-mac.yml");
  try {
    writeFileSync(manifestPath, contents);
    run(manifestPath);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

test("accepts a guarded macOS update manifest", () => {
  withManifest(
    `version: 0.7.3\nreleaseDate: '${releaseDate}'\nrolloutHours: 36\nminimumSystemVersion: 22.0.0\n`,
    (manifestPath) => {
      validateDesktopManifests({ releaseDate, rolloutHours: 36 }, [manifestPath]);
    },
  );
});

test("validates release manifests through the workflow CLI", () => {
  withManifest(
    `version: 0.7.3\nreleaseDate: '${releaseDate}'\nrolloutHours: 36\nminimumSystemVersion: 22.0.0\n`,
    (manifestPath) => {
      const result = spawnSync(
        process.execPath,
        [scriptPath, "--release-date", releaseDate, "--rollout-hours", "36", manifestPath],
        { encoding: "utf8" },
      );

      assert.equal(result.status, 0, result.stderr);
    },
  );
});

test("rejects a macOS update manifest without the system floor", () => {
  withManifest(
    `version: 0.7.3\nreleaseDate: '${releaseDate}'\nrolloutHours: 36\n`,
    (manifestPath) => {
      assert.throws(
        () => validateDesktopManifests({ releaseDate, rolloutHours: 36 }, [manifestPath]),
        /minimumSystemVersion=undefined, expected 22\.0\.0/,
      );
    },
  );
});

test("rejects invalid rollout metadata", () => {
  withManifest(
    `version: 0.7.3\nreleaseDate: '${releaseDate}'\nrolloutHours: 24\nminimumSystemVersion: 22.0.0\n`,
    (manifestPath) => {
      assert.throws(
        () => validateDesktopManifests({ releaseDate, rolloutHours: 36 }, [manifestPath]),
        /rolloutHours=24, expected 36/,
      );
    },
  );
});

// Exercise real manifest, filesystem and pinned blockmap code; only Apple's remote gate is mocked.
import { createHash } from "node:crypto";
import { readFileSync, existsSync, copyFileSync, symlinkSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { dump, load } from "js-yaml";
import { finalizeMacRelease, verifyFinalized, notaryArgs, run } from "./finalize-macos-release.mjs";

function sha512(bytes) {
  return createHash("sha512").update(bytes).digest("base64");
}

async function withMacRelease(runTest) {
  const source = mkdtempSync(path.join(tmpdir(), "mac-finalize-"));
  const output = `${source}-finalized`;
  const dmg = "smart-1.0.0-arm64.dmg";
  const zip = "smart-1.0.0-arm64.zip";
  const files = [dmg, zip].map((url) => {
    const bytes = Buffer.from(`original ${url}`);
    writeFileSync(path.join(source, url), bytes);
    writeFileSync(path.join(source, `${url}.blockmap`), "stale builder blockmap");
    return { url, size: bytes.length, sha512: sha512(bytes) };
  });
  const manifestName = "latest-mac.yml";
  writeFileSync(
    path.join(source, manifestName),
    dump({ version: "1.0.0", files, path: zip, sha512: files[1].sha512 }),
  );
  const options = {
    source,
    output,
    manifestName,
    arch: "arm64",
    finalizeDmg: async (input, target) => {
      writeFileSync(
        target,
        Buffer.concat([readFileSync(input), Buffer.from(" signed and stapled")]),
      );
      writeFileSync(`${target}.notary-log.json`, '{"status":"Accepted"}');
    },
  };
  try {
    await runTest({ options, dmg, zip });
  } finally {
    rmSync(source, { recursive: true, force: true });
    rmSync(output, { recursive: true, force: true });
  }
}

test("finalizes DMG metadata and fresh blockmaps while preserving ZIP and excluding diagnostics", async () => {
  await withMacRelease(async ({ options, dmg, zip }) => {
    const paths = await finalizeMacRelease(options);
    assert.equal(paths.length, 5);
    assert.equal(
      paths.some((file) => file.endsWith(".notary-log.json")),
      false,
    );
    const manifest = load(readFileSync(path.join(options.output, options.manifestName), "utf8"));
    for (const entry of manifest.files) {
      const bytes = readFileSync(path.join(options.output, entry.url));
      assert.equal(entry.sha512, sha512(bytes));
      assert.equal(entry.size, bytes.length);
      const map = JSON.parse(
        gunzipSync(readFileSync(path.join(options.output, `${entry.url}.blockmap`))),
      );
      assert.equal(map.version, "2");
      assert.equal(
        map.files[0].sizes.reduce((a, b) => a + b, 0),
        bytes.length,
      );
    }
    assert.deepEqual(
      readFileSync(path.join(options.source, zip)),
      readFileSync(path.join(options.output, zip)),
    );
    assert.notEqual(sha512(readFileSync(path.join(options.source, dmg))), manifest.files[0].sha512);
    assert.equal(manifest.sha512, manifest.files[1].sha512);
    assert.deepEqual(await verifyFinalized(options.output), paths);
  });
});

test("no upload allowlist when Apple helper exits nonzero after copying", async () => {
  await withMacRelease(async ({ options }) => {
    options.finalizeDmg = async (input, target) => {
      copyFileSync(input, target);
      run(process.execPath, ["-e", "process.exit(7)"]);
    };
    await assert.rejects(finalizeMacRelease(options), /failed \(7\)/);
    assert.equal(existsSync(path.join(options.output, "finalized.json")), false);
    await assert.rejects(verifyFinalized(options.output), /ENOENT/);
  });
});

for (const suffix of [".dmg", ".dmg.blockmap", "-mac.yml"]) {
  test(`rejects finalized ${suffix} tampering before upload`, async () => {
    await withMacRelease(async ({ options }) => {
      const paths = await finalizeMacRelease(options);
      writeFileSync(
        paths.find((file) => file.endsWith(suffix)),
        "tampered",
      );
      await assert.rejects(verifyFinalized(options.output), /Finalized artifact changed/);
    });
  });
}

test("rejects wrong arch, stale source hashes and path traversal before invoking Apple", async () => {
  await withMacRelease(async ({ options }) => {
    let calls = 0;
    options.finalizeDmg = async () => {
      calls++;
    };
    await assert.rejects(finalizeMacRelease({ ...options, arch: "x64" }), /architecture/);
    const file = path.join(options.source, options.manifestName);
    const manifest = load(readFileSync(file, "utf8"));
    manifest.files[0].sha512 = "stale";
    writeFileSync(file, dump(manifest));
    await assert.rejects(finalizeMacRelease(options), /Input manifest mismatch/);
    manifest.files[0].url = "../outside-arm64.dmg";
    writeFileSync(file, dump(manifest));
    await assert.rejects(finalizeMacRelease(options), /Unsafe artifact name/);
    assert.equal(calls, 0);
    assert.equal(existsSync(options.output), false);
  });
});

test("fails closed on blockmap failure and refuses to reuse partial output", async () => {
  await withMacRelease(async ({ options }) => {
    options.blockmap = async () => {
      throw new Error("blockmap failed");
    };
    await assert.rejects(finalizeMacRelease(options), /blockmap failed/);
    assert.equal(existsSync(path.join(options.output, "finalized.json")), false);
    await assert.rejects(finalizeMacRelease(options), /new directory/);
  });
});

test("rejects blockmap result that does not describe final signed bytes", async () => {
  await withMacRelease(async ({ options }) => {
    options.blockmap = async () => ({ sha512: "old", size: 1 });
    await assert.rejects(finalizeMacRelease(options), /Blockmap\/content mismatch/);
    assert.equal(existsSync(path.join(options.output, "finalized.json")), false);
  });
});

test("rejects source symlinks before signing", async () => {
  await withMacRelease(async ({ options, dmg, zip }) => {
    rmSync(path.join(options.source, dmg));
    symlinkSync(path.join(options.source, zip), path.join(options.source, dmg));
    await assert.rejects(finalizeMacRelease(options), /Not a regular file/);
  });
});

test("passes existing API-key env to Elmo's exact CLI without requiring a profile", async () => {
  await withMacRelease(async ({ options }) => {
    const key = path.join(options.source, "dummy.p8");
    writeFileSync(key, "test fixture, not a key");
    const config = {
      input: "raw.dmg",
      output: "final.dmg",
      app: "Apporo smart",
      identity: "Developer ID Application: Fixture (TEST)",
      keychain: "fixture.keychain",
    };
    const env = { APPLE_API_KEY: key, APPLE_API_KEY_ID: "ID", APPLE_API_ISSUER: "ISSUER" };
    assert.deepEqual(notaryArgs(config, env), [
      "--dmg",
      "raw.dmg",
      "--out",
      "final.dmg",
      "--app",
      "Apporo smart",
      "--identity",
      config.identity,
      "--keychain",
      config.keychain,
      "--notary-key",
      key,
      "--notary-key-id",
      "ID",
      "--notary-issuer",
      "ISSUER",
    ]);
    assert.throws(
      () => notaryArgs(config, { ...env, APPLE_API_KEY_ID: "" }),
      /Missing APPLE_API_KEY_ID/,
    );
    assert.throws(
      () => notaryArgs(config, { APPLE_ID: "fixture", APPLE_PASSWORD: "fixture" }),
      /Missing APPLE_API_KEY/,
    );
  });
});

test("refreshes legacy DMG SHA512/size and CLI emits only verified upload paths", async () => {
  await withMacRelease(async ({ options, dmg }) => {
    const file = path.join(options.source, options.manifestName);
    const manifest = load(readFileSync(file, "utf8"));
    manifest.path = dmg;
    manifest.sha512 = manifest.files[0].sha512;
    manifest.size = manifest.files[0].size;
    writeFileSync(file, dump(manifest));
    const paths = await finalizeMacRelease(options);
    const final = load(readFileSync(path.join(options.output, options.manifestName), "utf8"));
    assert.equal(final.sha512, final.files[0].sha512);
    assert.equal(final.size, final.files[0].size);
    const cli = fileURLToPath(new URL("./finalize-macos-release.mjs", import.meta.url));
    const good = spawnSync(process.execPath, [cli, "--verify", options.output], {
      encoding: "utf8",
    });
    assert.equal(good.status, 0, good.stderr);
    assert.deepEqual(good.stdout.trim().split("\n"), paths);
    writeFileSync(path.join(options.output, dmg), "tampered after review");
    const bad = spawnSync(process.execPath, [cli, "--verify", options.output], {
      encoding: "utf8",
    });
    assert.notEqual(bad.status, 0);
    assert.equal(bad.stdout, "");
    assert.match(bad.stderr, /Finalized artifact changed/);
  });
});

test("rejects inconsistent manifest even when receipt matches its new bytes", async () => {
  await withMacRelease(async ({ options }) => {
    await finalizeMacRelease(options);
    const file = path.join(options.output, options.manifestName);
    const manifest = load(readFileSync(file, "utf8"));
    manifest.files[0].sha512 = "stale pre-sign hash";
    const bytes = Buffer.from(dump(manifest));
    writeFileSync(file, bytes);
    const receiptPath = path.join(options.output, "finalized.json");
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    Object.assign(
      receipt.files.find((entry) => entry.name === options.manifestName),
      {
        size: bytes.length,
        sha512: sha512(bytes),
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    );
    writeFileSync(receiptPath, JSON.stringify(receipt));
    await assert.rejects(verifyFinalized(options.output), /Finalized manifest\/content mismatch/);
  });
});

function addIntelPair(options) {
  const file = path.join(options.source, options.manifestName);
  const manifest = load(readFileSync(file, "utf8"));
  const intel = ["zip", "dmg"].map((ext) => {
    const url = `smart-1.0.0-x64.${ext}`;
    const bytes = Buffer.from(`Intel ${ext} fixture`);
    writeFileSync(path.join(options.source, url), bytes);
    return { url, size: bytes.length, sha512: sha512(bytes) };
  });
  // Match the remote four-entry manifest, whose legacy path points to Intel ZIP.
  manifest.files = [intel[0], manifest.files[1], intel[1], manifest.files[0]];
  Object.assign(manifest, { path: intel[0].url, sha512: intel[0].sha512, size: intel[0].size });
  writeFileSync(file, dump(manifest));
  return manifest;
}

for (const arch of ["arm64", "x64"]) {
  test(`validates all four source artifacts and finalizes only ${arch} with matching legacy ZIP`, async () => {
    await withMacRelease(async ({ options }) => {
      const original = addIntelPair(options);
      const before = readFileSync(path.join(options.source, options.manifestName));
      options.arch = arch;
      const paths = await finalizeMacRelease(options);
      assert.equal(paths.length, 5);
      const final = load(readFileSync(path.join(options.output, options.manifestName), "utf8"));
      assert.equal(final.files.length, 2);
      assert.ok(final.files.every((entry) => entry.url.includes(`-${arch}.`)));
      const zip = final.files.find((entry) => entry.url.endsWith(".zip"));
      assert.equal(final.path, zip.url);
      assert.equal(final.sha512, zip.sha512);
      assert.equal(final.size, zip.size);
      for (const entry of original.files) {
        assert.equal(sha512(readFileSync(path.join(options.source, entry.url))), entry.sha512);
        if (!entry.url.includes(`-${arch}.`))
          assert.equal(existsSync(path.join(options.output, entry.url)), false);
      }
      assert.deepEqual(readFileSync(path.join(options.source, options.manifestName)), before);
      assert.deepEqual(await verifyFinalized(options.output), paths);
    });
  });
}

test("rejects corruption in the unselected architecture before calling the notary helper", async () => {
  await withMacRelease(async ({ options }) => {
    addIntelPair(options);
    writeFileSync(path.join(options.source, "smart-1.0.0-x64.dmg"), "corrupt Intel payload");
    let called = false;
    options.finalizeDmg = async () => {
      called = true;
    };
    await assert.rejects(
      finalizeMacRelease(options),
      /Input manifest mismatch: smart-1.0.0-x64.dmg/,
    );
    assert.equal(called, false);
    assert.equal(existsSync(options.output), false);
  });
});

for (const mutation of ["duplicate", "ambiguous", "missing-pair", "wrong-arch", "legacy-hash"]) {
  test(`rejects unsafe multiarch manifest: ${mutation}`, async () => {
    await withMacRelease(async ({ options }) => {
      const manifest = addIntelPair(options);
      const file = path.join(options.source, options.manifestName);
      if (mutation === "duplicate") manifest.files[2] = { ...manifest.files[0] };
      if (mutation === "ambiguous") manifest.files[2].url = "other-1.0.0-x64.zip";
      if (mutation === "missing-pair") manifest.files = [manifest.files[0], manifest.files[1]];
      if (mutation === "wrong-arch") manifest.files[2].url = "smart-1.0.0-universal.dmg";
      if (mutation === "legacy-hash") manifest.sha512 = "wrong legacy hash";
      writeFileSync(file, dump(manifest));
      let called = false;
      options.finalizeDmg = async () => {
        called = true;
      };
      await assert.rejects(
        finalizeMacRelease(options),
        /Duplicate|Ambiguous|requires exactly|Unsupported architecture|Input legacy SHA512 mismatch/,
      );
      assert.equal(called, false);
      assert.equal(existsSync(options.output), false);
    });
  });
}
