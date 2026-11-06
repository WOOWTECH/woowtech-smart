import { describe, expect, it, vi } from "vitest";

// Another brand's release tree regenerates brand-values.ts (woowtech/tools/apply-brand.mjs). The
// toast activators come from there, so with woowtech smart and Apporo smart on one PC each
// notification starts the app it came from.
vi.mock("@getpaseo/protocol/brand-desktop", () => ({
  DESKTOP_APP_ID: "com.apporo.smart.desktop",
  WINDOWS_TOAST_ACTIVATOR_CLSID: "{88869780-E173-4B34-83FE-B6388E13DED1}",
  WINDOWS_DEV_TOAST_ACTIVATOR_CLSID: "{1ED4A85C-7F1C-4F64-9826-A723B6A9326F}",
}));

import { applyWindowsAppUserModelId } from "./woowtech-app-user-model-id.js";

describe("applyWindowsAppUserModelId in another brand's release tree", () => {
  it("registers that brand's app id and toast activator, packaged or not", () => {
    const ids: string[] = [];
    const clsids: string[] = [];
    const setters = {
      setAppUserModelId: (id: string) => ids.push(id),
      setToastActivatorCLSID: (clsid: string) => clsids.push(clsid),
    };

    applyWindowsAppUserModelId({ platform: "win32", isPackaged: true, ...setters });
    applyWindowsAppUserModelId({ platform: "win32", isPackaged: false, ...setters });

    expect(ids).toEqual(["com.apporo.smart.desktop", "com.apporo.smart.desktop.dev"]);
    expect(clsids).toEqual([
      "{88869780-E173-4B34-83FE-B6388E13DED1}",
      "{1ED4A85C-7F1C-4F64-9826-A723B6A9326F}",
    ]);
  });
});
