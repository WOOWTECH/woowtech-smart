#!/usr/bin/env node
// Checks a web export of packages/app before deploy-web.sh uploads it to Cloudflare Pages
// (smart.woowtech.io, woowtech/README.md section 27). Exits 1 when a check fails, 2 on bad usage.
//
//   node woowtech/web/check-export.mjs <export dir> [--baseline <file>] [--write-baseline]
//
// - index.html is the only HTML file. Every <script> in it has an attribute named exactly src (a
//   data-src does not count), no tag has an on* attribute or a javascript: URL, and each script
//   URL, resolved against https://smart.woowtech.io, is on this site or in the baseline. Exactly
//   one of them is the entry bundle (/_expo/static/js/web/index-*.js).
// - JavaScript is only in _expo/static/js/web/. No 404.html, _redirects, _worker.js, _routes.json
//   or functions/ (they change how Pages serves the site), no source maps, no .env files, no
//   symlinks, and no file named like a service worker script: a deployment must never leave a
//   worker behind (README section 27).
// - Every other file is a kind of data Expo exports: an image, font, sound, video, CSS, JSON or
//   text file (ALLOWED_EXTENSIONS). Anything else (an .svg or .xml document can hold a script, a
//   .wasm file is code, a file without an extension is unknown) fails unless the baseline lists
//   its path and SHA-256 under "files".
// - No file is over Pages' 25 MiB limit (23 MiB warns), and there are at most 20,000 files.
// - _headers is woowtech/web/_headers, with at most 100 rules and lines of 2,000 characters.
// - The bundle names our report receiver, relay and web app, and none of upstream's hosts or an
//   analytics or error-reporting service.
// - Against export-baseline.json (--baseline picks another file): no absolute http(s) or ws(s)
//   origin and no script URL the baseline does not list, and eval(, new Function(, importScripts(
//   and serviceWorker appear exactly as often as it counts, up or down: a count that may only
//   fall leaves room for a later addition. An empty baseline fails: it has not been initialized.
//   --write-baseline writes what this export has into the baseline file, for a person to check
//   and commit (README section 27 lists what to look at). It writes nothing when another check
//   fails.
import { createHash } from "node:crypto";
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

// The address of the site. deploy-web.sh's SITE_ORIGIN and BRAND_WEB_APP say the same
// (woowtech/web-deploy.test.mjs checks that).
const SITE_ORIGIN = "https://smart.woowtech.io";
const JS_DIR = "_expo/static/js/web/";
const ENTRY_BUNDLE = /^\/_expo\/static\/js\/web\/index-[^/]+\.js$/;
// What Expo exports besides code: images, fonts, sounds, video, styles, JSON and text. Not .svg,
// .xml, .xhtml or .wasm (documents and code), and nothing without an extension. A real export
// of the upstream app holds .png, .ico, .css, .json and .txt.
const ALLOWED_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico",
  "ttf",
  "otf",
  "woff",
  "woff2",
  "wav",
  "mp3",
  "ogg",
  "m4a",
  "mp4",
  "webm",
  "css",
  "json",
  "txt",
]);
const SCRIPT_EXTENSIONS = new Set(["js", "mjs", "cjs"]);
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
// ws and wss too: connect-src allows any host for them.
const ORIGIN = /(?:https?|wss?):\/\/[A-Za-z0-9.-]+/g;
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

const extensionOf = (relative) => path.posix.extname(relative).slice(1).toLowerCase();

/** The files whose type is not on the list above, which the baseline has to name. */
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
  const unlisted = [];
  for (const relative of listing.files) {
    if (relative === "_headers" || relative === "index.html" || forbiddenFileReason(relative)) {
      continue;
    }
    const extension = extensionOf(relative);
    if (SCRIPT_EXTENSIONS.has(extension)) {
      if (extension !== "js" || !relative.startsWith(JS_DIR)) {
        report.fail(
          `${relative} must not be in the export: JavaScript belongs only in ${JS_DIR}, as .js`,
        );
      }
    } else if (!/^html?$/.test(extension) && !ALLOWED_EXTENSIONS.has(extension)) {
      unlisted.push(relative);
    }
  }
  return unlisted;
}

