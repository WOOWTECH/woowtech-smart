#!/usr/bin/env node
// Checks a web export of packages/app before deploy-web.sh uploads it to Cloudflare Pages
// (smart.woowtech.io, woowtech/README.md section 27). Exits 1 when a check fails, 2 on bad usage.
//
//   node woowtech/web/check-export.mjs <export dir> [--baseline <file>] [--write-baseline]
//
// - index.html is the only HTML file. It has no inline <script>, loads scripts only from this
//   site, and loads exactly one entry bundle (/_expo/static/js/web/index-*.js).
// - No 404.html, _redirects, _worker.js, _routes.json or functions/ (they change how Pages
//   serves the site), no source maps, no .env files, no symlinks, and no file named like a
//   service worker script: a deployment must never leave a worker behind (README section 27).
// - No file is over Pages' 25 MiB limit (23 MiB warns), and there are at most 20,000 files.
// - _headers is woowtech/web/_headers, with at most 100 rules and lines of 2,000 characters.
// - The bundle names our report receiver, relay and web app, and none of upstream's hosts or an
//   analytics or error-reporting service.
// - Against export-baseline.json (--baseline picks another file): no absolute http(s) origin and
//   no script URL the baseline does not list, and no more eval(, new Function(, importScripts(
//   or serviceWorker than it counts. An empty baseline fails: it has not been initialized.
//   --write-baseline writes what this export has into the baseline file, for a person to check
//   and commit (README section 27 lists what to look at). It writes nothing when another check
//   fails.
import { lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MiB = 1024 * 1024;
const MAX_FILE_BYTES = 25 * MiB;
const WARN_FILE_BYTES = 23 * MiB;
const MAX_FILES = 20_000;
const MAX_HEADER_RULES = 100;
const MAX_HEADER_LINE = 2000;

const HEADERS_SOURCE = fileURLToPath(new URL("_headers", import.meta.url));
const BASELINE_SOURCE = fileURLToPath(new URL("export-baseline.json", import.meta.url));

const ENTRY_BUNDLE = /^\/_expo\/static\/js\/web\/index-[^/]+\.js$/;
// Host names only: template strings such as `https://${HOST}` are not always folded into one
// literal by the minifier. The report URL is a JSON string inside the embedded app manifest.
const REQUIRED_STRINGS = [
  "https://reports.woowtech.io/v1/ai-content-reports",
  "relay.woowtech.io",
  "smart.woowtech.io",
  "woowtech smart",
];
// Not "segment.": react-navigation always has `current.segment.replace(...)`.
const FORBIDDEN_STRINGS = [
  "app.paseo.sh",
  "relay.paseo.sh",
  "getpaseo/paseo/main/CHANGELOG",
  "cloudflareinsights",
  "googletagmanager",
  "google-analytics",
  "posthog",
  "sentry.io",
  "cdn.segment.com",
  "cdn.segment.io",
  "api.segment.io",
];
const SINKS = ["eval(", "new Function(", "importScripts(", "serviceWorker"];
const ORIGIN = /https?:\/\/[A-Za-z0-9.-]+/g;
// Backticks end a URL too: template strings carry URLs as well.
const SCRIPT_URL = /https?:\/\/[^\s"'<>`]+\.m?js\b/g;
const CDN_URL =
  /https?:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com)\b[^\s"'<>`]*/gi;

function usage(message) {
  console.error(`check-export: ${message}`);
  console.error(
    "usage: node woowtech/web/check-export.mjs <export dir> [--baseline <file>] [--write-baseline]",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const options = { exportDir: null, baselinePath: BASELINE_SOURCE, writeBaseline: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--baseline") {
      index += 1;
      if (!argv[index]) usage("--baseline needs a file");
      options.baselinePath = path.resolve(argv[index]);
    } else if (arg === "--write-baseline") {
      options.writeBaseline = true;
    } else if (arg.startsWith("-") || options.exportDir) {
      usage(`unexpected argument ${arg}`);
    } else {
      options.exportDir = path.resolve(arg);
    }
  }
  if (!options.exportDir) usage("name the export directory");
  return options;
}

/** Every entry under `root`, as paths relative to it with "/" separators. */
function listExport(root) {
  const listing = { files: [], dirs: [], links: [] };
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const relative = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) listing.links.push(relative);
      else if (entry.isDirectory()) {
        listing.dirs.push(relative);
        walk(relative);
      } else listing.files.push(relative);
    }
  };
  walk("");
  return listing;
}

function forbiddenFileReason(relative) {
  const name = path.posix.basename(relative);
  if (name === "404.html") return "Pages would serve it instead of the app for unknown paths";
  if (["_redirects", "_worker.js", "_routes.json"].includes(name))
    return "it changes how Pages serves the site";
  if (relative === "functions" || relative.startsWith("functions/")) return "Pages Functions";
  if (name.endsWith(".map")) return "source maps are not published";
  if (name.startsWith(".env")) return "an .env file";
  if (/^sw(?:[-_.].*)?\.js$/i.test(name) || /^service-?worker.*\.js$/i.test(name)) {
    return "named like a service worker script";
  }
  if (/workbox/i.test(name)) return "named like a service worker (Workbox) file";
  return null;
}

