#!/usr/bin/env node
// Rebuilds the mobile third-party list (packages/app/src/screens/settings/mobile-third-party-licenses.json)
// from one production build's evidence, as team/store-audit/oss-inventory-execution.md asks:
// the production Metro source maps, the iOS Podfile.lock with CocoaPods' acknowledgements, and the
// Android release runtime classpath. .github/workflows/mobile-license-evidence.yml runs each step.
//
//   node woowtech/tools/mobile-licenses.mjs js <export dir> <repo root> <out.json>
//   node woowtech/tools/mobile-licenses.mjs maven <dependencies.txt> <gradle files-2.1 dir> <out.json>
//   node woowtech/tools/mobile-licenses.mjs pods <Podfile.lock as JSON> <acknowledgements as JSON> <out.json>
//   node woowtech/tools/mobile-licenses.mjs assemble <current list> <js.json> <maven.json> <pods.json> <out list> <report.md>
//
// Conservative like the first inventory: every pod CocoaPods resolves for the app target is listed,
// debug-only ones included. Entries no evidence produces (prebuilt native code inside other
// libraries: "ios-native:" and "bundled:") are carried over and listed in the report for review.
import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const writeJson = (file, value) => writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.|-|_|$)/i;
// Words that need a person's look before the list claims a notice is satisfied.
const REVIEW_WORDS =
  /GPL|MPL|EPL|CDDL|CC-|Creative Commons|SEE LICENSE|UNLICENSED|Commercial|Proprietary/i;

function walk(dir, keep, found = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, keep, found);
    else if (keep(full)) found.push(full);
  }
  return found;
}

function licenseFiles(root) {
  return readdirSync(root)
    .filter((name) => LICENSE_FILE.test(name) && statSync(path.join(root, name)).isFile())
    .sort()
    .map((name) => {
      const text = readFileSync(path.join(root, name), "utf8");
      return { file: name, sha256: sha256(text), text };
    });
}

function declaredLicenses(pkg) {
  if (typeof pkg.license === "string") return [pkg.license];
  if (pkg.license && typeof pkg.license.type === "string") return [pkg.license.type];
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((item) => item.type ?? String(item));
  return [];
}

