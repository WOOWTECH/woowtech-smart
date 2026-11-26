/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/i18next";

vi.mock("@/components/adaptive-modal-sheet", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    AdaptiveModalSheet: ({
      visible,
      header,
      children,
      testID,
    }: React.ComponentProps<
      typeof import("@/components/adaptive-modal-sheet").AdaptiveModalSheet
    >) =>
      visible
        ? ReactModule.createElement(
            "div",
            { role: "dialog", "aria-label": header?.title, "data-testid": testID },
            header?.leading,
            ReactModule.createElement("h1", null, header?.title),
            header?.actions,
            children,
          )
        : null,
    SheetHeaderIconButton: ({
      label,
      onPress,
      busy,
      disabled,
      testID,
    }: React.ComponentProps<
      typeof import("@/components/adaptive-modal-sheet").SheetHeaderIconButton
    >) =>
      ReactModule.createElement("button", {
        type: "button",
        "aria-label": label,
        onClick: onPress,
        disabled: disabled || busy,
        "data-testid": testID,
      }),
  };
});

// Release notes render as Markdown, which none of these states reach.
vi.mock("@/components/markdown/renderer", () => ({ MarkdownRenderer: () => null }));

// The sheet's JSX compiles to React.createElement, some of it at module scope, so
// React has to be global before the sheet loads. Loading it compiles the sheet's
// imports, which takes longer than a hook's default 10 seconds on a busy machine.
let ChangelogSheet: typeof import("./changelog-sheet").ChangelogSheet;

beforeAll(async () => {
  vi.stubGlobal("React", React);
  ({ ChangelogSheet } = await import("./changelog-sheet"));
}, 120_000);

beforeEach(async () => {
  vi.stubGlobal("React", React);
  await i18n.changeLanguage("zh-TW");
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

function close(): void {}

function renderSheet(): void {
  render(<ChangelogSheet visible onClose={close} />);
}

it("says there are no release notes yet while the releases repository has no changelog", async () => {
  vi.stubGlobal("fetch", async () => new Response("404: Not Found", { status: 404 }));

  renderSheet();

  expect(await screen.findByText("還沒有釋出說明")).toBeTruthy();
  expect(screen.queryByText("請檢查網路連線後重試。")).toBeNull();
});

it("asks the reader to check the connection when the changelog cannot be reached", async () => {
  vi.stubGlobal("fetch", async () => {
    throw new TypeError("Network request failed");
  });

  renderSheet();

  expect(await screen.findByText("請檢查網路連線後重試。")).toBeTruthy();
  expect(screen.queryByText("還沒有釋出說明")).toBeNull();
});
