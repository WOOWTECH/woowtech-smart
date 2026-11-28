import { describe, expect, it, vi } from "vitest";
import { reloadActiveBrowserOrWindow, setupApplicationMenu } from "./menu.js";

const electron = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  buildFromTemplate: vi.fn(),
  setApplicationMenu: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { name: "Native parity test", on: electron.on },
  Menu: {
    buildFromTemplate: electron.buildFromTemplate,
    setApplicationMenu: electron.setApplicationMenu,
  },
  BrowserWindow: vi.fn(),
  ipcMain: { handle: electron.handle },
}));
vi.mock("./browser-webviews/index.js", () => ({
  getActivePaseoBrowserWebContentsForHostWindow: vi.fn(),
}));

describe("desktop menu shortcut capture", () => {
  it("suppresses menu accelerators only for the sender, then restores them on cancel or reload", () => {
    setupApplicationMenu({ onNewWindow: vi.fn() });
    const capture = electron.handle.mock.calls.find(
      ([name]) => name === "paseo:menu:set-capturing-shortcut",
    )?.[1];
    expect(capture).toBeTypeOf("function");
    const first = { setIgnoreMenuShortcuts: vi.fn(), on: vi.fn() };
    const second = { setIgnoreMenuShortcuts: vi.fn(), on: vi.fn() };
    capture({ sender: first }, true);
    expect(first.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(true);
    expect(second.setIgnoreMenuShortcuts).not.toHaveBeenCalled();
    capture({ sender: first }, false);
    expect(first.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);
    capture({ sender: first }, true);
    const created = electron.on.mock.calls.find(([name]) => name === "browser-window-created")?.[1];
    created({}, { webContents: first });
    const loaded = first.on.mock.calls.find(([name]) => name === "did-finish-load")?.[1];
    loaded();
    expect(first.setIgnoreMenuShortcuts).toHaveBeenLastCalledWith(false);
  });
});

class FakeWebContents {
  public readonly reloads: string[] = [];

  public constructor(public readonly id: number) {}

  public isLoadingMainFrame(): boolean {
    return false;
  }

  public stop(): void {
    this.reloads.push("stop");
  }

  public reload(): void {
    this.reloads.push("reload");
  }

  public reloadIgnoringCache(): void {
    this.reloads.push("force-reload");
  }
}

class BrowserReloads {
  public readonly firstWindow = { webContents: new FakeWebContents(101) };
  public readonly secondWindow = { webContents: new FakeWebContents(202) };
  public readonly firstBrowser = new FakeWebContents(11);
  public readonly secondBrowser = new FakeWebContents(22);
  public readonly resolvedHostWindowIds: number[] = [];

  public activeBrowserForHostWindow(hostWebContentsId: number): FakeWebContents | null {
    this.resolvedHostWindowIds.push(hostWebContentsId);
    return hostWebContentsId === 101 ? this.firstBrowser : this.secondBrowser;
  }
}

describe("reloadActiveBrowserOrWindow", () => {
  it("reloads only the active browser belonging to the supplied window", () => {
    const browserReloads = new BrowserReloads();

    reloadActiveBrowserOrWindow({
      win: browserReloads.firstWindow,
      getActiveBrowserContentsForHostWindow:
        browserReloads.activeBrowserForHostWindow.bind(browserReloads),
    });

    expect(browserReloads.resolvedHostWindowIds).toEqual([101]);
    expect(browserReloads.firstBrowser.reloads).toEqual(["reload"]);
    expect(browserReloads.secondBrowser.reloads).toEqual([]);
    expect(browserReloads.firstWindow.webContents.reloads).toEqual([]);
  });

  it("force reloads only the active browser belonging to the supplied window", () => {
    const browserReloads = new BrowserReloads();

    reloadActiveBrowserOrWindow({
      win: browserReloads.secondWindow,
      getActiveBrowserContentsForHostWindow:
        browserReloads.activeBrowserForHostWindow.bind(browserReloads),
      ignoreCache: true,
    });

    expect(browserReloads.resolvedHostWindowIds).toEqual([202]);
    expect(browserReloads.firstBrowser.reloads).toEqual([]);
    expect(browserReloads.secondBrowser.reloads).toEqual(["force-reload"]);
    expect(browserReloads.secondWindow.webContents.reloads).toEqual([]);
  });
});
