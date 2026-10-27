#!/usr/bin/env node
// Smoke test of the hosted web app in Chrome (woowtech/README.md section 27): pairing with the
// confirmation sheet, the address bar, a direct connection, the report receiver's CORS, the
// changelog, no automatic localhost probe on a public https page, and no service worker.
// Scenarios S1-S10 are the spec's (web-server-20261026/web-spec.md, 7.3 and 7.4).
//
//   node woowtech/web/hosted-web-smoke.mjs --base <url> --pair-url <pairing link>
//     [--direct <host:port>] [--grant-local-network] [--report-mock] [--headed]
//
// --base       the site; https://smart.woowtech.io by default. The local E2E serves the export
//              at http://127.0.0.1:8788 (`wrangler pages dev`).
// --pair-url   a pairing link from `woowtech-smart daemon pair` (https://smart.woowtech.io/#offer=...).
//              S2 pastes it whole; the other scenarios open <base>/#offer=<its payload>.
// --direct     a daemon to add as a direct connection (S5), such as 127.0.0.1:6791.
// --grant-local-network  grants Chrome's local-network-access permission (loopback included).
// --report-mock  answers the report receiver inside the browser (S6); without it S6 sends {} to
//              the real receiver, which answers 400 without storing anything (V6).
// --headed     a visible window: use it when S2 sees Connect stay disabled (headless focus).
//
// On a public https page (S1, S8) any request or WebSocket to a loopback host (any port), 0.0.0.0,
// a private, shared (Tailscale), link-local or unique-local address or a .local name fails
// before anyone has pressed anything: a probe of localhost:6767 or of the LAN would pass a check
// that only looks for localhost:6770. The pairing link is a credential: "#offer=..." and the link
// itself are replaced by [redacted] in the summary and in error messages.
//
// Uses playwright-core with the installed Google Chrome (channel "chrome"). Prints a JSON
// summary and exits 1 when a scenario fails, 2 on bad usage.
import { randomBytes } from "node:crypto";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE = "https://smart.woowtech.io";
const REPORT_URL = "https://reports.woowtech.io/v1/ai-content-reports";
const RELAY_HOST = "relay.woowtech.io";
const CHANGELOG_HOST = "raw.githubusercontent.com";
const REGISTRY_KEY = "@paseo:daemon-registry";
// Pairing credentials that must not reach the summary: filled in once the link is parsed.
const SECRETS = [];
// B2: Connect arms after the sheet has been visible and focused for 1000 ms.
const ARMING_MS = 1000;

