import { buildHostRootRoute } from "@/utils/host-routes";
import type { NotificationOpenSource, NotificationTap } from "./source";

export const WEB_NOTIFICATION_CLICK_EVENT = "paseo:web-notification-click";

export type NotificationOpenTarget =
  | { kind: "agent"; serverId: string; agentId: string }
  | { kind: "terminal"; serverId: string; workspaceId: string; terminalId: string }
  | { kind: "host"; serverId: string };

function readId(data: object, key: string): string {
  const value: unknown = Reflect.get(data, key);
  return typeof value === "string" ? value.trim() : "";
}

export function parseNotificationOpenTarget(data: unknown): NotificationOpenTarget | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const serverId = readId(data, "serverId");
  if (!serverId) return null;
  const workspaceId = readId(data, "workspaceId");
  const terminalId = readId(data, "terminalId");
  if (workspaceId && terminalId) return { kind: "terminal", serverId, workspaceId, terminalId };
  const agentId = readId(data, "agentId");
  if (agentId) return { kind: "agent", serverId, agentId };
  return { kind: "host", serverId };
}

interface NotificationOpenRouterDeps {
  source: NotificationOpenSource;
  openAgent: (target: { serverId: string; agentId: string }) => void;
  openRoute: (route: string) => void;
  openTerminal: (target: Extract<NotificationOpenTarget, { kind: "terminal" }>) => void;
  whenReadyToNavigate: () => Promise<void>;
}

export function createNotificationOpenRouter(deps: NotificationOpenRouterDeps) {
  const handledIds = new Set<string>();
  const pending = new Map<string, NotificationTap>();
  let launchTaken = false;
  let started = false;
  let generation = 0;

  async function dispatch(tap: NotificationTap, subscriptionGeneration: number) {
    await deps.whenReadyToNavigate();
    // A tap consumed from the OS belongs to the next mount if this one disappeared before
    // navigation was ready. Do not acknowledge it or mark it handled until it is dispatched.
    if (!started || generation !== subscriptionGeneration || !pending.has(tap.id)) return;
    if (handledIds.has(tap.id)) return;
    pending.delete(tap.id);
    handledIds.add(tap.id);
    const target = parseNotificationOpenTarget(tap.data);
    if (target?.kind === "agent") {
      deps.openAgent({ serverId: target.serverId, agentId: target.agentId });
    } else if (target?.kind === "terminal") {
      deps.openTerminal(target);
    } else if (target?.kind === "host") {
      deps.openRoute(buildHostRootRoute(target.serverId));
    }
    deps.source.acknowledge(tap);
  }

  function receive(tap: NotificationTap) {
    if (handledIds.has(tap.id) || pending.has(tap.id)) return;
    pending.set(tap.id, tap);
    if (started) void dispatch(tap, generation);
  }

  return {
    start() {
      started = true;
      const subscriptionGeneration = ++generation;
      for (const tap of pending.values()) void dispatch(tap, subscriptionGeneration);
      const unsubscribe = deps.source.subscribe(receive);
      if (!launchTaken) {
        launchTaken = true;
        void deps.source.takeLaunchTap().then((tap) => {
          return tap ? receive(tap) : undefined;
        });
      }
      return () => {
        if (generation === subscriptionGeneration) started = false;
        unsubscribe();
      };
    },
  };
}
