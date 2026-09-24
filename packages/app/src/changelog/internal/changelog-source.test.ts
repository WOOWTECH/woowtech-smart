/**
 * @vitest-environment jsdom
 */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useChangelog } from "./changelog-source";

const RELEASES_REPO_CHANGELOG =
  "https://raw.githubusercontent.com/WOOWTECH/woowtech-smart-releases/main/CHANGELOG.md";

afterEach(() => {
  vi.unstubAllGlobals();
});

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
