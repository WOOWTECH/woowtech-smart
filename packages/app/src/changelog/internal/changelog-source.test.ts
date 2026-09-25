/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const RELEASES_REPO_CHANGELOG =
  "https://raw.githubusercontent.com/WOOWTECH/woowtech-smart-releases/main/CHANGELOG.md";

// The hook keeps the last changelog in its module, so every test loads a fresh copy.
let useChangelog: typeof import("./changelog-source").useChangelog;

beforeEach(async () => {
  vi.resetModules();
  ({ useChangelog } = await import("./changelog-source"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(respond: () => Promise<Response>): void {
  vi.stubGlobal("fetch", respond);
}

it("reads the changelog from the woowtech smart releases repository", async () => {
  const requested: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    requested.push(String(input));
    return new Response("# Changelog\n\n## 0.1.0 - 2026-09-24\n\n- First release\n");
  });

  const { result } = renderHook(() => useChangelog(true));

  await waitFor(() => expect(result.current.state.status).toBe("ready"));
  expect(requested).toEqual([RELEASES_REPO_CHANGELOG]);
});

// The releases repository has no CHANGELOG.md until the first release ships.
it("has no release notes yet, rather than an error, while the changelog is missing", async () => {
  stubFetch(async () => new Response("404: Not Found", { status: 404 }));

  const { result } = renderHook(() => useChangelog(true));

  await waitFor(() => expect(result.current.state.status).toBe("empty"));
});

it("has no release notes yet while the changelog lists no release", async () => {
  stubFetch(async () => new Response("# Changelog\n"));

  const { result } = renderHook(() => useChangelog(true));

  await waitFor(() => expect(result.current.state.status).toBe("empty"));
});

it("still reports an error when the changelog cannot be reached", async () => {
  stubFetch(async () => {
    throw new TypeError("Network request failed");
  });

  const { result } = renderHook(() => useChangelog(true));

  await waitFor(() => expect(result.current.state.status).toBe("error"));
});

it("still reports an error when the server fails", async () => {
  stubFetch(async () => new Response("", { status: 503 }));

  const { result } = renderHook(() => useChangelog(true));

  await waitFor(() => expect(result.current.state.status).toBe("error"));
});
