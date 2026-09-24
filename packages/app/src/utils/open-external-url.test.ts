/**
 * @vitest-environment jsdom
 */
import { afterEach, expect, it, vi } from "vitest";
import { openExternalUrl } from "./open-external-url";

function openedUrls(open: { mock: { calls: unknown[][] } }): unknown[] {
  return open.mock.calls.map(([url]) => url);
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("opens email links", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);

  await openExternalUrl("mailto:woowtech@designsmart.com.tw");

  expect(openedUrls(open)).toEqual(["mailto:woowtech@designsmart.com.tw"]);
});

it("still refuses links to local files and scripts", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);

  await openExternalUrl("file:///private/data");
  await openExternalUrl("javascript:alert(1)");

  expect(openedUrls(open)).toEqual([]);
});
