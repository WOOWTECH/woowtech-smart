// RC-I-21c (woowtech/README.md section 16): a cold start from a notification tap, without
// rendering. Extends the T1 S3 harness (woowtech-workspace-open-intent.test-support.ts) with what a
// cold start adds: the root index and host index startup restore, the cached directory that lands
// before the live one, the persisted workspace layout that remembers each workspace's focused
// agent, and PushNotificationRouter's tap hand-over.
//
// Real: resolveNotificationTarget / buildNotificationRoute, resolveNavigateToAgent,
// navigateToWorkspace, navigateToHostWorkspaceRoute, prepareWorkspaceTab, resolveStartupRoute /
// resolveHostIndexRoute / resolveWorkspaceSelectionStatus, readWorkspaceRouteOpenParam,
// isAgentOpenIntentWaitingForWorkspace, subscribeToNotificationTaps, createWorkspaceLayoutStore
// (openTab, reconcileTabs, persist merge), React Navigation's StackRouter and expo-router's route
// tree from the src/app file names.
// Transcribed from expo-router 6.0.23 as in the T1 S3 harness: linkTo's findDivergentState and
// getPayloadFromStateRoute. Modeled: Redirect (router.replace while focused), the workspace route's
// open-intent effect and render gate (app/h/[serverId]/workspace/[workspaceId]/index.tsx), the
// WorkspaceScreen reconcile effect, and, for the witnesses, upstream's wait rule and
// PushNotificationRouter.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { NavigationContainerRefWithCurrent } from "@react-navigation/native";
import {
  CommonActions,
  StackRouter,
  type NavigationAction,
  type NavigationState,
  type ParamListBase,
  type PartialState,
  type StackNavigationState,
} from "@react-navigation/routers";
import { getRoutes } from "expo-router/build/getRoutes";
import type { RouteNode } from "expo-router/build/Route";
import type { RequireContext } from "expo-router/build/types";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  resolveHostIndexRoute,
  resolveStartupRoute,
  resolveWorkspaceSelectionStatus,
} from "@/navigation/host-runtime-bootstrap";
import {
  isAgentOpenIntentWaitingForWorkspace,
  readWorkspaceRouteOpenParam,
} from "@/navigation/woowtech-workspace-open-intent";
import {
  navigateToHostWorkspaceRoute,
  registerWorkspaceRouteNavigationRef,
} from "@/navigation/workspace-route-navigation";
import {
  navigateToWorkspace,
  type NavigateToWorkspaceDeps,
} from "@/stores/navigation-active-workspace-store/navigation";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import {
  collectAllTabs,
  createWorkspaceLayoutStore,
  findPaneById,
} from "@/stores/workspace-layout-store";
import {
  decodeWorkspaceIdFromPathSegment,
  parseHostWorkspaceRouteFromPathname,
  parseServerIdFromPathname,
  parseWorkspaceOpenIntent,
  type WorkspaceOpenIntent,
} from "@/utils/host-routes";
import { resolveNavigateToAgent } from "@/utils/navigate-to-agent/resolve";
import { buildNotificationRoute, resolveNotificationTarget } from "@/utils/notification-routing";
import { prepareWorkspaceTab } from "@/utils/prepare-workspace-tab";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import {
  subscribeToNotificationTaps,
  type NotificationResponseLike,
  type NotificationResponseSource,
} from "@/navigation/woowtech-notification-response";

const APP_ROUTES_DIR = join(__dirname, "../app");

type StackState = StackNavigationState<ParamListBase>;
type StackRoute = StackState["routes"][number];
type Params = Record<string, unknown>;

interface ActionRoute {
  name: string;
  params?: Params;
  state?: { routes: ActionRoute[] };
}

const ROOT_SLOT_NAME = "__root";
const HOST_ROUTE_NAME = "h/[serverId]";
const HOST_INDEX_ROUTE_NAME = "index";
export const WORKSPACE_ROUTE_NAME = "workspace/[workspaceId]/index";

const ROOT_LEAF_ROUTE_NAMES: Readonly<Record<string, string>> = {
  "/": "index",
  "/welcome": "welcome",
  "/open-project": "open-project",
  "/settings": "settings/index",
};