function usage(message) {
  console.error(`hosted-web-smoke: ${message}`);
  console.error(
    "usage: node woowtech/web/hosted-web-smoke.mjs --base <url> --pair-url <link> " +
      "[--direct <host:port>] [--grant-local-network] [--report-mock] [--headed]",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const options = {
    base: DEFAULT_BASE,
    pairUrl: null,
    direct: null,
    grantLocalNetwork: false,
    reportMock: false,
    headed: false,
  };
  const valued = { "--base": "base", "--pair-url": "pairUrl", "--direct": "direct" };
  const flags = {
    "--grant-local-network": "grantLocalNetwork",
    "--report-mock": "reportMock",
    "--headed": "headed",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (valued[arg]) {
      index += 1;
      if (!argv[index]) usage(`${arg} needs a value`);
      options[valued[arg]] = argv[index];
    } else if (flags[arg]) {
      options[flags[arg]] = true;
    } else {
      usage(`unexpected argument ${arg}`);
    }
  }
  return validate(options);
}

function validate(options) {
  let base;
  try {
    base = new URL(options.base);
  } catch {
    usage(`--base is not a URL: ${options.base}`);
  }
  if (!options.pairUrl) usage("--pair-url is required");
  const offer = decodeOffer(options.pairUrl);
  if (options.direct && !/^(?:\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):\d{1,5}$/.test(options.direct)) {
    usage(`--direct must be host:port, not ${options.direct}`);
  }
  SECRETS.push(options.pairUrl, offer.payload);
  return { ...options, base: base.origin, offer };
}

/** The offer of a pairing link: everything after the first "#offer=", as base64url JSON. */
function decodeOffer(link) {
  const marker = "#offer=";
  const at = link.indexOf(marker);
  if (at === -1) usage("--pair-url has no #offer=");
  const payload = link.slice(at + marker.length).trim();
  let offer;
  try {
    offer = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    usage("--pair-url's #offer= is not base64url JSON");
  }
  if (typeof offer?.serverId !== "string" || typeof offer?.daemonPublicKeyB64 !== "string") {
    usage("--pair-url's offer has no serverId or daemonPublicKeyB64");
  }
  return { payload, value: offer };
}

function encodeOffer(offer) {
  return Buffer.from(JSON.stringify(offer), "utf8").toString("base64url");
}

function isPublicHttps(base) {
  const url = new URL(base);
  return url.protocol === "https:" && !isLocalOrPrivateHost(url.hostname);
}

function isLocalIpv4([first, second]) {
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isLocalIpv6(host) {
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (mapped) {
    const high = Number.parseInt(mapped[1], 16);
    const low = Number.parseInt(mapped[2], 16);
    return isLocalIpv4([high >> 8, high & 255, low >> 8, low & 255]);
  }
  return (
    host === "::1" ||
    host === "::" ||
    /^f[cd][0-9a-f]{2}:/.test(host) ||
    /^fe[89ab][0-9a-f]:/.test(host)
  );
}

/**
 * A host a public page has no reason to reach before anyone presses anything: loopback (any
 * port), 0.0.0.0, a private (RFC 1918), shared (RFC 6598, Tailscale), link-local or unique-local
 * address, or a .local name. `hostname` is URL.hostname, so IPv6 comes in brackets.
 */
export function isLocalOrPrivateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host.includes(":")) return isLocalIpv6(host);
  const octets = host.split(".");
  if (octets.length !== 4 || !octets.every((octet) => /^\d{1,3}$/.test(octet))) return false;
  return isLocalIpv4(octets.map(Number));
}

function isLoopbackHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

/** `text` with the pairing link, its payload and every "#offer=..." replaced. */
export function redact(text, secrets = SECRETS) {
  let redacted = String(text);
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted.replace(/#offer=[^\s"'<>),\]\\]+/g, "#offer=[redacted]");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function poll(check, { timeout, interval = 200 }) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() >= deadline) return value;
    await sleep(interval);
  }
}

// Runs in the page before the app: Content-Security-Policy violations the page reports.
function recordCspViolations() {
  window.__woowtechCsp = [];
  window.addEventListener(
    "securitypolicyviolation",
    (event) => {
      window.__woowtechCsp.push(`${event.violatedDirective} ${event.blockedURI}`);
    },
    true,
  );
}

/** What a page loads: request URLs, WebSockets (with frames received), and CSP messages. */
function watch(page) {
  const seen = { requests: [], sockets: [], cspConsole: [], responses: [] };
  page.on("request", (request) => seen.requests.push(request.url()));
  page.on("response", (response) => seen.responses.push(response));
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) seen.cspConsole.push(message.text());
  });
  page.on("websocket", (socket) => {
    const entry = { url: socket.url(), frames: 0, closed: false };
    seen.sockets.push(entry);
    socket.on("framereceived", () => {
      entry.frames += 1;
    });
    socket.on("close", () => {
      entry.closed = true;
    });
  });
  return seen;
}

async function cspViolations(page, seen) {
  const reported = await page.evaluate(() => window.__woowtechCsp ?? []).catch(() => []);
  return [...reported, ...seen.cspConsole];
}

async function registry(page) {
  const raw = await page.evaluate((key) => localStorage.getItem(key), REGISTRY_KEY);
  try {
    return JSON.parse(raw ?? "[]");
  } catch {
    return [];
  }
}

async function savedHost(page, serverId) {
  return (await registry(page)).find((host) => host?.serverId === serverId) ?? null;
}

async function isDisabled(locator) {
  return locator.evaluate(
    (element) =>
      element.getAttribute("aria-disabled") === "true" ||
      element.hasAttribute("disabled") ||
      element.closest('[aria-disabled="true"]') !== null,
  );
}

