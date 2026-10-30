// What woowtech/tools/apply-brand.mjs changes besides packages/protocol/src/brand-values.ts:
// the files that tools outside TypeScript read as they are, so they can't import the brand.
// electron-builder reads electron-builder.yml (and so do CI, nix and the guards); the shell and
// cmd CLI shims, the Mac's Chinese permission strings and the web shell ship as files. The
// repository keeps them with woowtech's values, and woowtech/brand-layer.test.mjs checks that
// applying woowtech to them changes nothing, so every brand value in them is listed here.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import YAML from "yaml";

/** The files with brand values in them, and which of the brand's values each one holds. */
export const BRANDED_FILES = [
  { path: "packages/app/public/index.html", values: ["name", "colors.primary"] },
  { path: "packages/app/public/manifest.json", values: ["name"] },
  { path: "packages/desktop/bin/paseo", values: ["name"] },
  { path: "packages/desktop/bin/paseo.cmd", values: ["name"] },
  {
    path: "packages/desktop/assets/lproj/zh_TW.lproj/InfoPlist.strings",
    values: ["name", "nameZh"],
  },
  {
    path: "packages/desktop/assets/lproj/zh_CN.lproj/InfoPlist.strings",
    values: ["name", "nameZh"],
  },
];

export const ELECTRON_BUILDER_CONFIG = "packages/desktop/electron-builder.yml";

/**
 * The icons woowtech/tools/generate-icons.mjs makes. The repository holds woowtech's in place;
 * another brand's are under woowtech/brands/<id>/assets with the same paths.
 */
export const BRAND_ICON_FILES = [
  "packages/app/assets/images/icon.png",
  "packages/app/assets/images/android-icon-foreground.png",
  "packages/app/assets/images/notification-icon.png",
  "packages/app/assets/images/splash-icon.png",
  "packages/app/assets/images/ios-icon-dark.png",
  "packages/app/assets/images/android-icon-monochrome.png",
  "packages/app/assets/images/favicon.png",
  "packages/app/assets/images/favicon-light.png",
  "packages/app/assets/images/favicon-dark.png",
  "packages/app/assets/images/favicon-light-running.png",
  "packages/app/assets/images/favicon-light-attention.png",
  "packages/app/assets/images/favicon-dark-running.png",
  "packages/app/assets/images/favicon-dark-attention.png",
  "packages/app/public/apple-touch-icon.png",
  "packages/app/public/pwa-icon-192.png",
  "packages/app/public/pwa-icon-512.png",
  "packages/desktop/assets/icon.png",
  "packages/desktop/assets/32x32.png",
  "packages/desktop/assets/64x64.png",
  "packages/desktop/assets/128x128.png",
  "packages/desktop/assets/128x128@2x.png",
  "packages/desktop/assets/icon.icns",
  "packages/desktop/assets/icon.ico",
  "packages/desktop/assets/icon-dev.png",
];

/** Where another brand keeps its icons, laid out like the repository. */
export function brandAssetsDir(id) {
  return `woowtech/brands/${id}/assets`;
}

function valueAt(brand, dottedKey) {
  return dottedKey.split(".").reduce((value, key) => value[key], brand);
}

/** `text` of a branded file with `from`'s values written as `to`'s. */
export function rebrandFileText(text, file, from, to) {
  return file.values.reduce((current, key) => {
    const fromValue = valueAt(from, key);
    const toValue = valueAt(to, key);
    if (!current.includes(fromValue)) {
      throw new Error(
        `${file.path} no longer contains ${key} "${fromValue}"; update BRANDED_FILES`,
      );
    }
    return current.replaceAll(fromValue, toValue);
  }, text);
}

/** Sets the scalar at `keys`, keeping its quoting when it already exists. */
function setScalar(doc, keys, value) {
  const node = doc.getIn(keys, true);
  if (YAML.isScalar(node)) {
    node.value = value;
  } else {
    doc.setIn(keys, value);
  }
}

