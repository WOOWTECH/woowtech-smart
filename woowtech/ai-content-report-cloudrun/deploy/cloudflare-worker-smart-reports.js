// Cloudflare Worker `smart-reports-proxy` for reports.woowtech.io: the only public way into the
// AI content report receiver (Cloud Run service smart-reports, project woowtech-smart). It is
// smart-push-proxy (push.woowtech.io) with another path, another size limit and CORS for the
// desktop App and the web app, whose reports are both cross-origin requests.
//
// - Serves only POST /v1/ai-content-reports on reports.woowtech.io (other paths 404, other methods
//   405). Its workers.dev and Preview URLs get 404 too: they are outside the woowtech.io zone, so
//   the zone's WAF rate limiting rule would not apply to them. Turn both off in the dashboard as
//   well, in the Worker's Settings > Domains & Routes.
// - Takes only application/json (415) and refuses bodies over 12,288 bytes (413) before
//   forwarding. The number is MAX_BODY_BYTES of the report contract; a test keeps them equal.
// - The phone Apps send no Origin header. A request with an Origin is answered 403, except from an
//   allowed origin: the desktop App's page is woowtech-smart://app and the web app's is
//   https://smart.woowtech.io. Both fetches are cross-origin, so the browser engine sends a
//   preflight (OPTIONS) first and needs the CORS headers on every answer. Matching is exact;
//   "*" and "null" never match. The Origin only decides whether to answer with CORS: requests
//   without one are taken, so the per-IP limit and the receiver's daily cap stop abuse, not this.
// - Forwards the body, and nothing else of the client, to RELAY_ORIGIN with the edge key the
//   receiver requires, so calling the run.app URL directly cannot bypass the limits applied here.
//   The receiver therefore never sees an Origin and refuses one.
// - The per-IP limit is the zone's WAF rate limiting rule. When the optional IP_RATE_LIMITER
//   binding exists (wrangler config only; bindings are not visible in the dashboard) the Worker
//   applies 10 requests a minute per IP itself, counted per Cloudflare location. The binding has
//   no burst setting.
// - Logs nothing. Keep Workers Logs off and do not configure Logpush for this Worker.
// - Needs the account on Workers Paid, as smart-push-proxy does: on Workers Free all Workers of
//   the account share 100,000 requests a day.
//
// Settings: RELAY_ORIGIN (text: https://smart-reports-....run.app), EDGE_KEY (secret, the value
// of Secret Manager secret smart-reports-edge-key; while a rotation leaves "old new" in it, the
// new key only: the whole pair is sent as one key and every request gets 403), ALLOWED_ORIGINS
// (optional text, origins separated by commas or spaces; unset means the desktop App's and the
// web app's origins, empty means none, any other value replaces the whole list; a wrangler deploy
// drops a value set in the dashboard), IP_RATE_LIMITER (optional binding).

const PUBLIC_HOST = "reports.woowtech.io";
const REPORT_PATH = "/v1/ai-content-reports";
const MAX_BODY_BYTES = 12288;
// The desktop App loads its pages from this custom scheme (packages/desktop/src/main.ts,
// APP_SCHEME), and the daemon lists the same origin (packages/server/src/server/bootstrap.ts).
// The hosted web app (Cloudflare Pages) is https://smart.woowtech.io (owner decision D4,
// 2026-10-26); packages/protocol/src/brand-web-app.ts holds the same address, and
// woowtech/web-deploy.test.mjs checks that this list includes it.
const DEFAULT_ALLOWED_ORIGINS = ["woowtech-smart://app", "https://smart.woowtech.io"];
const PREFLIGHT_MAX_AGE_SECONDS = 600;
const IP_RETRY_AFTER_SECONDS = 60;
// The app waits for the answer; a cold Cloud Run instance plus a Firestore transaction is a few
// seconds. Answer before the app gives up so it sees a 503 and can say "try later".
const RELAY_TIMEOUT_MS = 12000;
const MIN_EDGE_KEY_LENGTH = 32;

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

