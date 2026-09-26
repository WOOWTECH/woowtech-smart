import path from "node:path";
import { existsSync } from "node:fs";
import { app, BrowserWindow, Notification, ipcMain, nativeImage } from "electron";
import { getDesktopSettingsStore } from "../settings/desktop-settings-electron.js";
import {
  showNotificationWithDelivery,
  type NotificationDeliveryResult,
} from "./woowtech-notification-delivery.js";

interface NotificationInput {
  title?: unknown;
  body?: unknown;
  data?: unknown;
}

interface NotificationClickPayload {
  data?: Record<string, unknown>;
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
  const candidates = [
    path.resolve(__dirname, "../assets/icon.png"),
    path.resolve(__dirname, "../assets/64x64.png"),
    path.resolve(__dirname, "../assets/128x128.png"),
  ];

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

function focusSenderWindow(sender: Electron.WebContents): BrowserWindow | null {
  const win = BrowserWindow.fromWebContents(sender) ?? BrowserWindow.getAllWindows()[0] ?? null;
  if (!win || win.isDestroyed()) {
    return null;
  }
  win.show();
  if (win.isMinimized()) {
    win.restore();
  }
  win.focus();
  return win;
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

export function registerNotificationHandlers(): void {
  ipcMain.handle("paseo:notification:isSupported", () => {
    return Notification.isSupported();
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
        const win = focusSenderWindow(event.sender);
        if (win && data && Object.keys(data).length > 0) {
          const payload: NotificationClickPayload = { data };
          win.webContents.send("paseo:event:notification-click", payload);
        }
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