function toMiB(bytes) {
  return (bytes / MiB).toFixed(2);
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** The tags of an HTML text, with their attributes: quoted values may hold ">". */
function parseTags(html) {
  const tags = [];
  const tag = /<([A-Za-z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  const attribute = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const [, name, rest] of html.matchAll(tag)) {
    const attributes = [];
    for (const [, key, double, single, bare] of rest.matchAll(attribute)) {
      attributes.push([key.toLowerCase(), double ?? single ?? bare ?? ""]);
    }
    tags.push({ name: name.toLowerCase(), attributes });
  }
  return tags;
}

/** An attribute value with the character references a browser reads before it reads the URL. */
function decodeReferences(value) {
  const code = (digits, radix) => {
    try {
      return String.fromCodePoint(Number.parseInt(digits, radix));
    } catch {
      return "";
    }
  };
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, digits) => code(digits, 16))
    .replace(/&#(\d+);?/g, (_, digits) => code(digits, 10))
    .replace(/&colon;/gi, ":")
    .replace(/&tab;/gi, "\t")
    .replace(/&newline;/gi, "\n");
}

function isJavascriptUrl(value) {
  // URL parsing drops control characters and spaces before the scheme, and tabs and newlines in it.
  const plain = [...decodeReferences(value)]
    .filter((char) => {
      const code = char.codePointAt(0);
      return code > 0x20 && (code < 0x7f || code > 0x9f);
    })
    .join("");
  return plain.toLowerCase().startsWith("javascript:");
}

function checkIndex(exportDir, listing, baseline, report) {
  if (!listing.files.includes("index.html")) {
    report.fail("index.html is missing");
    return;
  }
  const html = readFileSync(path.join(exportDir, "index.html"), "utf8");
  const sources = [];
  let inline = 0;
  for (const tag of parseTags(html)) {
    for (const [name, value] of tag.attributes) {
      if (name.startsWith("on")) {
        report.fail(`index.html has an event handler attribute, ${name}, on <${tag.name}>`);
      }
      if (isJavascriptUrl(value)) {
        report.fail(`index.html has a javascript: URL in ${name} on <${tag.name}>`);
      }
    }
    if (tag.name !== "script") continue;
    const src = tag.attributes.find(([name]) => name === "src");
    if (src) sources.push(src[1]);
    else inline += 1;
  }
  if (inline > 0) report.fail(`index.html has ${inline} inline <script> (no src attribute)`);
  const entries = [];
  for (const source of sources) {
    let url;
    try {
      url = new URL(source, SITE_ORIGIN);
    } catch {
      report.fail(`index.html loads a script whose address is not a URL: ${source}`);
      continue;
    }
    if (url.origin !== SITE_ORIGIN) {
      if (!baseline.scriptUrls.includes(url.href)) {
        report.fail(`index.html loads a script that is not on this site: ${source}`);
      }
    } else if (ENTRY_BUNDLE.test(url.pathname)) {
      entries.push(url.pathname);
    }
  }
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

/** What the baseline tracks: the scripts' origins, script URLs and sinks, and the odd files. */
function collect(exportDir, scripts, unlisted) {
  const origins = new Set();
  const scriptUrls = new Set();
  const sinks = Object.fromEntries(SINKS.map((sink) => [sink, 0]));
  for (const { text } of scripts) {
    for (const [origin] of text.matchAll(ORIGIN)) origins.add(normalizeOrigin(origin));
    for (const [url] of text.matchAll(SCRIPT_URL)) scriptUrls.add(url);
    for (const [url] of text.matchAll(CDN_URL)) scriptUrls.add(url);
    for (const sink of SINKS) sinks[sink] += countOccurrences(text, sink);
  }
  const files = Object.fromEntries(
    [...unlisted].sort().map((file) => [file, sha256(readFileSync(path.join(exportDir, file)))]),
  );
  return { origins: [...origins].sort(), scriptUrls: [...scriptUrls].sort(), sinks, files };
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
  const files =
    baseline?.files === undefined ||
    (baseline.files !== null &&
      typeof baseline.files === "object" &&
      Object.values(baseline.files).every(
        (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value),
      ));
  if (!strings(baseline?.origins) || !strings(baseline?.scriptUrls) || !counts || !files) {
    usage(
      `${file} is not a baseline: { "origins": [...], "scriptUrls": [...], "sinks": {...}, "files": {...} }`,
    );
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
      report.fail(
        `"${sink}" appears ${found.sinks[sink]} times, fewer than the ${allowed} the baseline counts: ` +
          "after checking why, lower the baseline (a count that may only fall leaves room for a later addition)",
      );
    }
  }
  const known = baseline.files ?? {};
  for (const [relative, hash] of Object.entries(found.files)) {
    if (!(relative in known)) {
      report.fail(
        `${relative} is a kind of file this check does not allow (${extensionOf(relative) ? `.${extensionOf(relative)}` : "no extension"}): ` +
          "if it belongs in the export, check it and list its path and SHA-256 in the baseline's files",
      );
    } else if (known[relative] !== hash) {
      report.fail(
        `${relative} is not the file the baseline lists (SHA-256 ${hash}, not ${known[relative]})`,
      );
    }
  }
  const gone = [
    ...added(baseline.origins, found.origins),
    ...added(baseline.scriptUrls, found.scriptUrls),
    ...Object.keys(known).filter((relative) => !(relative in found.files)),
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
  // Writing the baseline starts from an empty one: nothing outside the export may excuse it.
  const baseline = options.writeBaseline
    ? { origins: [], scriptUrls: [], sinks: {}, files: {} }
    : readBaseline(options.baselinePath);
  const unlisted = checkFiles(options.exportDir, listing, report);
  checkIndex(options.exportDir, listing, baseline, report);
  checkHeaders(options.exportDir, listing, report);
  const scripts = listing.files
    .filter((file) => /\.(?:m|c)?js$/.test(file))
    .map((file) => ({ file, text: readFileSync(path.join(options.exportDir, file), "utf8") }));
  checkBundleStrings(scripts, report);
  const found = collect(options.exportDir, scripts, unlisted);
  if (options.writeBaseline) {
    printReport(report);
    if (report.failures.length > 0) {
      console.error("check-export: the baseline was not written: fix the failures above first");
      process.exit(1);
    }
    writeFileSync(options.baselinePath, `${JSON.stringify(found, null, 2)}\n`);
    console.log(
      `check-export: wrote ${options.baselinePath}: ${found.origins.length} origins, ` +
        `${found.scriptUrls.length} script URLs, sinks ${JSON.stringify(found.sinks)}, ` +
        `${Object.keys(found.files).length} listed files. Check every script URL, the ` +
        "serviceWorker count and every listed file (woowtech/README.md section 27), then format " +
        "and commit it: npm run format:files -- woowtech/web/export-baseline.json",
    );
    return;
  }
  compareBaseline(found, baseline, options.baselinePath, report);
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