/** The package root a bundled source file belongs to: the last node_modules segment, or a workspace. */
function packageRootOf(source, roots) {
  const normalized = source.replace(/^webpack:\/\/\//, "").replace(/\\/g, "/");
  const marker = normalized.lastIndexOf("node_modules/");
  const candidates = [];
  if (marker >= 0) {
    const rest = normalized.slice(marker + "node_modules/".length).split("/");
    const nameParts = rest[0].startsWith("@") ? rest.slice(0, 2) : rest.slice(0, 1);
    const relativeRoot = normalized.slice(0, marker) + "node_modules/" + nameParts.join("/");
    for (const base of roots) candidates.push(path.resolve(base, relativeRoot));
  } else {
    // A workspace package (packages/*, plugins): the nearest package.json inside the repository.
    const repo = roots[roots.length - 1];
    for (const base of roots) {
      let dir = path.dirname(path.resolve(base, normalized));
      while (dir.startsWith(repo) && dir !== path.dirname(dir)) {
        if (existsSync(path.join(dir, "package.json"))) {
          candidates.push(dir);
          break;
        }
        dir = path.dirname(dir);
      }
    }
  }
  return candidates.find((dir) => existsSync(path.join(dir, "package.json"))) ?? null;
}

function collectJs(exportDir, repoRoot, out) {
  const repo = realpathSync(repoRoot);
  const appDir = path.join(repo, "packages/app");
  const appName = readJson(path.join(appDir, "package.json")).name;
  const maps = walk(exportDir, (file) => file.endsWith(".map"));
  if (maps.length === 0) throw new Error(`no source maps under ${exportDir}`);
  const packages = new Map();
  const unresolved = new Set();
  for (const map of maps) {
    const platform = /[\\/](ios|android)[\\/]/.exec(map)?.[1];
    if (!platform) throw new Error(`cannot tell the platform of ${map}`);
    const { sources = [] } = readJson(map);
    if (sources.length === 0) throw new Error(`${map} has no sources`);
    for (const source of sources) {
      if (source.startsWith("\0") || source.startsWith("__")) continue;
      const root = packageRootOf(source, [appDir, repo]);
      if (!root) {
        unresolved.add(source);
        continue;
      }
      const real = realpathSync(root);
      const pkg = readJson(path.join(real, "package.json"));
      if (pkg.name === appName || real === repo) continue;
      const key = `${pkg.name}@${pkg.version}`;
      const entry = packages.get(key) ?? {
        name: pkg.name,
        version: pkg.version,
        root: path.relative(repo, real),
        workspace: !real.includes(`${path.sep}node_modules${path.sep}`),
        licenses: declaredLicenses(pkg),
        licenseFiles: licenseFiles(real),
        platforms: [],
      };
      if (!entry.platforms.includes(platform)) entry.platforms.push(platform);
      packages.set(key, entry);
    }
  }
  const result = {
    maps: maps.map((map) => path.relative(exportDir, map)),
    packages: [...packages.values()].sort((a, b) => a.name.localeCompare(b.name)),
    unresolvedSources: [...unresolved].sort().slice(0, 200),
  };
  writeJson(out, result);
  console.log(
    `js: ${result.packages.length} packages from ${maps.length} source maps, ${unresolved.size} unresolved sources`,
  );
}

/** `+--- group:artifact:1.0 -> 1.1 (*)` lines of `gradle :app:dependencies`, resolved versions only. */
function parseGradleTree(text) {
  const coordinates = new Set();
  for (const line of text.split("\n")) {
    const match = /^[|\s]*[+\\]--- ([^\s:]+):([^\s:]+)(?::([^\s]+))?(?: -> ([^\s]+))?(.*)$/.exec(
      line,
    );
    if (!match) continue;
    const [, group, artifact, declared, resolved, tail] = match;
    if (/\((n|c)\)/.test(tail) || group === "project") continue;
    const version = resolved ?? declared;
    if (!version || version.includes("{")) continue;
    coordinates.add(`${group}:${artifact}:${version}`);
  }
  return [...coordinates].sort();
}

function pomPath(cacheDir, group, artifact, version) {
  const base = path.join(cacheDir, group, artifact, version);
  if (!existsSync(base)) return null;
  for (const hash of readdirSync(base)) {
    const file = path.join(base, hash, `${artifact}-${version}.pom`);
    if (existsSync(file)) return file;
  }
  return null;
}

const MAVEN_REPOSITORIES = [
  "https://dl.google.com/dl/android/maven2",
  "https://repo.maven.apache.org/maven2",
  "https://www.jitpack.io",
];

async function readPom(cacheDir, group, artifact, version) {
  const cached = pomPath(cacheDir, group, artifact, version);
  if (cached) return readFileSync(cached, "utf8");
  const relative = `${group.replace(/\./g, "/")}/${artifact}/${version}/${artifact}-${version}.pom`;
  for (const repository of MAVEN_REPOSITORIES) {
    const response = await fetch(`${repository}/${relative}`, {
      headers: { "user-agent": "woowtech-license-audit" },
    });
    if (response.ok) return response.text();
  }
  return null;
}

const tag = (xml, name) => new RegExp(`<${name}>\\s*([^<]*?)\\s*</${name}>`).exec(xml)?.[1];

async function pomLicenses(cacheDir, group, artifact, version, depth = 0) {
  const pom = await readPom(cacheDir, group, artifact, version);
  if (!pom) return { licenses: [], source: "pom not found" };
  const block = /<licenses>([\s\S]*?)<\/licenses>/.exec(pom)?.[1];
  if (block) {
    const licenses = [...block.matchAll(/<license>([\s\S]*?)<\/license>/g)].map(([, body]) => ({
      name: tag(body, "name") ?? "",
      url: tag(body, "url"),
    }));
    if (licenses.length > 0)
      return { licenses, source: depth === 0 ? "pom" : `parent pom (${depth})` };
  }
  const parent = /<parent>([\s\S]*?)<\/parent>/.exec(pom)?.[1];
  if (parent && depth < 5) {
    return pomLicenses(
      cacheDir,
      tag(parent, "groupId"),
      tag(parent, "artifactId"),
      tag(parent, "version"),
      depth + 1,
    );
  }
  return { licenses: [], source: "no licenses in pom" };
}

async function collectMaven(treeFile, cacheDir, out) {
  const coordinates = parseGradleTree(readFileSync(treeFile, "utf8"));
  if (coordinates.length === 0) throw new Error(`no resolved components in ${treeFile}`);
  const components = [];
  for (const coordinate of coordinates) {
    const [group, artifact, version] = coordinate.split(":");
    const { licenses, source } = await pomLicenses(cacheDir, group, artifact, version);
    components.push({ name: `${group}:${artifact}`, version, licenses, licenseSource: source });
  }
  writeJson(out, { components });
  const missing = components.filter((item) => item.licenses.length === 0).length;
  console.log(`maven: ${components.length} components, ${missing} without a declared license`);
}

function collectPods(lockJsonFile, ackJsonFile, out) {
  const lock = readJson(lockJsonFile);
  const versions = new Map();
  for (const item of lock.PODS ?? []) {
    const spec = typeof item === "string" ? item : Object.keys(item)[0];
    const match = /^([^\s/]+)(?:\/\S+)? \(([^)]+)\)$/.exec(spec);
    if (match && !versions.has(match[1])) versions.set(match[1], match[2]);
  }
  const notices = new Map();
  for (const item of readJson(ackJsonFile).PreferenceSpecifiers ?? []) {
    if (!item.Title || item.Title === "Acknowledgements" || !item.FooterText) continue;
    notices.set(item.Title, { license: item.License ?? "", text: item.FooterText });
  }
  const pods = [...versions.entries()]
    .map(([name, version]) => {
      const notice = notices.get(name);
      return {
        name,
        version,
        license: notice?.license ?? "",
        text: notice?.text ?? null,
        sha256: notice ? sha256(notice.text) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  writeJson(out, { pods });
  console.log(
    `pods: ${pods.length} pods, ${pods.filter((pod) => !pod.text).length} without an acknowledgement`,
  );
}

const kindOf = (entry) => entry.id.split(":")[0];
const nameKey = (entry) => `${kindOf(entry)}:${entry.name}`;
const needsLook = (name) => REVIEW_WORDS.test(name);

/** What the first inventory already settled: its texts, its entries by name, and Maven license texts. */
function catalogContext(current) {
  const documents = { ...current.documents };
  const mavenTexts = new Map();
  for (const entry of current.entries.filter((item) => kindOf(item) === "maven")) {
    for (const license of entry.licenses) {
      const key = (license.url ?? license.name).toLowerCase();
      if (!mavenTexts.has(key)) mavenTexts.set(key, entry.documentIds);
    }
  }
  return {
    documents,
    review: [],
    byName: new Map(current.entries.map((entry) => [nameKey(entry), entry])),
    mavenTexts,
    documentFor(text) {
      const id = sha256(text);
      documents[id] = text;
      return id;
    },
  };
}

function jsEntry(pkg, ctx) {
  const id = `js:${pkg.name}@${pkg.version}`;
  const previous = ctx.byName.get(`js:${pkg.name}`);
  let documentIds = pkg.licenseFiles.map((file) => ctx.documentFor(file.text));
  if (documentIds.length === 0 && previous) documentIds = previous.documentIds;
  if (documentIds.length === 0) ctx.review.push(`${id}: no license file in the package`);
  const licenses = pkg.licenses.map((name) => ({ name }));
  if (
    licenses.length === 0 ||
    pkg.licenses.some((name) => needsLook(name) || / OR | AND /.test(name))
  ) {
    ctx.review.push(`${id}: license "${pkg.licenses.join(", ")}" needs a look`);
  }
  const platforms = [...new Set([...pkg.platforms, "js"])].sort();
  return { id, name: pkg.name, version: pkg.version, platforms, licenses, documentIds };
}

function mavenEntry(component, ctx) {
  const id = `maven:${component.name}:${component.version}`;
  const previous = ctx.byName.get(`maven:${component.name}`);
  const known = component.licenses.flatMap(
    (license) => ctx.mavenTexts.get((license.url ?? license.name).toLowerCase()) ?? [],
  );
  let documentIds = [...new Set(known)];
  if (documentIds.length === 0 && previous) documentIds = previous.documentIds;
  if (documentIds.length === 0)
    ctx.review.push(`${id}: no known license text (${component.licenseSource})`);
  const licenses = component.licenses.length > 0 ? component.licenses : (previous?.licenses ?? []);
  if (licenses.some(({ name }) => needsLook(name))) ctx.review.push(`${id}: license needs a look`);
  return {
    id,
    name: component.name,
    version: component.version,
    platforms: ["android"],
    licenses: licenses.map(({ name, url }) => (url ? { name, url } : { name })),
    documentIds,
  };
}

function podEntry(pod, ctx) {
  const id = `pod:${pod.name}@${pod.version}`;
  const previous = ctx.byName.get(`pod:${pod.name}`);
  const documentIds = pod.text ? [ctx.documentFor(pod.text)] : (previous?.documentIds ?? []);
  const license = pod.license || previous?.licenses?.[0]?.name || "";
  if (documentIds.length === 0) ctx.review.push(`${id}: no acknowledgement text`);
  if (!license || needsLook(license)) ctx.review.push(`${id}: license "${license}" needs a look`);
  const licenses = license ? [{ name: license }] : [];
  return { id, name: pod.name, version: pod.version, platforms: ["ios"], licenses, documentIds };
}

function report(current, next, carried, review) {
  const before = new Set(current.entries.map((entry) => entry.id));
  const beforeByName = new Map(current.entries.map((entry) => [nameKey(entry), entry]));
  const afterNames = new Set(next.entries.map(nameKey));
  const added = next.entries.filter((entry) => !beforeByName.has(nameKey(entry)));
  const removed = current.entries.filter((entry) => !afterNames.has(nameKey(entry)));
  const changed = next.entries.filter(
    (entry) => beforeByName.has(nameKey(entry)) && !before.has(entry.id),
  );
  const count = (list, kind) => list.filter((entry) => kindOf(entry) === kind).length;
  const row = (kind) =>
    `| ${kind} | ${count(current.entries, kind)} | ${count(next.entries, kind)} | ${count(added, kind)} | ${count(removed, kind)} | ${count(changed, kind)} |`;
  const section = (title, items) => [
    `## ${title} (${items.length})`,
    ...items.map((item) => `- ${item}`),
    "",
  ];
  const lines = [
    "# Mobile third-party list: regenerated from build evidence",
    "",
    "| Kind | Before | After | Added | Removed | New version |",
    "| --- | --- | --- | --- | --- | --- |",
    ...["js", "pod", "maven", "ios-native", "bundled"].map(row),
    "",
    `Documents: ${Object.keys(current.documents).length} before, ${Object.keys(next.documents).length} after.`,
    "",
    ...section(
      "Carried over without evidence: check their versions against the new build",
      carried.map((entry) => entry.id),
    ),
    ...section("Needs a person's look", review),
    ...section(
      "Added",
      added.map((entry) => entry.id),
    ),
    ...section(
      "Removed",
      removed.map((entry) => entry.id),
    ),
    ...section(
      "New versions",
      changed.map((entry) => `${beforeByName.get(nameKey(entry)).id} → ${entry.version}`),
    ),
  ];
  return { text: `${lines.join("\n")}\n`, added, removed, changed };
}

function assemble(currentFile, jsFile, mavenFile, podsFile, outFile, reportFile) {
  const current = readJson(currentFile);
  const ctx = catalogContext(current);
  const carried = current.entries.filter((entry) => /^(ios-native|bundled)$/.test(kindOf(entry)));
  const entries = [
    ...readJson(jsFile).packages.map((pkg) => jsEntry(pkg, ctx)),
    ...readJson(mavenFile).components.map((component) => mavenEntry(component, ctx)),
    ...readJson(podsFile).pods.map((pod) => podEntry(pod, ctx)),
    ...carried,
  ];
  if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
    throw new Error("duplicate entry ids in the assembled list");
  }
  const used = new Set(entries.flatMap((entry) => entry.documentIds));
  const documents = Object.fromEntries(
    Object.entries(ctx.documents).filter(([id]) => used.has(id)),
  );
  const next = { entries, documents };
  writeJson(outFile, next);
  const { text, added, removed, changed } = report(current, next, carried, ctx.review);
  writeFileSync(reportFile, text);
  console.log(
    `assembled ${entries.length} entries (${added.length} added, ${removed.length} removed, ${changed.length} new versions, ${ctx.review.length} to review)`,
  );
}

const [command, ...args] = process.argv.slice(2);
const commands = {
  js: () => collectJs(...args),
  maven: () => collectMaven(...args),
  pods: () => collectPods(...args),
  assemble: () => assemble(...args),
};
if (!commands[command]) {
  console.error("usage: mobile-licenses.mjs js|maven|pods|assemble ... (see the header)");
  process.exit(2);
}
await commands[command]();
