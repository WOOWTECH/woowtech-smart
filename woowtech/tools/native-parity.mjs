import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { appliedBrand } = require("../brands/index.cjs");
const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.join(root, "artifacts/native-parity");
const brand = appliedBrand();
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const version = json(path.join(root, "package.json")).version;

async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function receipt(kind, evidence) {
  mkdirSync(output, { recursive: true });
  const result = {
    kind,
    brand: brand.id,
    version,
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    platform: process.platform,
    arch: process.arch,
    createdAt: new Date().toISOString(),
    ...evidence,
  };
  writeFileSync(path.join(output, `${kind}.json`), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result));
}

switch (process.argv[2]) {
  case "prepare-desktop": {
    // electron-builder resolves this relative to packages/desktop. This file belongs
    // only to the candidate build; the committed signing/release config stays intact.
    writeFileSync(
      path.join(root, "packages/desktop/native-parity-builder.json"),
      JSON.stringify({
        extends: "./electron-builder.yml",
        mac: { identity: null, notarize: false },
      }),
    );
    break;
  }
  case "verify-desktop": {
    const release = path.join(root, "packages/desktop/release");
    const app =
      process.platform === "darwin"
        ? path.join(release, process.arch === "arm64" ? "mac-arm64" : "mac", `${brand.name}.app`)
        : path.join(release, process.platform === "win32" ? "win-unpacked" : "linux-unpacked");
    const resources = path.join(
      app,
      ...(process.platform === "darwin" ? ["Contents", "Resources"] : ["resources"]),
    );
    const archive = path.join(resources, "app.asar");
    const { extractFile } = require("@electron/asar");
    const packaged = JSON.parse(extractFile(archive, "package.json").toString());
    assert.equal(packaged.version, version, "Packaged version must match the source");
    assert.equal(
      packaged.name,
      brand.desktop.appId,
      "Packaged application must retain its brand identity",
    );
    assert.ok(
      existsSync(path.join(resources, "app-dist/index.html")),
      "Electron renderer is missing",
    );
    assert.ok(
      existsSync(path.join(resources, "builtin-plugins/better-paseo")),
      "Built-in Tasks payload is missing",
    );
    const { smokePackagedDesktopApp } = require("../../packages/desktop/e2e/packaged-app-smoke.js");
    await smokePackagedDesktopApp({ appPath: app });
    receipt("desktop", {
      app: path.relative(root, app),
      archiveSha256: await digest(archive),
      checks: [
        "packaged identity/version",
        "renderer/preload",
        "daemon",
        "built-in plugin catalog",
        "CLI",
        "real PTY",
      ],
      signed: false,
      published: false,
    });
    break;
  }
  case "verify-mobile": {
    const { getConfig } = require("@expo/config");
    const { exp } = getConfig(path.join(root, "packages/app"));
    assert.equal(exp.version, version);
    assert.equal(exp.ios?.bundleIdentifier, brand.mobileAppId);
    assert.equal(exp.android?.package, brand.mobileAppId);
    assert.equal(exp.scheme, brand.scheme);
    const bundles = [];
    for (const platform of ["ios", "android"]) {
      const directory = path.join(output, platform);
      const metadata = json(path.join(directory, "metadata.json"));
      const bundle = metadata.fileMetadata?.[platform]?.bundle;
      assert.equal(typeof bundle, "string", `${platform} bundle missing from Expo metadata`);
      const file = path.resolve(directory, bundle);
      assert.ok(file.startsWith(`${directory}${path.sep}`), "Bundle must be inside its export");
      bundles.push({ platform, bundle, sha256: await digest(file) });
    }
    receipt("mobile", {
      appId: exp.ios.bundleIdentifier,
      scheme: exp.scheme,
      bundles,
      validation:
        "Metro/Hermes export only; native compilation, installation, permissions and device interactions still require device acceptance",
      published: false,
    });
    break;
  }
  default:
    throw new Error("Usage: native-parity.mjs prepare-desktop|verify-desktop|verify-mobile");
}