/** A real press on Connect once B2 armed it: focus, 1 s, a pointermove over it, then a click. */
async function pressConnect(page) {
  const connect = page.getByTestId("host-confirmation-connect");
  await page.bringToFront();
  await sleep(ARMING_MS + 300);
  const box = await connect.boundingBox();
  if (!box) throw new Error("host-confirmation-connect has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x - 8, y - 3);
  await page.mouse.move(x, y, { steps: 5 });
  const enabled = await poll(
    async () => {
      await page.mouse.move(x + 1, y);
      await page.mouse.move(x, y);
      return !(await isDisabled(connect));
    },
    { timeout: 5000 },
  );
  if (!enabled) {
    throw new Error("Connect stayed disabled after arming (headless focus? run with --headed)");
  }
  await page.mouse.down();
  await page.mouse.up();
}

async function newContext(browser, options, contextOptions = {}) {
  const context = await browser.newContext({
    // English labels whatever this machine's language is (S7 clicks "About").
    locale: "en-US",
    ...contextOptions,
    ...(options.grantLocalNetwork ? { permissions: ["local-network-access"] } : {}),
  });
  await context.addInitScript(recordCspViolations);
  return context;
}

async function openPage(context, url) {
  const page = await context.newPage();
  const seen = watch(page);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return { page, seen };
}

async function waitForWelcome(page) {
  await page.getByTestId("welcome-screen").waitFor({ state: "visible", timeout: 15_000 });
}

/**
 * Hosts a page reached (S1): `unexpected` are hosts beyond the site, our relay and receiver and the
 * changelog. `local` are loopback or private addresses; a public page may not reach any, while the
 * local E2E page (http://127.0.0.1) reaches its own daemon and is not asked.
 */
export function classifyHosts(urls, base) {
  const site = new URL(base);
  const allowed = new Set([site.host, RELAY_HOST, CHANGELOG_HOST, "reports.woowtech.io"]);
  const checkLocal = isPublicHttps(base);
  const unexpected = new Set();
  const local = new Set();
  for (const url of urls) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (!/^(?:https?|wss?):$/.test(parsed.protocol)) continue;
    if (allowed.has(parsed.host)) continue;
    if (checkLocal && isLocalOrPrivateHost(parsed.hostname)) local.add(parsed.host);
    else if (!isLoopbackHost(parsed.hostname)) unexpected.add(parsed.host);
  }
  return { unexpected: [...unexpected], local: [...local] };
}

function relaySocket(seen, serverId) {
  return seen.sockets.find((socket) => {
    const url = new URL(socket.url);
    return (
      url.hostname === RELAY_HOST &&
      url.searchParams.get("serverId") === serverId &&
      url.searchParams.get("role") === "client" &&
      socket.frames > 0
    );
  });
}

async function s1(browser, options) {
  const context = await newContext(browser, options);
  try {
    const { page, seen } = await openPage(context, `${options.base}/`);
    await waitForWelcome(page);
    await sleep(3000);
    const csp = await cspViolations(page, seen);
    const { unexpected, local } = classifyHosts(
      [...seen.requests, ...seen.sockets.map((s) => s.url)],
      options.base,
    );
    return {
      ok: csp.length === 0 && unexpected.length === 0 && local.length === 0,
      csp,
      unexpectedHosts: unexpected,
      localRequests: local,
    };
  } finally {
    await context.close();
  }
}

// When S2 pairs, it hands its context to S10, which opens a forged link against the saved host.
async function s2(browser, options, state) {
  const context = await newContext(browser, options);
  let result;
  try {
    result = await pastePairingLink(context, options);
  } finally {
    if (result?.ok) state.pairedContext = context;
    else await context.close();
  }
  return result;
}

