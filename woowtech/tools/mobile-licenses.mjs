#!/usr/bin/env node
// Rebuilds the mobile third-party list (packages/app/src/screens/settings/mobile-third-party-licenses.json)
// from one production build's evidence, as team/store-audit/oss-inventory-execution.md asks:
// the production Metro source maps, the iOS Podfile.lock with CocoaPods' acknowledgements, and the
// Android release runtime classpath. .github/workflows/mobile-license-evidence.yml runs each step.
//
//   node woowtech/tools/mobile-licenses.mjs js <export dir> <repo root> <out.json>
//   node woowtech/tools/mobile-licenses.mjs maven <dependencies.txt> <gradle files-2.1 dir> <repo root> <out.json>
//   node woowtech/tools/mobile-licenses.mjs pods <Podfile.lock as JSON> <acknowledgements as JSON> <ios dir> <repo root> <out.json>
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
  /\b(?:A?L?GPL|MPL|EPL|CDDL)\b|\bCC-|Creative Commons|SEE LICENSE|UNLICENSED|Commercial|Proprietary/i;

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

/**
 * Where a bundled source file may be on disk. Expo's maps name files from the server root with a
 * leading slash ("/node_modules/react/index.js", "/packages/client/src/x.ts"); a real absolute
 * path or a relative one is taken as it is.
 */
