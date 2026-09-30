import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "../../app/e2e/support/fixtures";
import { installDesktopRuntime } from "./support/runtime";

// woowtech smart: the workspace header shows the "Open in" button with its icon alone. A mark that
// may only appear beside its product's name, such as Zed's, gives way there to the generic editor
// icon, while the menu names each editor beside its own icon (woowtech/README.md section 25).

const ZED_ICON = path.resolve(__dirname, "../assets/editor-targets/zed.png");
// An editor icon with no conditions: a 1×1 PNG. The header draws such an icon as it is, which
// shows that the header does draw an editor's own image where one may stand alone.
const PLAIN_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function requireE2EEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set.`);
  }
  return value;
}

/** The images an element draws, by their source. */
async function imagesIn(element: Locator): Promise<string[]> {
  return element
    .locator("img")
    .evaluateAll((images) => images.map((image) => image.getAttribute("src") ?? ""));
}

async function preferEditor(page: Page, targetId: string): Promise<void> {
  await page.getByTestId("workspace-open-in-editor-caret").click();
  await expect(page.getByTestId("workspace-open-in-editor-menu")).toBeVisible();
  await page.getByTestId(`workspace-open-in-editor-item-${targetId}`).click();
  await expect(page.getByTestId("workspace-open-in-editor-menu")).toBeHidden();
}

test("draws Zed's icon beside its name in the menu, and never alone in the workspace header", async ({
  page,
  withWorkspace,
}, testInfo) => {
  test.setTimeout(90_000);
  const zedIcon = `data:image/png;base64,${(await readFile(ZED_ICON)).toString("base64")}`;
  await installDesktopRuntime(page, {
    serverId: requireE2EEnv("E2E_SERVER_ID"),
    editorTargets: [
      { id: "kiro", label: "Kiro", kind: "editor", icon: { kind: "image", dataUrl: PLAIN_ICON } },
      { id: "zed", label: "Zed", kind: "editor", icon: { kind: "image", dataUrl: zedIcon } },
    ],
  });
  const workspace = await withWorkspace({ prefix: "workspace-editor-marks-" });
  await workspace.navigateTo();

  const primary = page.getByTestId("workspace-open-in-editor-primary");
  await expect(primary).toBeVisible({ timeout: 30_000 });

  // An icon with no conditions stands alone in the header as it is.
  await preferEditor(page, "kiro");
  await expect(primary).toHaveAccessibleName("Open workspace in Kiro");
  await expect.poll(() => imagesIn(primary)).toEqual([PLAIN_ICON]);

  // Zed's icon gives way to the generic editor icon, drawn as a symbol.
  await preferEditor(page, "zed");
  await expect(primary).toHaveAccessibleName("Open workspace in Zed");
  await expect(primary.locator("svg")).toHaveCount(1);
  await expect.poll(() => imagesIn(primary)).toEqual([]);
  await primary.screenshot({ path: testInfo.outputPath("header-zed-preferred.png") });

  // The menu names Zed beside its own icon.
  await page.getByTestId("workspace-open-in-editor-caret").click();
  const zed = page.getByTestId("workspace-open-in-editor-item-zed");
  await expect(zed).toContainText("Zed");
  await expect.poll(() => imagesIn(zed)).toEqual([zedIcon]);
  await page
    .getByTestId("workspace-open-in-editor-menu")
    .screenshot({ path: testInfo.outputPath("menu-zed-preferred.png") });
});
