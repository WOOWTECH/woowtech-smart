import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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
    await smokePackagedDesktopApp({ appPath: app, verifyWebParity: true });
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
        "Open Tasks command and board",
        "built-in settings and reload",
        "shortcut cancellation keeps settings open",
        "recorded shortcut survives reload",
      ],
      signed: false,
      published: false,
    });
    break;
  }
  case "verify-mobile": {
    const { getConfig } = require("@expo/config");
    const { getNativeReleaseVersion } = require("../../packages/app/native-release-version.js");
    const { exp } = getConfig(path.join(root, "packages/app"));
    assert.equal(exp.version, getNativeReleaseVersion(version).appVersion);
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
  case "verify-android": {
    const apk = path.join(root, "artifacts/paseo-dogfood-arm64.apk");
    const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
    assert.ok(sdk, "ANDROID_HOME must point to an installed Android SDK");
    const buildTools = path.join(sdk, "build-tools");
    const aapt = readdirSync(buildTools)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((directory) => path.join(buildTools, directory, "aapt"))
      .find((file) => existsSync(file));
    assert.ok(aapt, "Android SDK build-tools must provide aapt");
    const metadata = execFileSync(aapt, ["dump", "badging", apk], { encoding: "utf8" });
    const { getNativeReleaseVersion } = require("../../packages/app/native-release-version.js");
    const nativeVersion = getNativeReleaseVersion(version);
    assert.equal(/^package: name='([^']+)'/m.exec(metadata)?.[1], brand.mobileAppId);
    assert.equal(/versionName='([^']+)'/.exec(metadata)?.[1], nativeVersion.appVersion);
    assert.equal(
      /versionCode='([^']+)'/.exec(metadata)?.[1],
      String(nativeVersion.androidVersionCode),
    );
    assert.equal(/^native-code: (.+)$/m.exec(metadata)?.[1], "'arm64-v8a'");
    receipt("android-apk", {
      appId: brand.mobileAppId,
      apk: path.relative(root, apk),
      sha256: await digest(apk),
      validation:
        "Native ARM64 diagnostic APK compiled; installation and device acceptance pending",
      releaseSigned: false,
      published: false,
    });
    break;
  }
  default:
    throw new Error(
      "Usage: native-parity.mjs prepare-desktop|verify-desktop|verify-mobile|verify-android",
    );
}