function listRouteFiles(directory: string, prefix: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const key = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      return listRouteFiles(join(directory, entry.name), key);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [key] : [];
  });
}

function RouteScreen(): null {
  return null;
}

function createRouteContext(): RequireContext {
  const keys = listRouteFiles(APP_ROUTES_DIR, ".");
  const load = () => ({ default: RouteScreen });
  return Object.assign(load, {
    keys: () => keys,
    resolve: (id: string) => id,
    id: "packages/app/src/app",
  }) as unknown as RequireContext;
}

function collectNavigatorRouteNames(
  node: RouteNode,
  hostRouteName: string,
  names: Map<string, string[]>,
): Map<string, string[]> {
  names.set(
    hostRouteName,
    node.children.map((child) => child.route),
  );
  for (const child of node.children) {
    if (child.children.length > 0) {
      collectNavigatorRouteNames(child, child.route, names);
    }
  }
  return names;
}

const routeTree = getRoutes(createRouteContext(), {
  skipGenerated: true,
  ignoreEntryPoints: true,
  platform: "ios",
  preserveRedirectAndRewrites: true,
});
if (!routeTree) {
  throw new Error("expo-router found no routes in packages/app/src/app");
}
const navigatorRouteNames = collectNavigatorRouteNames(routeTree, ROOT_SLOT_NAME, new Map());
const containerRouteNames = [ROOT_SLOT_NAME];
const stackRouter = StackRouter({});

function routerOptions(routeNames: string[]) {
  return { routeNames, routeParamList: {}, routeGetIdList: {} };
}

function hydrateState(
  state: NavigationState | PartialState<NavigationState>,
  routeNames: string[],
): StackState {
  if (state.stale === false) {
    return state as StackState;
  }
  return stackRouter.getRehydratedState(
    state as PartialState<StackState>,
    routerOptions(routeNames),
  );
}

// expo-router's getStateFromPath for the paths these scenarios visit: root leaves, the host root
// (/h/<server>, whose focused child is the host index), and workspace routes with ?open.
function actionStateFor(href: string): ActionRoute {
  const [pathname, search = ""] = href.split("?");
  const selection = parseHostWorkspaceRouteFromPathname(pathname);
  if (selection) {
    const open = new URLSearchParams(search).get("open");
    const workspace: ActionRoute = {
      name: WORKSPACE_ROUTE_NAME,
      params: {
        serverId: selection.serverId,
        workspaceId: selection.workspaceId,
        ...(open === null ? {} : { open }),
      },
    };
    return {
      name: ROOT_SLOT_NAME,
      state: {
        routes: [
          {
            name: HOST_ROUTE_NAME,
            params: { serverId: selection.serverId },
            state: { routes: [workspace] },
          },
        ],
      },
    };
  }
  const hostServerId = parseServerIdFromPathname(pathname);
  if (hostServerId && /^\/h\/[^/]+\/?$/.test(pathname)) {
    return {
      name: ROOT_SLOT_NAME,
      state: {
        routes: [
          {
            name: HOST_ROUTE_NAME,
            params: { serverId: hostServerId },
            state: {
              routes: [{ name: HOST_INDEX_ROUTE_NAME, params: { serverId: hostServerId } }],
            },
          },
        ],
      },
    };
  }
  const leafName = ROOT_LEAF_ROUTE_NAMES[pathname];
  if (!leafName) {
    throw new Error(`the scenarios do not visit ${href}`);
  }
  return { name: ROOT_SLOT_NAME, state: { routes: [{ name: leafName }] } };
}

function findDivergentNavigator(
  action: ActionRoute,
  container: StackState,
): { navigator: StackState; route: ActionRoute } {
  let navigator = container;
  let actionRoute = action;
  for (;;) {
    const focused = navigator.routes[navigator.index];
    const focusedNavigator = focused.state as StackState | undefined;
    const actionChildren = actionRoute.state?.routes;
    const dynamicName = /^\[([^[\]]+?)\]$/.exec(actionRoute.name)?.[1];
    if (
      actionRoute.name !== focused.name ||
      !actionChildren ||
      !focusedNavigator ||
      (dynamicName !== undefined &&
        actionRoute.params?.[dynamicName] !== (focused.params as Params | undefined)?.[dynamicName])
    ) {
      return { navigator, route: actionRoute };
    }
    navigator = focusedNavigator;
    actionRoute = actionChildren[actionChildren.length - 1];
  }
}