function checkFiles(exportDir, listing, report) {
  for (const link of listing.links) report.fail(`${link} is a symlink`);
  for (const relative of [...listing.dirs, ...listing.files]) {
    const reason = forbiddenFileReason(relative);
    if (reason) report.fail(`${relative} must not be in the export: ${reason}`);
  }
  const html = listing.files.filter((file) => /\.html?$/i.test(file));
  if (html.length !== 1 || html[0] !== "index.html") {
    report.fail(`the export has ${html.length} HTML files (${html.join(", ")}); only index.html`);
  }
  if (listing.files.length > MAX_FILES) {
    report.fail(`the export has ${listing.files.length} files; Pages takes at most ${MAX_FILES}`);
  }
  const sizes = listing.files.map((file) => [file, lstatSync(path.join(exportDir, file)).size]);
  let sizeProblem = false;
  for (const [file, size] of sizes) {
    if (size > MAX_FILE_BYTES) {
      report.fail(`${file} is ${toMiB(size)} MiB, over Pages' 25 MiB limit for one file`);
      sizeProblem = true;
    } else if (size >= WARN_FILE_BYTES) {
      report.warn(`${file} is ${toMiB(size)} MiB, close to Pages' 25 MiB limit for one file`);
      sizeProblem = true;
    }
  }
  if (sizeProblem) report.sizeTable(sizes);
}

function toMiB(bytes) {
  return (bytes / MiB).toFixed(2);
}

function checkIndex(exportDir, listing, report) {
  if (!listing.files.includes("index.html")) {
    report.fail("index.html is missing");
    return;
  }
  const html = readFileSync(path.join(exportDir, "index.html"), "utf8");
  const sources = [];
  let inline = 0;
  for (const [, attributes] of html.matchAll(/<script\b([^>]*)>/gi)) {
    const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attributes);
    if (src) sources.push(src[1] ?? src[2] ?? src[3]);
    else inline += 1;
  }
  if (inline > 0) report.fail(`index.html has ${inline} inline <script> (no src)`);
  for (const source of sources) {
    if (!source.startsWith("/") || source.startsWith("//")) {
      report.fail(`index.html loads a script that is not on this site: ${source}`);
    }
  }
  const entries = sources.filter((source) => ENTRY_BUNDLE.test(source));
  if (entries.length !== 1) {
    report.fail(
      `index.html loads ${entries.length} entry bundles (/_expo/static/js/web/index-*.js), not 1`,
    );
  } else if (!listing.files.includes(entries[0].slice(1))) {
    report.fail(`index.html's entry bundle ${entries[0]} is not in the export`);
  }
}

function checkHeaders(exportDir, listing, report) {
  if (!listing.files.includes("_headers")) {
    report.fail("_headers is missing: deploy-web.sh copies woowtech/web/_headers into the export");
    return;
  }
  const exported = readFileSync(path.join(exportDir, "_headers"), "utf8");
  if (exported !== readFileSync(HEADERS_SOURCE, "utf8")) {
    report.fail("_headers is not woowtech/web/_headers");
  }
  const lines = exported.split("\n");
  const rules = lines.filter((line) => line.trim() && !/^\s/.test(line) && !line.startsWith("#"));
  if (rules.length > MAX_HEADER_RULES) {
    report.fail(`_headers has ${rules.length} rules; Pages reads at most ${MAX_HEADER_RULES}`);
  }
  const long = lines.filter((line) => line.length > MAX_HEADER_LINE).length;
  if (long > 0) report.fail(`_headers has ${long} lines over ${MAX_HEADER_LINE} characters`);
}

function countOccurrences(text, needle) {
  let count = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
    count += 1;
  }
  return count;
}

function normalizeOrigin(origin) {
  return origin.replace(/[.-]+$/, "").toLowerCase();
}

/** What the baseline tracks, from the export's scripts. */
function collect(scripts) {
  const origins = new Set();
  const scriptUrls = new Set();
  const sinks = Object.fromEntries(SINKS.map((sink) => [sink, 0]));
  for (const { text } of scripts) {
    for (const [origin] of text.matchAll(ORIGIN)) origins.add(normalizeOrigin(origin));
    for (const [url] of text.matchAll(SCRIPT_URL)) scriptUrls.add(url);
    for (const [url] of text.matchAll(CDN_URL)) scriptUrls.add(url);
    for (const sink of SINKS) sinks[sink] += countOccurrences(text, sink);
  }
  return { origins: [...origins].sort(), scriptUrls: [...scriptUrls].sort(), sinks };
}

function checkBundleStrings(scripts, report) {
  if (scripts.length === 0) report.fail("the export has no .js files");
  for (const needle of REQUIRED_STRINGS) {
    if (!scripts.some(({ text }) => text.includes(needle))) {
      report.fail(`the bundle does not contain "${needle}"`);
    }
  }
  for (const needle of FORBIDDEN_STRINGS) {
    const found = scripts.filter(({ text }) => text.includes(needle)).map(({ file }) => file);
    if (found.length > 0) report.fail(`"${needle}" is in ${found.join(", ")}`);
  }
}