/** The CLI shim copies: `bin/paseo` → `bin/<command>`, `bin/paseo.cmd` → `bin/<command>.cmd`. */
function setCliShimTargets(doc, platform, cliCommand) {
  const resources = doc.getIn([platform, "extraResources"]);
  if (!resources) return;
  resources.items.forEach((item, index) => {
    const from = item.get("from");
    const to = item.get("to");
    if (from === "bin/paseo" && to !== "bin/paseo") {
      setScalar(doc, [platform, "extraResources", index, "to"], `bin/${cliCommand}`);
    }
    if (from === "bin/paseo.cmd" && to !== "bin/paseo.cmd") {
      setScalar(doc, [platform, "extraResources", index, "to"], `bin/${cliCommand}.cmd`);
    }
  });
}

/** electron-builder.yml's text with `brand`'s identity in every field that carries one. */
export function brandElectronBuilderConfig(text, brand) {
  const doc = YAML.parseDocument(text);
  const { name, scheme, cliCommand, desktop, company } = brand;
  const prefix = desktop.artifactPrefix;
  const [releasesOwner, releasesRepo] = brand.links.releasesRepo.split("/");

  setScalar(doc, ["appId"], desktop.appId);
  setScalar(doc, ["productName"], name);
  setScalar(doc, ["executableName"], name);
  setScalar(doc, ["copyright"], company.copyright);
  setScalar(doc, ["extraMetadata", "name"], desktop.appId);
  setScalar(doc, ["extraMetadata", "desktopName"], `${name}.desktop`);
  setScalar(doc, ["protocols", 0, "name"], `${name} agent link`);
  setScalar(doc, ["protocols", 0, "schemes", 0], scheme);
  setScalar(doc, ["publish", "owner"], releasesOwner);
  setScalar(doc, ["publish", "repo"], releasesRepo);
  setScalar(doc, ["mac", "artifactName"], `${prefix}-\${version}-\${arch}.\${ext}`);
  setScalar(
    doc,
    ["mac", "extendInfo", "NSMicrophoneUsageDescription"],
    `Allow ${name} to use the microphone so you can dictate messages to your agents.`,
  );
  setScalar(doc, ["linux", "artifactName"], `${prefix}-\${version}-\${arch}.\${ext}`);
  setScalar(doc, ["linux", "maintainer"], desktop.linuxMaintainer);
  setScalar(doc, ["linux", "vendor"], desktop.linuxVendor);
  setScalar(doc, ["appImage", "executableArgs", 0], `--class=${name}`);
  setScalar(doc, ["appImage", "artifactName"], `${prefix}-\${arch}.\${ext}`);
  setScalar(doc, ["win", "artifactName"], `${prefix}-Setup-\${version}-\${arch}.\${ext}`);
  for (const platform of ["mac", "linux", "win"]) {
    setCliShimTargets(doc, platform, cliCommand);
  }
  // No folding of long strings and no padding inside [ ]: keep the file's own layout.
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

/** Writes `to`'s values into every branded file of the checkout at `repoRoot`, which has `from`'s. */
export function applyBrandToFiles(repoRoot, from, to) {
  const written = [];
  for (const file of BRAND_ICON_FILES) {
    const source = path.join(repoRoot, brandAssetsDir(to.id), file);
    if (!existsSync(source)) {
      throw new Error(`${source} is missing; make it with woowtech/tools/generate-icons.mjs`);
    }
    copyFileSync(source, path.join(repoRoot, file));
    written.push(file);
  }
  for (const file of BRANDED_FILES) {
    const absolute = path.join(repoRoot, file.path);
    writeFileSync(absolute, rebrandFileText(readFileSync(absolute, "utf8"), file, from, to));
    written.push(file.path);
  }
  const config = path.join(repoRoot, ELECTRON_BUILDER_CONFIG);
  writeFileSync(config, brandElectronBuilderConfig(readFileSync(config, "utf8"), to));
  written.push(ELECTRON_BUILDER_CONFIG);
  return written;
}