function payloadFromActionRoute(actionRoute: ActionRoute): Params {
  const rootPayload: Params = { params: {} };
  let payload = rootPayload;
  let params = payload.params as Params;
  let route: ActionRoute | undefined = actionRoute;
  while (route) {
    Object.assign(params, { ...(payload.params as Params), ...route.params });
    payload.screen = route.name;
    payload.params = { ...params };
    delete (payload.params as Params).screen;
    payload = payload.params as Params;
    params = payload;
    const children: ActionRoute[] | undefined = route.state?.routes;
    route = children ? children[children.length - 1] : undefined;
  }
  return rootPayload;
}

const consumedNestedParams = new WeakSet<object>();

function unconsumedNestedScreen(params: object | undefined) {
  if (!params || consumedNestedParams.has(params)) {
    return null;
  }
  const nested = params as { screen?: unknown; params?: object; path?: string };
  if (typeof nested.screen !== "string") {
    return null;
  }
  return { name: nested.screen, params: nested.params, path: nested.path };
}

function settleNestedNavigator(route: StackRoute, routeNames: string[]): StackState {
  const options = routerOptions(routeNames);
  const screen = unconsumedNestedScreen(route.params);
  if (!route.state) {
    return screen
      ? stackRouter.getRehydratedState(
          { routes: [{ name: screen.name, params: screen.params, path: screen.path }] },
          options,
        )
      : stackRouter.getInitialState(options);
  }
  const state = hydrateState(route.state, routeNames);
  if (!screen) {
    return state;
  }
  const next = stackRouter.getStateForAction(state, CommonActions.navigate(screen), options);
  return next ? hydrateState(next, routeNames) : state;
}

function settleRoute(route: StackRoute): StackRoute {
  const routeNames = navigatorRouteNames.get(route.name);
  if (!routeNames) {
    return route;
  }
  const state = settleNestedNavigator(route, routeNames);
  if (route.params) {
    consumedNestedParams.add(route.params);
  }
  return { ...route, state: { ...state, routes: state.routes.map(settleRoute) } };
}

function settle(container: StackState | PartialState<NavigationState>): StackState {
  const state = hydrateState(container, containerRouteNames);
  return { ...state, routes: state.routes.map(settleRoute) };
}

function applyAction(state: StackState, action: NavigationAction): StackState | null {
  if (state.key === action.target) {
    const next = stackRouter.getStateForAction(
      state,
      action as Parameters<typeof stackRouter.getStateForAction>[1],
      routerOptions(state.routeNames),
    );
    if (!next) {
      throw new Error(`${action.type} was not handled by ${state.key}`);
    }
    return hydrateState(next, state.routeNames);
  }
  let handled = false;
  const routes = state.routes.map((route) => {
    const child = route.state && !handled ? applyAction(route.state as StackState, action) : null;
    if (!child) {
      return route;
    }
    handled = true;
    return { ...route, state: child };
  });
  return handled ? { ...state, routes } : null;
}

interface FocusedRoute {
  route: StackRoute;
  navigator: StackState;
  depth: number;
}

function focusedRouteIn(state: StackState, depth = 0): FocusedRoute {
  const route = state.routes[state.index];
  return route.state
    ? focusedRouteIn(route.state as StackState, depth + 1)
    : { route, navigator: state, depth };
}

function paramValue(value: unknown): string {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first.trim() : "";
}

function openIntentTarget(intent: WorkspaceOpenIntent): WorkspaceTabTarget {
  if (intent.kind === "agent") {
    return { kind: "agent", agentId: intent.agentId };
  }
  if (intent.kind === "terminal") {
    return { kind: "terminal", terminalId: intent.terminalId };
  }
  throw new Error(`the scenarios do not open ${intent.kind} intents`);
}