function readBaseline(file) {
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    usage(`cannot read the baseline ${file}: ${error.message}`);
  }
  const strings = (value) =>
    Array.isArray(value) && value.every((item) => typeof item === "string");
  const counts =
    baseline?.sinks !== null &&
    typeof baseline?.sinks === "object" &&
    Object.values(baseline.sinks).every((value) => Number.isInteger(value) && value >= 0);
  if (!strings(baseline?.origins) || !strings(baseline?.scriptUrls) || !counts) {
    usage(`${file} is not a baseline: { "origins": [...], "scriptUrls": [...], "sinks": {...} }`);
  }
  return baseline;
}

function compareBaseline(found, baseline, file, report) {
  const empty =
    baseline.origins.length === 0 &&
    baseline.scriptUrls.length === 0 &&
    Object.keys(baseline.sinks).length === 0;
  if (empty) {
    report.fail(
      `the baseline ${file} is not initialized (it is empty). After a real dry run, write it ` +
        "with --write-baseline, check it (woowtech/README.md section 27) and commit it.",
    );
    return;
  }
  const added = (current, known) => current.filter((item) => !known.includes(item));
  const newOrigins = added(found.origins, baseline.origins);
  if (newOrigins.length > 0) report.fail(`origins not in the baseline: ${newOrigins.join(" ")}`);
  const newScripts = added(found.scriptUrls, baseline.scriptUrls);
  if (newScripts.length > 0)
    report.fail(`script URLs not in the baseline: ${newScripts.join(" ")}`);
  for (const sink of SINKS) {
    const allowed = baseline.sinks[sink] ?? 0;
    if (found.sinks[sink] > allowed) {
      report.fail(`"${sink}" appears ${found.sinks[sink]} times; the baseline allows ${allowed}`);
    } else if (found.sinks[sink] < allowed) {
      report.note(`"${sink}" appears ${found.sinks[sink]} times; the baseline allows ${allowed}`);
    }
  }
  const gone = [
    ...added(baseline.origins, found.origins),
    ...added(baseline.scriptUrls, found.scriptUrls),
  ];
  if (gone.length > 0) report.note(`in the baseline but not in this export: ${gone.join(" ")}`);
}

function createReport() {
  const report = { failures: [], warnings: [], notes: [], sizes: null };
  report.fail = (message) => report.failures.push(message);
  report.warn = (message) => report.warnings.push(message);
  report.note = (message) => report.notes.push(message);
  report.sizeTable = (sizes) => {
    report.sizes = [...sizes].sort((a, b) => b[1] - a[1]).slice(0, 10);
  };
  return report;
}

function printReport(report) {
  for (const message of report.notes) console.log(`check-export: note: ${message}`);
  for (const message of report.warnings) console.log(`check-export: warning: ${message}`);
  if (report.sizes) {
    console.log("check-export: largest files (MiB):");
    for (const [file, size] of report.sizes) console.log(`  ${toMiB(size).padStart(8)}  ${file}`);
  }
  for (const message of report.failures) console.error(`check-export: FAIL: ${message}`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = createReport();
  let listing;
  try {
    listing = listExport(options.exportDir);
  } catch (error) {
    usage(`cannot read ${options.exportDir}: ${error.message}`);
  }
  checkFiles(options.exportDir, listing, report);
  checkIndex(options.exportDir, listing, report);
  checkHeaders(options.exportDir, listing, report);
  const scripts = listing.files
    .filter((file) => /\.m?js$/.test(file))
    .map((file) => ({ file, text: readFileSync(path.join(options.exportDir, file), "utf8") }));
  checkBundleStrings(scripts, report);
  const found = collect(scripts);
  if (options.writeBaseline) {
    printReport(report);
    if (report.failures.length > 0) {
      console.error("check-export: the baseline was not written: fix the failures above first");
      process.exit(1);
    }
    writeFileSync(options.baselinePath, `${JSON.stringify(found, null, 2)}\n`);
    console.log(
      `check-export: wrote ${options.baselinePath}: ${found.origins.length} origins, ` +
        `${found.scriptUrls.length} script URLs, sinks ${JSON.stringify(found.sinks)}. Check every ` +
        "script URL and the serviceWorker count (woowtech/README.md section 27), then format " +
        "and commit it: npm run format:files -- woowtech/web/export-baseline.json",
    );
    return;
  }
  compareBaseline(found, readBaseline(options.baselinePath), options.baselinePath, report);
  printReport(report);
  if (report.failures.length > 0) {
    console.error(`check-export: ${report.failures.length} problems in ${options.exportDir}`);
    process.exit(1);
  }
  console.log(
    `check-export: ok: ${listing.files.length} files, ${found.origins.length} origins, ` +
      `${found.scriptUrls.length} script URLs, sinks ${JSON.stringify(found.sinks)}`,
  );
}

main();
