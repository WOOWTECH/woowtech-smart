import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, Notification, ipcMain, nativeImage, webContents } from "electron";
import log from "electron-log/main";
import { buildAgentDeepLink, type AgentDeepLinkTarget } from "@getpaseo/protocol/agent-deep-link";
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
import { raiseWindowsWindow } from "./woowtech-windows-focus.js";
import { buildProtocolToastXml, shouldUseProtocolToast } from "./woowtech-windows-toast.js";
import { openSystemNotificationSettings } from "./woowtech-notification-settings.js";
import {
  agentNotificationId,
  agentTargetForNotificationData,
} from "./woowtech-notification-launch.js";

interface NotificationInput {
  title?: unknown;
  body?: unknown;
  data?: unknown;
}

// Windows keeps a toast that timed out into Action Center (README §31), so references are
// capped; the oldest is dropped first. A dropped protocol toast still opens its agent.
const MAX_ACTIVE_NOTIFICATIONS = 50;
const activeNotifications = new Set<Notification>();

function trackNotification(notification: Notification): void {
  activeNotifications.add(notification);
  for (const oldest of activeNotifications) {
    if (activeNotifications.size <= MAX_ACTIVE_NOTIFICATIONS) break;
    activeNotifications.delete(oldest);
  }
}

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

function getNotificationIconPaths(): string[] {
  return notificationIconCandidates({
    platform: process.platform,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    moduleDir: __dirname,
  }).filter((iconPath) => existsSync(iconPath));
}

function toFileUrl(filePath: string | undefined): string | null {
  return filePath ? pathToFileURL(filePath).href : null;
}

function getNotificationIcon(): Electron.NativeImage | null {
  for (const iconPath of getNotificationIconPaths()) {
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
    ...(process.platform === "win32" ? { raise: () => raiseWindowsWindow(win) } : {}),
    sendClick: (payload) => win.webContents.send("paseo:event:notification-click", payload),
  };
}

/** Best-effort registration probe; support does not establish system authorization. */
export function ensureNotificationCenterRegistration(): void {
  // woowtech smart: on Windows, creating the presenter makes Electron write the toast activator
  // into the Start Menu shortcut now, not at the first toast; Notification Center keeps a toast
  // only when the shortcut has one (plan B3).
  if (process.platform === "win32") {
    log.info("[notification] presenter", { supported: Notification.isSupported() });
    return;
  }
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
  /** Opens an agent the way a woowtech-smart:// launch does. */
  openAgent: (target: AgentDeepLinkTarget, via: string) => void;
  /** Whether the packaged Windows app registered the woowtech-smart scheme this run. */
  protocolRegistered: () => boolean;
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
    const silent = !settings.notifications.playSound;
    const agent = agentTargetForNotificationData(data);
    // Windows: the toast launches woowtech-smart://…/agent/… itself, so a click from Action
    // Center, or after the app quit, opens the agent (README §31). macOS: the id carries the
    // agent, so a Notification Center click that relaunches the quit app finds it in launchInfo
    // (woowtech-notification-launch.ts).
    const protocolToast =
      agent &&
      shouldUseProtocolToast({
        platform: process.platform,
        isPackaged: app.isPackaged,
        protocolRegistered: options.protocolRegistered(),
        hasAgentTarget: true,
      })
        ? buildProtocolToastXml({
            launch: buildAgentDeepLink(agent),
            title,
            body,
            iconUrl: toFileUrl(getNotificationIconPaths()[0]),
            silent,
          })
        : null;
    const macId =
      agent && process.platform === "darwin" ? agentNotificationId(agent, randomUUID()) : null;
    const notification = new Notification({
      title,
      ...(body ? { body } : {}),
      ...(icon ? { icon } : {}),
      silent,
      ...(macId ? { id: macId } : {}),
      ...(protocolToast ? { toastXml: protocolToast } : {}),
    });
    const kind = protocolToast ? "protocol" : "default";
    const target = agent ? `${agent.serverId}/${agent.agentId}` : null;

    trackNotification(notification);
    log.info("[notification] posting", { kind, target });

    return showNotificationWithDelivery({
      notification,
      keepAfterTimedOutClose: process.platform === "win32",
      trace: (nativeEvent, reason) => {
        log.info(`[notification] ${nativeEvent}`, { kind, target, ...(reason ? { reason } : {}) });
      },
      onClick: () => {
        // A protocol toast also relaunches with its link; both paths open the same agent.
        if (protocolToast && agent) {
          options.openAgent(agent, "notification-click");
          return;
        }
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
  // woowtech smart: the callout for notices the system did not show opens its settings.
  ipcMain.handle("woowtech:notification:openSystemSettings", () =>
    openSystemNotificationSettings(),
  );
}