export interface DirectoryContent {
  workspaceIds: string[];
  agents: { id: string; workspaceId: string }[];
}

export interface PersistedWorkspaceLayout {
  workspaceId: string;
  agentIds: string[];
  focusedAgentId: string;
}

/** upstream: wait for the live snapshot too. app: isAgentOpenIntentWaitingForWorkspace. */
export type OpenIntentWaitRule = "upstream" | "app";
/** upstream: a per-mount useRef de-dupe, nothing cleared. app: subscribeToNotificationTaps. */
export type RouterKind = "upstream" | "app";

export interface ColdStartInput {
  serverId: string;
  persistedLayouts: PersistedWorkspaceLayout[];
  rememberedWorkspaceId: string | null;
  waitRule: OpenIntentWaitRule;
  router: RouterKind;
}

type Response = NotificationResponseLike;

/** expo-notifications' iOS emitter: one lastResponse per module instance, listeners get each tap. */
export class NativeNotificationEmitter implements NotificationResponseSource {
  lastResponse: Response | null = null;
  clearCalls = 0;
  private readonly listeners = new Set<(response: Response) => void>();

  tap(identifier: string, data: Record<string, string> | null): void {
    const response: Response = {
      notification: { request: { identifier, content: { data } } },
    };
    this.lastResponse = response;
    for (const listener of this.listeners) {
      listener(response);
    }
  }

  getLastNotificationResponse(): Response | null {
    return this.lastResponse;
  }

  clearLastNotificationResponse(): void {
    this.clearCalls += 1;
    this.lastResponse = null;
  }

  addNotificationResponseReceivedListener(listener: (response: Response) => void) {
    this.listeners.add(listener);
    return { remove: () => this.listeners.delete(listener) };
  }
}

const LAYOUT_STORAGE_KEY = "workspace-layout-state";

async function flushMicrotasks(rounds = 10): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await Promise.resolve();
  }
}

/** Writes what the previous app process persisted: tabs per workspace and the focused agent. */
export async function seedPreviousProcess(
  serverId: string,
  layouts: PersistedWorkspaceLayout[],
): Promise<void> {
  await AsyncStorage.removeItem(LAYOUT_STORAGE_KEY);
  const previous = createWorkspaceLayoutStore();
  await flushMicrotasks();
  for (const layout of layouts) {
    const workspaceKey = `${serverId}:${layout.workspaceId}`;
    for (const agentId of layout.agentIds) {
      previous
        .getState()
        .openTab({ workspaceKey, target: { kind: "agent", agentId }, intent: "reveal" });
    }
    previous.getState().openTab({
      workspaceKey,
      target: { kind: "agent", agentId: layout.focusedAgentId },
      intent: "reveal",
    });
  }
  await flushMicrotasks();
}

export interface ColdStartScenario {
  native: NativeNotificationEmitter;
  timeline: string[];
  /** PushNotificationRouter mounts (first commit of the root layout) or remounts. */
  mountRouter(): Promise<void>;
  unmountRouter(): void;
  /** The persisted workspace layout finishes hydrating (zustand persist over AsyncStorage). */
  layoutHydrates(): Promise<void>;
  /** paseo:last-workspace-route-selection finishes hydrating. */
  selectionHydrates(): void;
  /** The host registry loads: the session exists, HostRouteBootstrapBoundary renders children. */
  hostRegistryLoads(): void;
  /** DirectorySync.restoreCachedDirectory lands, right after the registry (host-runtime.ts). */
  cacheRestores(content: DirectoryContent): void;
  /** The first live directory snapshot lands: hasHydratedWorkspaces / hasHydratedAgents. */
  liveDirectoryArrives(content: DirectoryContent): void;
  /** A tap while the app runs (listener delivery). */
  tapWhileRunning(identifier: string, data: Record<string, string> | null): void;
  /** The user picks a tab in the visible workspace. */
  userFocusesAgent(agentId: string): void;
  /** Keeps the host index mounted and focused without redirecting yet (Redirect's extra commit). */
  setHoldHostIndexRedirect(hold: boolean): void;
  visible(): string;
  openTabCalls: { workspaceKey: string; agentId: string | null; pin: boolean; hydrated: boolean }[];
  rootStack(): string[];
  dispose(): void;
}

