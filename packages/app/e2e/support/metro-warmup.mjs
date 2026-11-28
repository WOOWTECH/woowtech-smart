/** @param {Record<string, string | undefined>} env */
export function metroWarmupTimeoutMs(env = process.env) {
  const configured = Number(env.E2E_METRO_WARMUP_TIMEOUT_MS);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 120_000;
}

/** @param {number} port */
export async function warmMetro(port, timeoutMs = metroWarmupTimeoutMs()) {
  const origin = `http://127.0.0.1:${port}`;
  const documentResponse = await fetch(origin, { signal: AbortSignal.timeout(timeoutMs) });
  if (!documentResponse.ok) {
    throw new Error(`Metro document warmup failed with HTTP ${documentResponse.status}`);
  }
  const document = await documentResponse.text();
  const scriptSources = [...document.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  if (scriptSources.length === 0) {
    throw new Error("Metro document warmup found no scripts to compile");
  }
  for (const source of scriptSources) {
    const scriptUrl = new URL(source, origin);
    if (scriptUrl.origin !== origin) continue;
    const response = await fetch(scriptUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      throw new Error(
        `Metro bundle warmup failed for ${scriptUrl.pathname}: HTTP ${response.status}`,
      );
    }
    await response.arrayBuffer();
  }
}