function configured(env) {
  let origin;
  try {
    origin = new URL(env.RELAY_ORIGIN);
  } catch {
    return false;
  }
  return (
    origin.protocol === "https:" &&
    typeof env.EDGE_KEY === "string" &&
    env.EDGE_KEY.length >= MIN_EDGE_KEY_LENGTH
  );
}

function originAllowed(origin, env) {
  if (origin === "*" || origin === "null") {
    return false;
  }
  const listed =
    typeof env.ALLOWED_ORIGINS === "string"
      ? env.ALLOWED_ORIGINS.split(/[\s,]+/).filter(Boolean)
      : DEFAULT_ALLOWED_ORIGINS;
  return listed.includes(origin);
}

// The answer the browser engine needs to hand a cross-origin answer to the App: the origin echoed
// back, and the one answer header the App reads (retry-after on 429) made visible.
function withCors(response, origin) {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-expose-headers", "retry-after");
  headers.append("vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}

// Reads at most maxBytes; returns null as soon as the body turns out to be larger.
async function readBody(request, maxBytes) {
  if (!request.body) {
    return new Uint8Array(0);
  }
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

// The answer to a request that is turned away before its body is read, or null to go on.
function earlyAnswer(request, env, origin) {
  const url = new URL(request.url);
  if (url.hostname !== PUBLIC_HOST || url.pathname !== REPORT_PATH) {
    return json(404, { error: "not_found" });
  }
  if (
    request.method === "OPTIONS" &&
    origin !== null &&
    originAllowed(origin, env) &&
    request.headers.get("access-control-request-method") === "POST"
  ) {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-methods": "POST",
        "access-control-allow-headers": "content-type, accept",
        "access-control-max-age": String(PREFLIGHT_MAX_AGE_SECONDS),
      },
    });
  }
  if (request.method !== "POST") {
    return json(405, { error: "method_not_allowed" }, { allow: "POST" });
  }
  if (origin !== null && !originAllowed(origin, env)) {
    return json(403, { error: "origin_not_allowed" });
  }
  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return json(415, { error: "content_type_required" });
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && !(Number(declaredLength) <= MAX_BODY_BYTES)) {
    return json(413, { error: "body_too_large" });
  }
  if (!configured(env)) {
    return json(500, { error: "edge_misconfigured" });
  }
  return null;
}

// The per-IP limit when the IP_RATE_LIMITER binding exists: a 429 answer, or null to go on.
async function rateLimitAnswer(request, env) {
  if (!env.IP_RATE_LIMITER) {
    return null;
  }
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const { success } = await env.IP_RATE_LIMITER.limit({ key: ip });
  if (success) {
    return null;
  }
  return json(429, { error: "rate_limited" }, { "retry-after": String(IP_RETRY_AFTER_SECONDS) });
}

async function handle(request, env, origin) {
  const early = earlyAnswer(request, env, origin) ?? (await rateLimitAnswer(request, env));
  if (early) {
    return early;
  }

  const body = await readBody(request, MAX_BODY_BYTES);
  if (body === null) {
    return json(413, { error: "body_too_large" });
  }

  let relayed;
  try {
    relayed = await fetch(new URL(REPORT_PATH, env.RELAY_ORIGIN), {
      method: "POST",
      // Only these two headers: no cookies, client address, user agent, Origin or query string
      // travel.
      headers: { "content-type": "application/json", "x-woowtech-edge-key": env.EDGE_KEY },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
  } catch {
    return json(503, { error: "upstream_unavailable" });
  }

  const headers = {
    "content-type": relayed.headers.get("content-type") || "application/json",
    "cache-control": "no-store",
  };
  const retryAfter = relayed.headers.get("retry-after");
  if (retryAfter) {
    headers["retry-after"] = retryAfter;
  }
  return new Response(relayed.body, { status: relayed.status, headers });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("origin");
    const response = await handle(request, env, origin);
    // CORS headers go on every answer to an allowed origin, errors included: without them the
    // browser engine hides the status from the App, which would then report a network failure.
    return origin !== null && originAllowed(origin, env) ? withCors(response, origin) : response;
  },
};
