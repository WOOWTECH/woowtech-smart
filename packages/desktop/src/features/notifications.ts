import { existsSync } from "node:fs";
import { app, BrowserWindow, Notification, ipcMain, nativeImage, webContents } from "electron";
import { getDesktopSettingsStore } from "../settings/desktop-settings-electron.js";
import {
  createNotificationClickRouter,
  type NotificationClickWindow,
} from "./woowtech-notification-click.js";
import {
  showNotificationWithDelivery,
  type NotificationDeliveryResult,
} from "./woowtech-notification-delivery.js";
import { notificationIconCandidates } from "./woowtech-notification-icon.js";

interface NotificationInput {
  title?: unknown;
  body?: unknown;
  data?: unknown;
}

const activeNotifications = new Set<Notification>();

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getNotificationIcon(): Electron.NativeImage | null {
  const candidates = notificationIconCandidates({
    platform: process.platform,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    moduleDir: __dirname,
  });

  for (const iconPath of candidates) {
    if (!existsSync(iconPath)) {
      continue;
    }
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      return icon;
    }
  }

  return null;
}

function toClickWindow(win: BrowserWindow | null | undefined): NotificationClickWindow | null {
  if (!win || win.isDestroyed()) {
    return null;
  }
  return {
    webContentsId: win.webContents.id,
    isDestroyed: () => win.isDestroyed(),
    isMinimized: () => win.isMinimized(),
    restore: () => win.restore(),
    show: () => win.show(),
    focus: () => win.focus(),
    sendClick: (payload) => win.webContents.send("paseo:event:notification-click", payload),
  };
}

/** Best-effort registration probe; support does not establish system authorization. */
export function ensureNotificationCenterRegistration(): void {
  if (process.platform !== "darwin" || !Notification.isSupported()) {
    return;
  }

  try {
    const probe = new Notification({ title: app.name, silent: true });
    void showNotificationWithDelivery({
      notification: probe,
      closeOnTimeout: true,
      onClick: () => {},
      release: () => {},
    })
      .then((result) => {
        if (result === "shown") probe.close();
        else console.warn("[Notifications] Registration probe display was not confirmed");
        return undefined;
      })
      .catch(() => {
        console.warn("[Notifications] Registration probe could not close");
      });
  } catch {
    console.warn("[Notifications] Registration probe could not be created");
  }
}

export function registerNotificationHandlers(options: {
  /** Reopens the main window when every window is closed (macOS keeps the app running). */
  ensureWindow: () => Promise<void>;
}): void {
  const clickRouter = createNotificationClickRouter({
    windowForWebContents: (id) => {
      const contents = webContents.fromId(id);
      return contents && !contents.isDestroyed()
        ? toClickWindow(BrowserWindow.fromWebContents(contents))
        : null;
    },
    anyWindow: () => toClickWindow(BrowserWindow.getAllWindows()[0]),
    ensureWindow: options.ensureWindow,
  });
  const trackedRenderers = new Set<number>();

  ipcMain.handle("paseo:notification:isSupported", () => {
    return Notification.isSupported();
  });

  // The renderer's PushNotificationRouter calls this after it subscribes to clicks.
  ipcMain.handle("woowtech:notification:takePendingClick", (event) => {
    const contents = event.sender;
    const id = contents.id;
    if (!trackedRenderers.has(id)) {
      trackedRenderers.add(id);
      contents.on("did-start-navigation", (_event, _url, isSameDocument, isMainFrame) => {
        if (isMainFrame && !isSameDocument) clickRouter.windowLoading(id);
      });
      contents.once("destroyed", () => {
        trackedRenderers.delete(id);
        clickRouter.removeWindow(id);
      });
    }
    return clickRouter.rendererReady(id);
  });

  async function sendWithResult(
    event: Electron.IpcMainInvokeEvent,
    rawInput?: NotificationInput,
  ): Promise<NotificationDeliveryResult> {
    if (!Notification.isSupported()) {
      return "failed";
    }

    const title = toTrimmedString(rawInput?.title);
    if (!title) {
      return "failed";
    }

    const body = toTrimmedString(rawInput?.body) ?? undefined;
    const data = toRecord(rawInput?.data);
    const senderWebContentsId = event.sender.id;
    const icon = getNotificationIcon();
    const settings = await getDesktopSettingsStore().get();
    const notification = new Notification({
      title,
      ...(body ? { body } : {}),
      ...(icon ? { icon } : {}),
      silent: !settings.notifications.playSound,
    });

    activeNotifications.add(notification);

    return showNotificationWithDelivery({
      notification,
      onClick: () => {
        void clickRouter.routeClick(senderWebContentsId, data).catch((error) => {
          console.warn("[Notifications] Click could not be routed", error);
        });
      },
      release: () => {
        activeNotifications.delete(notification);
      },
    });
  }

  ipcMain.handle("paseo:notification:send", async (event, rawInput?: NotificationInput) => {
    return (await sendWithResult(event, rawInput)) === "shown";
  });
  ipcMain.handle("woowtech:notification:sendWithResult", sendWithResult);
}