/**
 * A new app process. The tap that launched it, if any, must be put on `native` before
 * mountRouter() (iOS delivers it to the emitter before JS reads it).
 */
export function createColdStartScenario(input: ColdStartInput): ColdStartScenario {
  const { serverId } = input;
  const native = new NativeNotificationEmitter();
  const timeline: string[] = [];
  const openTabCalls: ColdStartScenario["openTabCalls"] = [];

  // Hold the new store's hydration read until layoutHydrates().
  let releaseLayoutHydration!: () => void;
  const layoutGate = new Promise<void>((resolve) => {
    releaseLayoutHydration = resolve;
  });
  const storage = AsyncStorage as unknown as { getItem: (key: string) => Promise<string | null> };
  const originalGetItem = storage.getItem;
  // The read is issued now and answers with what disk held now (AsyncStorage serializes its
  // operations), but the answer reaches the store only when layoutHydrates() opens the gate.
  storage.getItem = (key: string) => {
    const value = originalGetItem(key);
    return layoutGate.then(() => value);
  };
  const layoutStore = createWorkspaceLayoutStore();
  storage.getItem = originalGetItem;

  let container = settle({
    routes: [actionStateFor("/")],
  } as unknown as PartialState<NavigationState>);
  let registryLoaded = false;
  let selectionHydrated = false;
  let selection: { serverId: string; workspaceId: string } | null = input.rememberedWorkspaceId
    ? { serverId, workspaceId: input.rememberedWorkspaceId }
    : null;
  let rememberedBeforeHydration: { serverId: string; workspaceId: string } | null = null;
  let cached: DirectoryContent | null = null;
  let live: DirectoryContent | null = null;
  // Per mounted workspace route (HostWorkspaceRouteContent): consumedIntentRef, intentConsumed.
  const routeStateByKey = new Map<
    string,
    { consumedKey: string | null; intentConsumed: boolean }
  >();
  let unmountCurrentRouter: (() => void) | null = null;
  let holdHostIndex = false;

  function dispatch(action: NavigationAction): void {
    const next = applyAction(container, action);
    if (!next) {
      throw new Error(`no navigator has the key ${String(action.target)}`);
    }
    container = settle(next);
  }

  function linkTo(type: "NAVIGATE" | "POP_TO" | "PUSH" | "REPLACE", href: string): void {
    const { navigator, route } = findDivergentNavigator(actionStateFor(href), container);
    const payload = payloadFromActionRoute(route);
    dispatch({
      type,
      target: navigator.key,
      payload: { name: payload.screen, params: payload.params },
    });
  }

  const current = { isReady: () => true, getRootState: () => container, dispatch };
  const unregister = registerWorkspaceRouteNavigationRef({
    ...current,
    current,
    addListener: () => () => undefined,
  } as unknown as NavigationContainerRefWithCurrent<ReactNavigation.RootParamList>);

  function sessionWorkspaceIds(): Set<string> {
    return new Set([...(cached?.workspaceIds ?? []), ...(live?.workspaceIds ?? [])]);
  }

  function sessionAgents(): { id: string; workspaceId: string }[] {
    const byId = new Map<string, { id: string; workspaceId: string }>();
    for (const agent of [...(cached?.agents ?? []), ...(live?.agents ?? [])]) {
      byId.set(agent.id, agent);
    }
    return [...byId.values()];
  }

  const workspaceDeps: NavigateToWorkspaceDeps = {
    getSessionWorkspaces: () =>
      registryLoaded
        ? new Map(
            Array.from(sessionWorkspaceIds(), (id) => [id, { id } as WorkspaceDescriptor] as const),
          )
        : undefined,
    getSessionAgents: () => [],
    isWorkspaceLayoutHydrated: () => layoutStore.persist.hasHydrated(),
    openTab: (tab) => {
      openTabCalls.push({
        workspaceKey: tab.workspaceKey,
        agentId: tab.target.kind === "agent" ? tab.target.agentId : null,
        pin: tab.pin === true,
        hydrated: layoutStore.persist.hasHydrated(),
      });
      return layoutStore.getState().openTab(tab);
    },
    rememberLastWorkspace: (next) => {
      selection = next;
      if (!selectionHydrated) {
        rememberedBeforeHydration = next;
      }
    },
    navigateToRoute: (route) =>
      navigateToHostWorkspaceRoute(route, { dismissTo: (href) => linkTo("POP_TO", href) }),
  };

  // PushNotificationRouter.openNotification (app/_layout.tsx).
  function openNotification(data: Record<string, unknown> | undefined): void {
    const target = resolveNotificationTarget(data);
    if (target.serverId && target.workspaceId && target.agentId) {
      resolveNavigateToAgent(
        {
          serverId: target.serverId,
          workspaceId: target.workspaceId,
          agentId: target.agentId,
          pin: true,
        },
        {
          readAgentNavTarget: () => ({ agentWorkspaceId: null }),
          navigateToHostAgent: (route) => linkTo("NAVIGATE", route),
          navigateToWorkspace: (navigation) => navigateToWorkspace(navigation, workspaceDeps),
        },
      );
      return;
    }
    linkTo("NAVIGATE", buildNotificationRoute(data));
  }

  // Upstream's PushNotificationRouter (getpaseo/paseo, app/_layout.tsx): a per-mount useRef
  // de-dupe and getLastNotificationResponseAsync, nothing cleared.
  function mountRouterLikeUpstream(): () => void {
    let lastHandledId: string | null = null;
    const openFromResponse = (response: Response) => {
      const identifier = response.notification.request.identifier;
      if (lastHandledId === identifier) {
        return;
      }
      lastHandledId = identifier;
      openNotification(
        response.notification.request.content.data as Record<string, unknown> | undefined,
      );
      render();
    };
    const subscription = native.addNotificationResponseReceivedListener(openFromResponse);
    const last = native.getLastNotificationResponse();
    if (last) {
      openFromResponse(last);
    }
    return () => subscription.remove();
  }

  function mountRouterLikeApp(): () => void {
    return subscribeToNotificationTaps(native, (data) => {
      openNotification(data);
      render();
    });
  }

  function workspaceExists(workspaceId: string): boolean {
    return registryLoaded && sessionWorkspaceIds().has(workspaceId);
  }

  function isWaitingForWorkspace(intent: WorkspaceOpenIntent | null, workspaceId: string): boolean {
    const exists = workspaceExists(workspaceId);
    if (input.waitRule === "app") {
      return isAgentOpenIntentWaitingForWorkspace({ openIntent: intent, workspaceExists: exists });
    }
    // Upstream's line: isAgentOpenIntent && (!hasHydratedWorkspaces || !workspaceExists).
    return intent?.kind === "agent" && (live === null || !exists);
  }

  function selectionStatus(workspaceId: string | null) {
    return resolveWorkspaceSelectionStatus({
      hasHydratedWorkspaces: live !== null,
      workspaceExists: workspaceId ? workspaceExists(workspaceId) : false,
    });
  }

  // app/index.tsx: <Redirect> once resolveStartupRoute says so, only while focused.
  function runRootIndexRedirect(): boolean {
    const { route, depth } = focusedRouteIn(container);
    if (route.name !== "index" || depth !== 1) {
      return false;
    }
    const decision = resolveStartupRoute({
      route: { kind: "index", pathname: "/" },
      startupBlocker: { kind: "none" },
      hostRegistryStatus: registryLoaded ? "ready" : "loading",
      hosts: registryLoaded ? [{ serverId }] : [],
      anyOnlineHostServerId: live ? serverId : null,
      workspaceSelection: selection,
      workspaceSelectionStatus: selectionStatus(selection?.workspaceId ?? null),
      isWorkspaceSelectionLoaded: selectionHydrated,
      hasGivenUpWaitingForHost: false,
    });
    if (decision.kind !== "redirect") {
      return false;
    }
    linkTo("REPLACE", String(decision.href));
    return true;
  }

  // app/h/[serverId]/index.tsx: <Redirect href={resolveHostIndexRoute(...)}> once hydrated.
  // expo-router's Redirect fires from useFocusEffect only after useOptionalNavigation has loaded
  // (link/useLoadedNavigation.js), one commit after the host index first renders; holdHostIndex
  // keeps the scenario inside that window.
  function runHostIndexRedirect(): boolean {
    const { route, depth } = focusedRouteIn(container);
    if (route.name !== HOST_INDEX_ROUTE_NAME || depth !== 2 || !registryLoaded) {
      return false;
    }
    if (!selectionHydrated || holdHostIndex) {
      return false;
    }
    const workspaceId = selection?.serverId === serverId ? selection.workspaceId : null;
    linkTo(
      "REPLACE",
      String(
        resolveHostIndexRoute({
          serverId,
          workspaceSelection: selection,
          workspaceSelectionStatus: selectionStatus(workspaceId),
        }),
      ),
    );
    return true;
  }

  // HostWorkspaceRouteContent's open-intent effect (workspace/[workspaceId]/index.tsx).
  function runWorkspaceRouteEffect(): boolean {
    const { route, navigator } = focusedRouteIn(container);
    if (route.name !== WORKSPACE_ROUTE_NAME || !registryLoaded) {
      return false;
    }
    const params = (route.params ?? {}) as Params;
    const routeServerId = paramValue(params.serverId);
    const workspaceId = decodeWorkspaceIdFromPathSegment(paramValue(params.workspaceId)) ?? "";
    const openValue = readWorkspaceRouteOpenParam(params);
    const openIntent = parseWorkspaceOpenIntent(openValue);
    if (!openValue || !layoutStore.persist.hasHydrated()) {
      return false;
    }
    if (isWaitingForWorkspace(openIntent, workspaceId)) {
      return false;
    }
    let routeState = routeStateByKey.get(route.key);
    if (!routeState) {
      routeState = { consumedKey: null, intentConsumed: false };
      routeStateByKey.set(route.key, routeState);
    }
    const consumptionKey = `${routeServerId}:${workspaceId}:${openValue}`;
    if (routeState.consumedKey !== consumptionKey) {
      routeState.consumedKey = consumptionKey;
      if (openIntent) {
        prepareWorkspaceTab(
          {
            serverId: routeServerId,
            workspaceId,
            target: openIntentTarget(openIntent),
            pin: openIntent.kind === "agent",
          },
          workspaceDeps,
        );
      }
    }
    dispatch({
      ...CommonActions.setParams({ open: undefined }),
      source: route.key,
      target: navigator.key,
    });
    routeState.intentConsumed = true;
    return true;
  }

  function focusedAgentIn(workspaceId: string): string | null {
    const layout = layoutStore.getState().layoutByWorkspace[`${serverId}:${workspaceId}`];
    if (!layout) {
      return null;
    }
    const tabId = findPaneById(layout.root, layout.focusedPaneId)?.focusedTabId;
    const tab = collectAllTabs(layout.root).find((candidate) => candidate.tabId === tabId);
    return tab?.target.kind === "agent" ? tab.target.agentId : null;
  }

  // What HostWorkspaceRouteContent renders: null, or the deck for the route's workspace.
  function workspaceRouteView(): { workspaceId: string } | "blank" | "splash" | null {
    const { route } = focusedRouteIn(container);
    if (route.name !== WORKSPACE_ROUTE_NAME) {
      return null;
    }
    if (!registryLoaded) {
      return "splash";
    }
    const params = (route.params ?? {}) as Params;
    const workspaceId = decodeWorkspaceIdFromPathSegment(paramValue(params.workspaceId)) ?? "";
    const openValue = readWorkspaceRouteOpenParam(params);
    const waiting = isWaitingForWorkspace(parseWorkspaceOpenIntent(openValue), workspaceId);
    const intentConsumed = routeStateByKey.get(route.key)?.intentConsumed ?? false;
    if (openValue && !waiting && (!intentConsumed || !layoutStore.persist.hasHydrated())) {
      return "blank";
    }
    return { workspaceId };
  }

  // WorkspaceScreen's reconcileTabs layout effect (workspace-screen.tsx) for the deck.
  function runWorkspaceScreenReconcile(): void {
    const view = workspaceRouteView();
    if (!view || typeof view === "string" || !layoutStore.persist.hasHydrated()) {
      return;
    }
    const agentIds = new Set(
      sessionAgents()
        .filter((agent) => agent.workspaceId === view.workspaceId)
        .map((agent) => agent.id),
    );
    layoutStore.getState().reconcileTabs(`${serverId}:${view.workspaceId}`, {
      agentsHydrated: live !== null,
      terminalsHydrated: false,
      activeAgentIds: agentIds,
      autoOpenAgentIds: agentIds,
      knownTerminalIds: [],
      standaloneTerminalIds: [],
      hasActivePendingTerminalCreate: false,
      hasActivePendingDraftCreate: false,
    });
  }

  function render(): void {
    for (let pass = 0; pass < 12; pass += 1) {
      const changed = runRootIndexRedirect() || runHostIndexRedirect() || runWorkspaceRouteEffect();
      runWorkspaceScreenReconcile();
      if (!changed) {
        return;
      }
    }
    throw new Error("the screens' effects did not settle");
  }

  function visible(): string {
    const view = workspaceRouteView();
    if (view === "blank" || view === "splash") {
      return view;
    }
    if (view) {
      return `${view.workspaceId}/${focusedAgentIn(view.workspaceId) ?? "-"}`;
    }
    const { route, depth } = focusedRouteIn(container);
    return depth === 2 ? `host:${route.name}` : route.name;
  }

  function record(label: string): void {
    timeline.push(`${label} -> ${visible()}`);
  }

  record("launch");

  return {
    native,
    timeline,
    openTabCalls,
    async mountRouter() {
      unmountCurrentRouter?.();
      unmountCurrentRouter =
        input.router === "upstream" ? mountRouterLikeUpstream() : mountRouterLikeApp();
      render();
      record("router mounted");
    },
    unmountRouter() {
      unmountCurrentRouter?.();
      unmountCurrentRouter = null;
    },
    async layoutHydrates() {
      releaseLayoutHydration();
      await flushMicrotasks(20);
      if (!layoutStore.persist.hasHydrated()) {
        throw new Error("the layout store did not hydrate");
      }
      render();
      record("layout hydrated");
    },
    selectionHydrates() {
      selectionHydrated = true;
      // last-workspace-selection.ts: a remember() before hydration wins over the disk value.
      if (rememberedBeforeHydration) {
        selection = rememberedBeforeHydration;
      }
      render();
      record("selection hydrated");
    },
    hostRegistryLoads() {
      registryLoaded = true;
      render();
      record("registry loaded");
    },
    cacheRestores(content) {
      cached = content;
      render();
      record("cache restored");
    },
    liveDirectoryArrives(content) {
      live = content;
      render();
      record("live directory");
    },
    tapWhileRunning(identifier, data) {
      native.tap(identifier, data);
      render();
      record(`tap ${identifier}`);
    },
    userFocusesAgent(agentId) {
      const view = workspaceRouteView();
      if (!view || typeof view === "string") {
        throw new Error("no workspace is visible");
      }
      layoutStore.getState().openTab({
        workspaceKey: `${serverId}:${view.workspaceId}`,
        target: { kind: "agent", agentId },
        intent: "reveal",
      });
      render();
      record(`user focuses ${agentId}`);
    },
    setHoldHostIndexRedirect(hold) {
      holdHostIndex = hold;
      render();
      record(hold ? "host index redirect held" : "host index redirect released");
    },
    visible,
    rootStack() {
      const rootStack = container.routes[container.index].state as StackState;
      return rootStack.routes.map((route, index) =>
        index === rootStack.index ? `*${route.name}` : route.name,
      );
    },
    dispose() {
      unmountCurrentRouter?.();
      unregister();
    },
  };
}
