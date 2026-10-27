#!/usr/bin/env node
// Compares a deployed site with the export it was uploaded from (woowtech/README.md section 27).
// deploy-web.sh runs it after every upload; run it by hand after attaching the custom domain.
//
//   node woowtech/web/verify-live.mjs <base url> <export dir> [--allow-access]
//
// 1. GET / and GET /settings/general (the SPA fallback) answer 200 text/html with exactly the
//    export's index.html.
// 2. Both carry the export's _headers for /*: the same Content-Security-Policy, X-Frame-Options,
//    Strict-Transport-Security, Cross-Origin-Opener-Policy, Referrer-Policy and
//    Permissions-Policy values, and a Cache-Control with no-transform.
// 3. Every other exported file (not _headers) answers 200 at its own path with the same SHA-256.
//    Files under /_expo/static/ have no no-transform in Cache-Control. This finds a Worker route
//    or zone setting that changes the content while it runs, not one that changes it for only
//    some visitors.
// 4. /_headers does not serve the _headers file itself.
// 5. Neither page has challenge-platform, cloudflareinsights or /cdn-cgi/ in it.
//
// --allow-access: a preview deployment behind Cloudflare Access redirects to the Access login;
// the checks are then skipped instead of failed.
//
// Prints a JSON summary. Exits 1 when a check fails, 2 on bad usage.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const PAGES = ["/", "/settings/general"];
const EXACT_HEADERS = [
  "content-security-policy",
  "x-frame-options",
  "strict-transport-security",
  "cross-origin-opener-policy",
  "referrer-policy",
  "permissions-policy",
];
const INJECTED = ["challenge-platform", "cloudflareinsights", "/cdn-cgi/"];
const TIMEOUT_MS = 30_000;
const PARALLEL = 8;

function usage(message) {
  console.error(`verify-live: ${message}`);
  console.error(
    "usage: node woowtech/web/verify-live.mjs <base url> <export dir> [--allow-access]",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const positional = argv.filter((arg) => arg !== "--allow-access");
  const unknown = positional.find((arg) => arg.startsWith("-"));
  if (unknown) usage(`unexpected argument ${unknown}`);
  if (positional.length !== 2) usage("give the base URL and the export directory");
  let base;
  try {
    base = new URL(positional[0]);
  } catch {
    usage(`not a URL: ${positional[0]}`);
  }
  if (base.protocol !== "https:" && base.protocol !== "http:")
    usage("the base URL must be http(s)");
  return {
    origin: base.origin,
    exportDir: path.resolve(positional[1]),
    allowAccess: argv.includes("--allow-access"),
  };
}

/** The headers _headers sets for /*, by lowercase name. */
function rootHeaders(headersFile) {
  const headers = new Map();
  let inRoot = false;
  for (const line of headersFile.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      inRoot = line.trim() === "/*";
    } else if (inRoot && !line.trim().startsWith("!")) {
      const colon = line.indexOf(":");
      headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
    }
  }
  return headers;
}

function listFiles(root, dir = "") {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = dir ? `${dir}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listFiles(root, relative) : [relative];
  });
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function get(origin, pathname) {
  const url = `${origin}${pathname}`;
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = Buffer.from(await response.arrayBuffer());
  return { url, status: response.status, headers: response.headers, body };
}

function behindAccess(response) {
  if (response.status < 300 || response.status >= 400) return false;
  const location = response.headers.get("location") ?? "";
  try {
    return new URL(location, response.url).hostname.endsWith(".cloudflareaccess.com");
  } catch {
    return false;
  }
}

function checkPage(response, expected, failures) {
  const where = response.url;
  if (response.status !== 200) {
    failures.push(`${where}: status ${response.status}, not 200`);
    return;
  }
  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith("text/html")) failures.push(`${where}: content-type ${type}, not text/html`);
  if (!response.body.equals(expected.index)) {
    failures.push(`${where}: the body is not the export's index.html`);
  }
  for (const name of EXACT_HEADERS) {
    const want = expected.headers.get(name);
    const got = response.headers.get(name);
    if (want === undefined) failures.push(`_headers does not set ${name} for /*`);
    else if (got !== want)
      failures.push(`${where}: ${name} is ${JSON.stringify(got)}, not the _headers value`);
  }
  const cacheControl = response.headers.get("cache-control") ?? "";
  if (!cacheControl.includes("no-transform")) {
    failures.push(`${where}: cache-control ${JSON.stringify(cacheControl)} has no no-transform`);
  }
  const text = response.body.toString("utf8");
  for (const needle of INJECTED) {
    if (text.includes(needle)) failures.push(`${where}: has ${needle} (injected into the page)`);
  }
}

async function checkFile(origin, exportDir, relative, failures) {
  const pathname = `/${relative.split("/").map(encodeURIComponent).join("/")}`;
  const response = await get(origin, pathname);
  if (response.status !== 200) {
    failures.push(`${response.url}: status ${response.status}, not 200`);
    return;
  }
  if (sha256(response.body) !== sha256(readFileSync(path.join(exportDir, relative)))) {
    failures.push(`${response.url}: the content is not the exported file's`);
  }
  if (relative.startsWith("_expo/static/")) {
    const cacheControl = response.headers.get("cache-control") ?? "";
    if (cacheControl.includes("no-transform")) {
      failures.push(`${response.url}: cache-control has no-transform: ${cacheControl}`);
    }
  }
}

async function checkFiles(origin, exportDir, files, failures) {
  const queue = [...files];
  const worker = async () => {
    for (let relative = queue.shift(); relative !== undefined; relative = queue.shift()) {
      try {
        await checkFile(origin, exportDir, relative, failures);
      } catch (error) {
        failures.push(`/${relative}: ${error.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
}

async function main() {
  const { origin, exportDir, allowAccess } = parseArgs(process.argv.slice(2));
  let headersFile;
  let index;
  try {
    headersFile = readFileSync(path.join(exportDir, "_headers"), "utf8");
    index = readFileSync(path.join(exportDir, "index.html"));
  } catch (error) {
    usage(`${exportDir} is not a checked export (index.html and _headers): ${error.message}`);
  }
  const expected = { index, headers: rootHeaders(headersFile) };
  const failures = [];
  const pages = [];
  for (const pathname of PAGES) {
    let response;
    try {
      response = await get(origin, pathname);
    } catch (error) {
      failures.push(`${origin}${pathname}: ${error.message}`);
      continue;
    }
    if (allowAccess && behindAccess(response)) {
      console.log(JSON.stringify({ base: origin, ok: true, skipped: "behind Cloudflare Access" }));
      return;
    }
    pages.push(response);
    checkPage(response, expected, failures);
  }
  try {
    const headersResponse = await get(origin, "/_headers");
    if (headersResponse.body.toString("utf8") === headersFile) {
      failures.push(`${headersResponse.url}: serves the _headers file itself`);
    }
  } catch (error) {
    failures.push(`${origin}/_headers: ${error.message}`);
  }
  const files = listFiles(exportDir).filter((file) => file !== "_headers" && file !== "index.html");
  await checkFiles(origin, exportDir, files, failures);
  const summary = {
    base: origin,
    ok: failures.length === 0,
    pages: pages.map((page) => ({ url: page.url, status: page.status })),
    files: files.length,
    failures,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length > 0) process.exit(1);
}

await main();
