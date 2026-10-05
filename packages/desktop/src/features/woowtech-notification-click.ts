// woowtech smart: routes a desktop notification click to a renderer even when the sender
// window is gone. macOS keeps the app running after the last window closes, so a click can
// arrive with no window at all; the main window is then reopened and the target waits until
// that renderer's PushNotificationRouter has subscribed and asks for it.

export interface NotificationClickPayload {
  data: Record<string, unknown>;
}

export interface NotificationClickWindow {
  webContentsId: number;
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  sendClick(payload: NotificationClickPayload): void;
}

export interface NotificationClickPort {
  windowForWebContents(webContentsId: number): NotificationClickWindow | null;
  anyWindow(): NotificationClickWindow | null;
  /** Reopens the main window when none exists; shared with app activation. */
  ensureWindow(): Promise<void>;
}

export interface NotificationClickRouter {
  routeClick(senderWebContentsId: number, data: Record<string, unknown> | undefined): Promise<void>;
  /** The renderer subscribed to clicks; returns a click that arrived before that. */
  rendererReady(webContentsId: number): NotificationClickPayload | null;
  windowLoading(webContentsId: number): void;
  removeWindow(webContentsId: number): void;
}

function liveWindow(window: NotificationClickWindow | null): NotificationClickWindow | null {
  return window && !window.isDestroyed() ? window : null;
}

export function createNotificationClickRouter(
  port: NotificationClickPort,
): NotificationClickRouter {
  const readyWindows = new Set<number>();
  const pendingByWindow = new Map<number, NotificationClickPayload>();

  return {
    async routeClick(senderWebContentsId, data) {
      let window =
        liveWindow(port.windowForWebContents(senderWebContentsId)) ?? liveWindow(port.anyWindow());
      if (!window) {
        await port.ensureWindow();
        window = liveWindow(port.anyWindow());
      }
      if (!window) {
        return;
      }
      window.show();
      if (window.isMinimized()) {
        window.restore();
      }
      window.focus();
      if (!data || Object.keys(data).length === 0) {
        return;
      }
      const payload: NotificationClickPayload = { data };
      if (readyWindows.has(window.webContentsId)) {
        window.sendClick(payload);
        return;
      }
      pendingByWindow.set(window.webContentsId, payload);
    },
    rendererReady(webContentsId) {
      readyWindows.add(webContentsId);
      const pending = pendingByWindow.get(webContentsId) ?? null;
      pendingByWindow.delete(webContentsId);
      return pending;
    },
    windowLoading(webContentsId) {
      readyWindows.delete(webContentsId);
    },
    removeWindow(webContentsId) {
      readyWindows.delete(webContentsId);
      pendingByWindow.delete(webContentsId);
    },
  };
}