async function pastePairingLink(context, options) {
  const { page, seen } = await openPage(context, `${options.base}/`);
  const { serverId } = options.offer.value;
  await waitForWelcome(page);
  await page.getByTestId("welcome-paste-pairing-link").click();
  await page.getByTestId("pair-link-input").fill(options.pairUrl);
  await page.getByTestId("pair-link-submit").click();
  const sheet = page.getByTestId("host-confirmation");
  await sheet.waitFor({ state: "visible", timeout: 15_000 });
  const shownAt = Date.now();
  const shownServerId = (
    await page.getByTestId("host-confirmation-server-id").textContent()
  )?.trim();
  const connect = page.getByTestId("host-confirmation-connect");
  const disabledAtFirst = await isDisabled(connect);
  await sleep(Math.max(0, shownAt + 500 - Date.now()));
  await connect.dispatchEvent("click");
  await sleep(300);
  const syntheticClickIgnored = (await sheet.isVisible()) && !(await savedHost(page, serverId));
  await pressConnect(page);
  await sheet.waitFor({ state: "hidden", timeout: 10_000 });
  const saved = await poll(() => savedHost(page, serverId), { timeout: 10_000 });
  const online = await poll(() => relaySocket(seen, serverId), { timeout: 30_000 });
  return {
    ok:
      shownServerId === serverId && disabledAtFirst && syntheticClickIgnored && !!saved && !!online,
    shownServerId,
    disabledAtFirst,
    syntheticClickIgnored,
    saved: !!saved,
    onlineThroughRelay: !!online,
  };
}

async function confirmationCount(page) {
  return page.getByTestId("host-confirmation").count();
}

async function s3(browser, options) {
  const { serverId } = options.offer.value;
  const context = await newContext(browser, options);
  try {
    const { page } = await openPage(context, `${options.base}/#offer=${options.offer.payload}`);
    const sheet = page.getByTestId("host-confirmation");
    await sheet.waitFor({ state: "visible", timeout: 15_000 });
    const hashCleared = await poll(() => page.evaluate(() => location.hash === ""), {
      timeout: 1000,
    });
    for (let count = 0; count < 5; count += 1)
      await page.evaluate(() => window.postMessage("x", "*"));
    await sleep(500);
    const oneQuestion = (await confirmationCount(page)) === 1;
    const sameServerId =
      (await page.getByTestId("host-confirmation-server-id").textContent())?.trim() === serverId;
    await page.getByTestId("host-confirmation-cancel").click();
    await sheet.waitFor({ state: "hidden", timeout: 10_000 });
    const notSaved = !(await savedHost(page, serverId));
    for (let count = 0; count < 10; count += 1)
      await page.evaluate(() => window.postMessage("x", "*"));
    await sleep(1000);
    const notAskedAgain = (await confirmationCount(page)) === 0;
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForWelcome(page);
    await sleep(2000);
    const notAskedAfterReload = (await confirmationCount(page)) === 0;
    const other = await newContext(browser, options);
    let elsewhereInFragment;
    try {
      const opened = await openPage(other, `${options.base}/#x#offer=${options.offer.payload}`);
      await waitForWelcome(opened.page);
      await sleep(3000);
      elsewhereInFragment = {
        asked: (await confirmationCount(opened.page)) > 0,
        hashCleared: await opened.page.evaluate(() => location.hash === ""),
      };
    } finally {
      await other.close();
    }
    const checks = {
      hashCleared,
      oneQuestion,
      sameServerId,
      notSaved,
      notAskedAgain,
      notAskedAfterReload,
    };
    return {
      ok:
        Object.values(checks).every(Boolean) &&
        !elsewhereInFragment.asked &&
        elsewhereInFragment.hashCleared,
      ...checks,
      elsewhereInFragment,
    };
  } finally {
    await context.close();
  }
}

async function s4(browser, options) {
  const { serverId } = options.offer.value;
  const context = await newContext(browser, options);
  try {
    const { page } = await openPage(context, `${options.base}/#offer=${options.offer.payload}`);
    const sheet = page.getByTestId("host-confirmation");
    await sheet.waitFor({ state: "visible", timeout: 15_000 });
    await pressConnect(page);
    await sheet.waitFor({ state: "hidden", timeout: 10_000 });
    const landed = await poll(
      () => {
        const { pathname } = new URL(page.url());
        return pathname.startsWith("/open-project") || pathname.startsWith("/h/") ? pathname : null;
      },
      { timeout: 20_000 },
    );
    const saved = await poll(() => savedHost(page, serverId), { timeout: 10_000 });
    await page.goBack().catch(() => null);
    await sleep(1000);
    const noOfferAfterBack = !page.url().includes("#offer=");
    return {
      ok: !!landed && !!saved && noOfferAfterBack,
      landed,
      saved: !!saved,
      noOfferAfterBack,
    };
  } finally {
    await context.close();
  }
}