function candidateFiles(source, roots) {
  const normalized = source.replace(/^webpack:\/\/\//, "").replace(/\\/g, "/");
  const relative = normalized.replace(/^\/+/, "");
  const candidates = path.isAbsolute(normalized) && existsSync(normalized) ? [normalized] : [];
  for (const base of roots) candidates.push(path.resolve(base, relative));
  return [...new Set(candidates)];
}

/** The package root a bundled source file belongs to: the last node_modules segment, or a workspace. */
function packageRootOf(source, roots) {
  const repo = roots[roots.length - 1];
  for (const file of candidateFiles(source, roots)) {
    const marker = file.lastIndexOf(`node_modules${path.sep}`);
    if (marker >= 0) {
      const rest = file.slice(marker + `node_modules${path.sep}`.length).split(path.sep);
      const nameParts = rest[0].startsWith("@") ? rest.slice(0, 2) : rest.slice(0, 1);
      const root = path.join(file.slice(0, marker), "node_modules", ...nameParts);
      if (existsSync(path.join(root, "package.json"))) return root;
      continue;
    }
    // A workspace package (packages/*, plugins): the nearest package.json inside the repository.
    // Only a file that exists, or a wrong base would walk up into the app's own package.json.
    if (!existsSync(file)) continue;
    // A nested package.json that only sets "type" or "sideEffects" is not the package's root.
    for (
      let dir = path.dirname(file);
      dir.startsWith(repo) && dir !== repo;
      dir = path.dirname(dir)
    ) {
      const manifest = path.join(dir, "package.json");
      if (existsSync(manifest) && readJson(manifest).name) return dir;
    }
  }
  return null;
}

/**
 * A bundled package's name, version and license. A module inside the repository that declares no
 * license is part of the app's own source, so it carries the repository's license (Paseo's).
 */
function packageEntry(pkg, real, repo) {
  const workspace = !real.includes(`${path.sep}node_modules${path.sep}`);
  let licenses = declaredLicenses(pkg);
  let files = licenseFiles(real);
  if (workspace && licenses.length === 0 && files.length === 0) {
    licenses = declaredLicenses(readJson(path.join(repo, "package.json")));
    files = licenseFiles(repo);
  }
  return {
    name: pkg.name,
    version: pkg.version,
    root: path.relative(repo, real),
    workspace,
    licenses,
    licenseFiles: files,
    platforms: [],
  };
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
      if (!pkg.name || !pkg.version) {
        unresolved.add(source);
        continue;
      }
      if (pkg.name === appName || real === repo) continue;
      const key = `${pkg.name}@${pkg.version}`;
      const entry = packages.get(key) ?? packageEntry(pkg, real, repo);
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
    // A substitution names the module that replaces this one: "-> com.facebook.react:react-android:0.86.3".
    const coordinate = resolved?.includes(":")
      ? resolved
      : `${group}:${artifact}:${resolved ?? declared}`;
    const version = coordinate.split(":")[2];
    if (!version || version.includes("{")) continue;
    coordinates.add(coordinate);
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

/** Maven repositories some npm packages ship ("local-maven-repo"), found once per run. */
let localMavenRepositories = [];

function findLocalMavenRepositories(repo) {
  const found = [];
  const consider = (packageDir) => {
    for (const candidate of [
      path.join(packageDir, "local-maven-repo"),
      path.join(packageDir, "android", "local-maven-repo"),
    ]) {
      if (existsSync(candidate)) found.push({ repository: candidate, packageDir });
    }
  };
  // A package npm could not hoist sits in the workspace's own node_modules (packages/app).
  const workspaces = existsSync(path.join(repo, "packages"))
    ? readdirSync(path.join(repo, "packages")).map((name) => path.join(repo, "packages", name))
    : [];
  for (const nodeModules of [repo, ...workspaces].map((dir) => path.join(dir, "node_modules"))) {
    if (!existsSync(nodeModules)) continue;
    for (const name of readdirSync(nodeModules)) {
      const dir = path.join(nodeModules, name);
      if (!name.startsWith("@")) consider(dir);
      else if (statSync(dir).isDirectory())
        for (const scoped of readdirSync(dir)) consider(path.join(dir, scoped));
    }
  }
  return found;
}

const MAVEN_REPOSITORIES = [
  "https://dl.google.com/dl/android/maven2",
  "https://repo.maven.apache.org/maven2",
  "https://www.jitpack.io",
];

/** The npm package whose local-maven-repo holds this module, if one does. */
function localMavenPackage(group, artifact, version) {
  const relative = `${group.replace(/\./g, "/")}/${artifact}/${version}/${artifact}-${version}.pom`;
  return localMavenRepositories.find(({ repository }) =>
    existsSync(path.join(repository, relative)),
  );
}

async function readPom(cacheDir, group, artifact, version) {
  const cached = pomPath(cacheDir, group, artifact, version);
  if (cached) return readFileSync(cached, "utf8");
  const relative = `${group.replace(/\./g, "/")}/${artifact}/${version}/${artifact}-${version}.pom`;
  const local = localMavenPackage(group, artifact, version);
  if (local) return readFileSync(path.join(local.repository, relative), "utf8");
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

async function collectMaven(treeFile, cacheDir, repoRoot, out) {
  localMavenRepositories = findLocalMavenRepositories(repoRoot);
  const coordinates = parseGradleTree(readFileSync(treeFile, "utf8"));
  if (coordinates.length === 0) throw new Error(`no resolved components in ${treeFile}`);
  const components = [];
  const repo = realpathSync(repoRoot);
  for (const coordinate of coordinates) {
    const [group, artifact, version] = coordinate.split(":");
    const { licenses, source } = await pomLicenses(cacheDir, group, artifact, version);
    const component = { name: `${group}:${artifact}`, version, licenses, licenseSource: source };
    // A module an npm package ships carries that package's own license files, copyright included.
    const local = localMavenPackage(group, artifact, version);
    if (local) {
      const pkg = packageEntry(
        readJson(path.join(local.packageDir, "package.json")),
        realpathSync(local.packageDir),
        repo,
      );
      component.noticeFrom = `${pkg.name}@${pkg.version}`;
      component.notices = pkg.licenseFiles.map(({ text }) => text);
    }
    components.push(component);
  }
  writeJson(out, { components });
  const missing = components.filter((item) => item.licenses.length === 0).length;
  console.log(`maven: ${components.length} components, ${missing} without a declared license`);
}

/** The license of the package a development pod comes from, through Podfile.lock's EXTERNAL SOURCES. */
function podPackageNotice(lock, name, iosDir, repo) {
  // Ruby's YAML reads the ":path" symbol key as "path"; accept both spellings. A pod declared by
  // its podspec file (":podspec") is found from that file's directory the same way.
  const external = lock["EXTERNAL SOURCES"]?.[name];
  const source =
    external?.path ?? external?.[":path"] ?? external?.podspec ?? external?.[":podspec"];
  if (!source) return null;
  for (let dir = path.resolve(iosDir, source); dir.startsWith(repo); dir = path.dirname(dir)) {
    const manifest = path.join(dir, "package.json");
    if (!existsSync(manifest) || !readJson(manifest).name) continue;
    const entry = packageEntry(readJson(manifest), realpathSync(dir), repo);
    const text = entry.licenseFiles.map((file) => file.text).join("\n\n");
    return text ? { license: entry.licenses.join(" AND "), text, from: entry.name } : null;
  }
  return null;
}

function collectPods(lockJsonFile, ackJsonFile, iosDir, repoRoot, out) {
  const repo = realpathSync(repoRoot);
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
      const fromPackage = podPackageNotice(lock, name, iosDir, repo);
      const notice = notices.get(name) ?? fromPackage;
      return {
        name,
        version,
        license: notice?.license || fromPackage?.license || "",
        text: notice?.text ?? null,
        sha256: notice ? sha256(notice.text) : null,
        noticeFrom: notices.has(name) ? "acknowledgements" : (fromPackage?.from ?? null),
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
  const own = (component.notices ?? []).map((text) => ctx.documentFor(text));
  let documentIds = own.length > 0 ? own : [...new Set(known)];
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

// Files that change with the list, read from the checkout it belongs to (the working directory).
const LICENSES_SECTION = "packages/app/src/screens/settings/woowtech-mobile-licenses-section.tsx";
const LICENSES_SPEC = "packages/app/e2e/browser/sidebar-help.spec.ts";
const EXPORT_BASELINES = [
  "woowtech/web/export-baseline.json",
  "woowtech/web/export-baseline.apporo.json",
];
// As woowtech/web/check-export.mjs reads URLs: the list's texts ship in the web export.
const URL_ORIGIN = /(?:https?|wss?):\/\/[A-Za-z0-9.-]+/g;
const SCRIPT_URL = /https?:\/\/[^\s"'<>`]+\.m?js\b/g;
const readIfExists = (file) => (existsSync(file) ? readFileSync(file, "utf8") : "");
const normalizeOrigin = (origin) => origin.replace(/[.-]+$/, "").toLowerCase();

/** The licenses test's page count, and the URLs in the texts the web export check would stop at. */
function changesWithTheList(next) {
  const changes = [];
  const pageSize = Number(/const PAGE_SIZE = (\d+);/.exec(readIfExists(LICENSES_SECTION))?.[1]);
  const expected = Number(/Page \d+ of (\d+)/.exec(readIfExists(LICENSES_SPEC))?.[1]);
  if (pageSize > 0 && expected > 0) {
    const pages = Math.ceil(next.entries.length / pageSize);
    if (pages !== expected) {
      changes.push(
        `${LICENSES_SPEC}: expects ${expected} pages, the list has ${pages} (${pageSize} a page)`,
      );
    }
  }
  const texts = Object.values(next.documents).join("\n");
  const origins = new Set([...texts.matchAll(URL_ORIGIN)].map(([url]) => normalizeOrigin(url)));
  const scripts = new Set([...texts.matchAll(SCRIPT_URL)].map(([url]) => url));
  for (const file of EXPORT_BASELINES.filter((name) => existsSync(name))) {
    const baseline = readJson(file);
    const known = new Set(baseline.origins.map(normalizeOrigin));
    for (const origin of [...origins].filter((item) => !known.has(item)).sort()) {
      changes.push(`${file}: add the origin ${origin}, which a license text names`);
    }
    for (const url of [...scripts].filter((item) => !baseline.scriptUrls.includes(item)).sort()) {
      changes.push(`${file}: add the script URL ${url}, which a license text names`);
    }
  }
  return changes;
}

function report(current, next, carried, review, changes) {
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
    ...section("Change with the list, then run CI with Playwright", changes),
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
  const changes = changesWithTheList(next);
  const { text, added, removed, changed } = report(current, next, carried, ctx.review, changes);
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