async function s5(browser, options) {
  const [host, port] = splitHostPort(options.direct);
  const context = await newContext(browser, options);
  try {
    const { page, seen } = await openPage(context, `${options.base}/`);
    await waitForWelcome(page);
    await page.getByTestId("welcome-direct-connection").click();
    await page.getByTestId("direct-host-input").fill(host);
    await page.getByTestId("direct-port-input").fill(port);
    await page.getByTestId("direct-host-submit").click();
    // B11 asks before it saves a non-loopback direct host in a browser.
    const asked = await poll(async () => (await confirmationCount(page)) > 0, { timeout: 3000 });
    if (asked) await pressConnect(page);
    const socket = await poll(
      () => seen.sockets.find((entry) => entry.url.includes(`${host}:${port}`) && entry.frames > 0),
      { timeout: 30_000 },
    );
    const saved = await poll(
      async () => JSON.stringify(await registry(page)).includes(`${host}:${port}`),
      { timeout: 10_000 },
    );
    return { ok: !!socket && saved, asked, online: !!socket, saved };
  } finally {
    await context.close();
  }
}

function splitHostPort(value) {
  const colon = value.lastIndexOf(":");
  return [value.slice(0, colon), value.slice(colon + 1)];
}

async function s6(browser, options) {
  const context = await newContext(browser, options);
  try {
    const page = await context.newPage();
    const seen = watch(page);
    if (options.reportMock) {
      await page.route(REPORT_URL, (route) =>
        route.fulfill({
          status: 400,
          headers: {
            "access-control-allow-origin": route.request().headers().origin ?? "*",
            "content-type": "application/json",
          },
          body: JSON.stringify({ error: "unsupported_schema" }),
        }),
      );
    }
    await page.goto(`${options.base}/`, { waitUntil: "domcontentloaded" });
    await waitForWelcome(page);
    const answer = await page.evaluate(async (url) => {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        return { status: response.status };
      } catch (error) {
        return { error: String(error) };
      }
    }, REPORT_URL);
    const csp = await cspViolations(page, seen);
    return {
      ok: answer.status === 400 && csp.length === 0,
      mocked: options.reportMock,
      answer,
      csp,
    };
  } finally {
    await context.close();
  }
}

async function s7(browser, options) {
  const context = await newContext(browser, options);
  try {
    // Through the app: settings/[section] waits for the store, so a cold deep link can land on /.
    const { page, seen } = await openPage(context, `${options.base}/`);
    await waitForWelcome(page);
    await page.getByTestId("welcome-open-settings").click();
    const sidebar = page.getByTestId("settings-sidebar");
    await sidebar.waitFor({ state: "visible", timeout: 15_000 });
    await sidebar.getByRole("button", { name: "About", exact: true }).click();
    await page.getByTestId("settings-whats-new").click();
    await page.getByTestId("changelog-sheet").waitFor({ state: "visible", timeout: 15_000 });
    const response = await poll(
      () => seen.responses.find((entry) => new URL(entry.url()).host === CHANGELOG_HOST),
      { timeout: 20_000 },
    );
    await sleep(1000);
    const error = (await page.getByTestId("changelog-error").count()) > 0;
    const status = response?.status();
    const allowOrigin = response?.headers()["access-control-allow-origin"];
    return { ok: status === 200 && allowOrigin === "*" && !error, status, allowOrigin, error };
  } finally {
    await context.close();
  }
}

/** Every request or WebSocket to a loopback or private address, whatever its port. */
function localRequests(seen) {
  return [...seen.requests, ...seen.sockets.map((socket) => socket.url)].filter((url) => {
    try {
      const parsed = new URL(url);
      return /^(?:https?|wss?):$/.test(parsed.protocol) && isLocalOrPrivateHost(parsed.hostname);
    } catch {
      return false;
    }
  });
}

async function s8(browser, options, devices) {
  const desktop = await newContext(browser, options);
  let desktopResult;
  try {
    const { page, seen } = await openPage(desktop, `${options.base}/`);
    await waitForWelcome(page);
    await sleep(10_000);
    desktopResult = {
      probes: localRequests(seen),
      thisComputerButton: (await page.getByTestId("welcome-this-computer").count()) > 0,
    };
  } finally {
    await desktop.close();
  }
  const phone = await newContext(browser, options, devices["Pixel 7"]);
  let phoneResult;
  try {
    const { page, seen } = await openPage(phone, `${options.base}/`);
    await waitForWelcome(page);
    await sleep(3000);
    phoneResult = {
      probes: localRequests(seen),
      thisComputerButton: (await page.getByTestId("welcome-this-computer").count()) > 0,
    };
  } finally {
    await phone.close();
  }
  return {
    ok:
      desktopResult.probes.length === 0 &&
      desktopResult.thisComputerButton &&
      phoneResult.probes.length === 0 &&
      !phoneResult.thisComputerButton,
    desktop: desktopResult,
    phone: phoneResult,
  };
}

async function s9(browser, options) {
  const context = await newContext(browser, options);
  try {
    const { page } = await openPage(context, `${options.base}/`);
    await waitForWelcome(page);
    await sleep(2000);
    const registrations = await page.evaluate(async () =>
      navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
    );
    return { ok: registrations === 0, registrations };
  } finally {
    await context.close();
  }
}

// A link with the paired host's serverId and another key: B1 blocks it (O3), nothing changes.
async function s10(options, state) {
  if (!state.pairedContext) return { ok: false, reason: "S2 did not pair" };
  const { serverId } = options.offer.value;
  const forged = encodeOffer({
    ...options.offer.value,
    daemonPublicKeyB64: randomBytes(32).toString("base64"),
  });
  SECRETS.push(forged);
  const { page } = await openPage(state.pairedContext, `${options.base}/#offer=${forged}`);
  const before = (await savedHost(page, serverId))?.connections ?? null;
  await page
    .getByTestId("host-confirmation-key-changed")
    .waitFor({ state: "visible", timeout: 15_000 });
  const connectShown = (await page.getByTestId("host-confirmation-connect").count()) > 0;
  await page.getByTestId("host-confirmation-close").click();
  await page.getByTestId("host-confirmation").waitFor({ state: "hidden", timeout: 10_000 });
  await sleep(2000);
  const after = (await savedHost(page, serverId))?.connections ?? null;
  // The relay URL carries no key, so the saved connections are what show the key was not used.
  const unchanged = before !== null && JSON.stringify(before) === JSON.stringify(after);
  return { ok: !connectShown && unchanged, connectShown, savedConnectionsUnchanged: unchanged };
}

async function run(name, results, scenario) {
  const startedAt = Date.now();
  try {
    const result = await scenario();
    results.push({ scenario: name, seconds: (Date.now() - startedAt) / 1000, ...result });
  } catch (error) {
    results.push({ scenario: name, ok: false, error: redact(error?.message ?? error) });
  }
}

function skip(name, results, reason) {
  results.push({ scenario: name, ok: true, skipped: reason });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { chromium, devices } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: !options.headed });
  const results = [];
  const state = { pairedContext: null };
  const publicHttps = isPublicHttps(options.base);
  try {
    await run("S1", results, () => s1(browser, options));
    await run("S2", results, () => s2(browser, options, state));
    await run("S3", results, () => s3(browser, options));
    await run("S4", results, () => s4(browser, options));
    if (options.direct) await run("S5", results, () => s5(browser, options));
    else skip("S5", results, "no --direct");
    await run("S6", results, () => s6(browser, options));
    await run("S7", results, () => s7(browser, options));
    if (publicHttps) {
      await run("S8", results, () => s8(browser, options, devices));
      await run("S9", results, () => s9(browser, options));
    } else {
      skip("S8", results, "only on a public https site");
      skip("S9", results, "only on a public https site");
    }
    await run("S10", results, () => s10(options, state));
  } finally {
    await browser.close();
  }
  const ok = results.every((result) => result.ok);
  console.log(redact(JSON.stringify({ base: options.base, ok, results }, null, 2)));
  if (!ok) process.exit(1);
}

// Run as a script, not when the tests import the helpers above.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  await main().catch((error) => {
    console.error(`hosted-web-smoke: ${redact(error?.stack ?? error)}`);
    process.exit(1);
  });
}
