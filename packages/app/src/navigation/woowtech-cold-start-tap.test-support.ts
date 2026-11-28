// Cold-start notification integration without rendering: production notification-open router,
// native adapter, agent/workspace resolvers, startup decisions and persisted layout store.
// Native delivery, directory arrivals and route effects are driven explicitly by the fixture.
// The stack adapter below models Expo's link dispatch; this is not a device/E2E test.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { NavigationContainerRefWithCurrent } from "expo-router/react-navigation";
// Expo's public navigation barrel loads native UI; this is its same pure router implementation.
import {
  CommonActions,
  StackRouter,
  type NavigationAction,
  type NavigationState,
  type ParamListBase,
  type PartialState,
  type StackNavigationState,
} from "expo-router/build/react-navigation/routers";
import { getRoutes } from "expo-router/build/getRoutes";
import type { RouteNode } from "expo-router/build/Route";
import type { RequireContext } from "expo-router/build/types";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  resolveHostIndexRoute,
  resolveStartupRoute,
  resolveWorkspaceSelectionStatus,
} from "@/navigation/host-runtime-bootstrap";
import { readWorkspaceRouteOpenParam } from "@/navigation/woowtech-workspace-open-intent";
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
  type OpenWorkspaceTabInput,
} from "@/stores/workspace-layout-store";
import {
  decodeWorkspaceIdFromPathSegment,
  parseHostWorkspaceRouteFromPathname,
  parseServerIdFromPathname,
  parseWorkspaceOpenIntent,
  type WorkspaceOpenIntent,
} from "@/utils/host-routes";
import { resolveNavigateToAgent } from "@/utils/navigate-to-agent/resolve";
import { createNotificationOpenRouter } from "@/notification-open";
import {
  createNativeNotificationOpenSource,
  type NativeNotifications,
  type NativeNotificationResponse,
} from "@/notification-open/native";
import { resolveAgentRoute, type AgentRouteLookup } from "@/navigation/agent-route-resolution";
import { prepareWorkspaceTab } from "@/utils/prepare-workspace-tab";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
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
const AGENT_ROUTE_NAME = "agent/[agentId]";
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
  const agentPath = /^\/h\/([^/]+)\/agent\/([^/]+)$/.exec(pathname);
  if (agentPath) {
    const serverId = decodeURIComponent(agentPath[1]);
    return {
      name: ROOT_SLOT_NAME,
      state: {
        routes: [
          {
            name: HOST_ROUTE_NAME,
            params: { serverId },
            state: {
              routes: [
                {
                  name: AGENT_ROUTE_NAME,
                  params: { serverId, agentId: decodeURIComponent(agentPath[2]) },
                },
              ],
            },
          },
        ],
      },
    };
  }
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

export interface ColdStartInput {
  serverId: string;
  rememberedWorkspaceId: string | null;
}

/** Typed Expo adapter: optionally replays Android's pending list when a listener remounts. */
export class NativeNotificationEmitter implements NativeNotifications {
  lastResponse: NativeNotificationResponse | null = null;
  clearCalls = 0;
  replayPendingOnSubscribe = false;
  private readonly pending: NativeNotificationResponse[] = [];
  private readonly listeners = new Set<(response: NativeNotificationResponse) => void>();
  private deliveryClock = 1_700_000_000;

  tap(identifier: string, data: Record<string, string> | null): void {
    const response: NativeNotificationResponse = {
      notification: {
        date: ++this.deliveryClock,
        request: { identifier, content: { data: data ?? undefined } },
      },
    };
    this.pending.push(response);
    this.lastResponse = response;
    for (const listener of this.listeners) listener(response);
  }
  setNotificationHandler(): void {}
  async getLastNotificationResponseAsync() {
    return this.lastResponse;
  }
  clearLastNotificationResponse(): void {
    this.clearCalls++;
    this.lastResponse = null;
  }
  addNotificationResponseReceivedListener(
    listener: (response: NativeNotificationResponse) => void,
  ) {
    this.listeners.add(listener);
    if (this.replayPendingOnSubscribe) for (const response of this.pending) listener(response);
    return {
      remove: () => {
        this.listeners.delete(listener);
      },
    };
  }
}

const LAYOUT_STORAGE_KEY = "workspace-layout-state";
async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let round = 0; round < rounds; round++) await Promise.resolve();
}

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
  mountRouter(): Promise<void>;
  unmountRouter(): void;
  settle(): Promise<void>;
  layoutHydrates(): Promise<void>;
  selectionHydrates(): void;
  hostRegistryLoads(): void;
  cacheRestores(content: DirectoryContent): void;
  liveDirectoryArrives(content: DirectoryContent): void;
  agentLookupCompletes(agentId: string, workspaceId: string | null): void;
  tapWhileRunning(identifier: string, data: Record<string, string> | null): Promise<void>;
  userFocusesAgent(agentId: string): void;
  setHoldHostIndexRedirect(hold: boolean): void;
  visible(): string;
  recovery(): { requested: boolean; inspects: boolean } | null;
  openTabCalls: { workspaceKey: string; agentId: string | null; pin: boolean; hydrated: boolean }[];
  agentTabs(workspaceId: string): string[];
  rootStack(): string[];
  dispose(): void;
}

export function createColdStartScenario(input: ColdStartInput): ColdStartScenario {
  const { serverId } = input;
  const native = new NativeNotificationEmitter();
  const openTabCalls: ColdStartScenario["openTabCalls"] = [];
  let releaseLayoutHydration = () => {};
  const layoutGate = new Promise<void>((resolve) => {
    releaseLayoutHydration = resolve;
  });
  // Inject storage so delaying this process's hydration cannot affect other stores.
  const layoutStore = createWorkspaceLayoutStore(undefined, {
    getItem: (key) => {
      const value = AsyncStorage.getItem(key);
      return layoutGate.then(() => value);
    },
    setItem: (key, value) => AsyncStorage.setItem(key, value),
    removeItem: (key) => AsyncStorage.removeItem(key),
  });
  let container = settle({
    routes: [actionStateFor("/")],
  } as unknown as PartialState<NavigationState>);
  let registryLoaded = false;
  let selectionHydrated = false;
  let selection = input.rememberedWorkspaceId
    ? { serverId, workspaceId: input.rememberedWorkspaceId }
    : null;
  let cached: DirectoryContent | null = null;
  let live: DirectoryContent | null = null;
  const lookups = new Map<string, AgentRouteLookup>();
  const readyWaiters = new Set<() => void>();
  let unmountCurrentRouter: (() => void) | null = null;
  let holdHostIndex = false;

  function dispatch(action: NavigationAction): void {
    const next = applyAction(container, action);
    if (!next) throw new Error(`no navigator has the key ${String(action.target)}`);
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
    addListener: () => () => {},
  } as unknown as NavigationContainerRefWithCurrent<ReactNavigation.RootParamList>);

  const directory = () => live ?? cached;
  const workspaceExists = (id: string) =>
    registryLoaded && (directory()?.workspaceIds.includes(id) ?? false);
  const agentWorkspace = (id: string) =>
    directory()?.agents.find((agent) => agent.id === id)?.workspaceId;
  function recordOpen(tab: OpenWorkspaceTabInput) {
    openTabCalls.push({
      workspaceKey: tab.workspaceKey,
      agentId: tab.target.kind === "agent" ? tab.target.agentId : null,
      pin: tab.pin === true,
      hydrated: layoutStore.persist.hasHydrated(),
    });
  }
  const workspaceDeps: NavigateToWorkspaceDeps = {
    getSessionWorkspaces: () =>
      registryLoaded
        ? new Map(
            (directory()?.workspaceIds ?? []).map((id) => [id, { id } as WorkspaceDescriptor]),
          )
        : undefined,
    isWorkspaceLayoutHydrated: () => layoutStore.persist.hasHydrated(),
    deferOpenTab: (tab) => layoutStore.getState().deferOpenTab(tab),
    openTab: (tab) => {
      recordOpen(tab);
      return layoutStore.getState().openTab(tab);
    },
    revealTab: () => {},
    revealWorkspace: (key) => layoutStore.getState().focusWorkspace(key),
    rememberLastWorkspace: (next) => {
      selection = next;
    },
    navigateToRoute: (route) =>
      navigateToHostWorkspaceRoute(route, { dismissTo: (href) => linkTo("POP_TO", href) }),
  };
  function navigateAgent(target: { serverId: string; agentId: string; workspaceId?: string }) {
    resolveNavigateToAgent(
      { ...target, pin: true },
      {
        readAgentNavTarget: ({ agentId }) => ({ agentWorkspaceId: agentWorkspace(agentId) }),
        navigateToHostAgent: (route) => linkTo("NAVIGATE", route),
        navigateToWorkspace: (navigation) => navigateToWorkspace(navigation, workspaceDeps),
      },
    );
  }
  function canNavigate() {
    const { route, depth } = focusedRouteIn(container);
    const atIndex = route.name === "index" && (depth === 1 || depth === 2);
    return registryLoaded && selectionHydrated && !atIndex;
  }
  const notifications = createNotificationOpenRouter({
    source: createNativeNotificationOpenSource(native),
    whenReadyToNavigate: () =>
      canNavigate()
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            readyWaiters.add(resolve);
          }),
    openAgent: (target) => {
      navigateAgent(target);
      render();
    },
    openTerminal: ({ serverId: targetServerId, workspaceId, terminalId }) => {
      navigateToWorkspace(
        { serverId: targetServerId, workspaceId, target: { kind: "terminal", terminalId } },
        workspaceDeps,
      );
      render();
    },
    openRoute: (route) => {
      linkTo("NAVIGATE", route);
      render();
    },
  });

  function selectionStatus() {
    return resolveWorkspaceSelectionStatus({
      hasHydratedWorkspaces: live !== null,
      workspaceExists: selection ? workspaceExists(selection.workspaceId) : false,
    });
  }
  function runStartupRedirect(): boolean {
    const { route, depth } = focusedRouteIn(container);
    if (route.name !== "index") return false;
    if (depth === 1) {
      const decision = resolveStartupRoute({
        route: { kind: "index", pathname: "/" },
        startupBlocker: { kind: "none" },
        hostRegistryStatus: registryLoaded ? "ready" : "loading",
        hosts: registryLoaded ? [{ serverId }] : [],
        anyOnlineHostServerId: live ? serverId : null,
        workspaceSelection: selection,
        workspaceSelectionStatus: selectionStatus(),
        isWorkspaceSelectionLoaded: selectionHydrated,
        hasGivenUpWaitingForHost: false,
        isWaitingForSetup: false,
      });
      if (decision.kind !== "redirect") return false;
      linkTo("REPLACE", String(decision.href));
      return true;
    }
    if (depth !== 2 || !registryLoaded || !selectionHydrated || holdHostIndex) return false;
    linkTo(
      "REPLACE",
      String(
        resolveHostIndexRoute({
          serverId,
          workspaceSelection: selection,
          workspaceSelectionStatus: selectionStatus(),
        }),
      ),
    );
    return true;
  }
  function runAgentRouteEffect(): boolean {
    const { route } = focusedRouteIn(container);
    if (route.name !== AGENT_ROUTE_NAME || !registryLoaded) return false;
    const agentId = paramValue((route.params as Params)?.agentId);
    const resolution = resolveAgentRoute({
      serverId,
      agentId,
      cachedWorkspaceId: agentWorkspace(agentId),
      connectionStatus: live ? "online" : "offline",
      lookup: lookups.get(agentId) ?? { kind: "idle" },
      hasHydratedWorkspaces: live !== null,
      hasHydratedLayout: layoutStore.persist.hasHydrated(),
    });
    if (resolution.kind === "resolved") {
      navigateAgent({ serverId, agentId, workspaceId: resolution.workspaceId });
      return true;
    }
    if (resolution.kind === "notFound") {
      linkTo("REPLACE", `/h/${serverId}`);
      return true;
    }
    return false;
  }
  // Legacy ?open= bookmarks enter pending model state; internal notifications never create it.
  function runWorkspaceRouteEffect(): boolean {
    const { route, navigator } = focusedRouteIn(container);
    if (route.name !== WORKSPACE_ROUTE_NAME || !registryLoaded) return false;
    const params = (route.params ?? {}) as Params;
    const workspaceId = decodeWorkspaceIdFromPathSegment(paramValue(params.workspaceId)) ?? "";
    const openValue = readWorkspaceRouteOpenParam(params);
    if (!openValue) return false;
    const intent = parseWorkspaceOpenIntent(openValue);
    if (intent)
      prepareWorkspaceTab(
        { serverId, workspaceId, target: openIntentTarget(intent), pin: intent.kind === "agent" },
        { openTab: workspaceDeps.deferOpenTab },
      );
    dispatch({
      ...CommonActions.setParams({ open: undefined }),
      source: route.key,
      target: navigator.key,
    });
    return true;
  }
  function focusedWorkspace(): string | null {
    const { route } = focusedRouteIn(container);
    return route.name === WORKSPACE_ROUTE_NAME
      ? decodeWorkspaceIdFromPathSegment(paramValue((route.params as Params)?.workspaceId))
      : null;
  }
  function reconcileWorkspace() {
    const workspaceId = focusedWorkspace();
    if (!workspaceId || !layoutStore.persist.hasHydrated()) return;
    const workspaceKey = `${serverId}:${workspaceId}`;
    // usePendingWorkspaceOpen gates consumption on the live directory and layout, not payload hints.
    const pending = layoutStore.getState().pendingOpenByWorkspace[workspaceKey];
    if (pending && live && workspaceExists(workspaceId)) {
      recordOpen(pending);
      layoutStore.getState().consumePendingOpen(workspaceKey);
    }
    const agentIds = new Set(
      (directory()?.agents ?? [])
        .filter((agent) => agent.workspaceId === workspaceId)
        .map((agent) => agent.id),
    );
    layoutStore.getState().reconcileTabs(workspaceKey, {
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
    for (let pass = 0; pass < 12; pass++) {
      const changed = runStartupRedirect() || runAgentRouteEffect() || runWorkspaceRouteEffect();
      reconcileWorkspace();
      if (!changed) {
        if (canNavigate()) {
          for (const resolve of readyWaiters) resolve();
          readyWaiters.clear();
        }
        return;
      }
    }
    throw new Error("route effects did not settle");
  }
  async function settleEffects() {
    render();
    await flushMicrotasks();
    render();
  }
  function agentTabs(workspaceId: string): string[] {
    const layout = layoutStore.getState().layoutByWorkspace[`${serverId}:${workspaceId}`];
    return layout
      ? collectAllTabs(layout.root).flatMap((tab) =>
          tab.target.kind === "agent" ? [tab.target.agentId] : [],
        )
      : [];
  }
  function visible(): string {
    const workspaceId = focusedWorkspace();
    if (workspaceId) {
      const layout = layoutStore.getState().layoutByWorkspace[`${serverId}:${workspaceId}`];
      const focusedTabId = layout && findPaneById(layout.root, layout.focusedPaneId)?.focusedTabId;
      const tab =
        layout && collectAllTabs(layout.root).find((candidate) => candidate.tabId === focusedTabId);
      return `${workspaceId}/${tab?.target.kind === "agent" ? tab.target.agentId : "-"}`;
    }
    const { route, depth } = focusedRouteIn(container);
    if (route.name === AGENT_ROUTE_NAME)
      return `agent:${paramValue((route.params as Params)?.agentId)}`;
    return depth === 2 ? `host:${route.name}` : route.name;
  }

  return {
    native,
    openTabCalls,
    agentTabs,
    visible,
    settle: settleEffects,
    async mountRouter() {
      unmountCurrentRouter?.();
      unmountCurrentRouter = notifications.start();
      await settleEffects();
    },
    unmountRouter() {
      unmountCurrentRouter?.();
      unmountCurrentRouter = null;
    },
    async layoutHydrates() {
      releaseLayoutHydration();
      await settleEffects();
      if (!layoutStore.persist.hasHydrated()) throw new Error("layout did not hydrate");
    },
    selectionHydrates() {
      selectionHydrated = true;
      render();
    },
    hostRegistryLoads() {
      registryLoaded = true;
      render();
    },
    cacheRestores(content) {
      cached = content;
      render();
    },
    liveDirectoryArrives(content) {
      live = content;
      render();
    },
    agentLookupCompletes(agentId, workspaceId) {
      lookups.set(agentId, { kind: "found", workspaceId });
      render();
    },
    async tapWhileRunning(identifier, data) {
      native.tap(identifier, data);
      await settleEffects();
    },
    userFocusesAgent(agentId) {
      const workspaceId = focusedWorkspace();
      if (!workspaceId) throw new Error("no workspace is visible");
      layoutStore.getState().openTab({
        workspaceKey: `${serverId}:${workspaceId}`,
        target: { kind: "agent", agentId },
        intent: "reveal",
      });
      render();
    },
    setHoldHostIndexRedirect(hold) {
      holdHostIndex = hold;
      render();
    },
    recovery() {
      const workspaceId = focusedWorkspace();
      if (!workspaceId) return null;
      const pending = layoutStore.getState().pendingOpenByWorkspace[`${serverId}:${workspaceId}`];
      const requested = pending?.target.kind === "agent";
      return { requested, inspects: requested && live !== null && !workspaceExists(workspaceId) };
    },
    rootStack() {
      const root = container.routes[container.index].state as StackState;
      return root.routes.map((route, index) =>
        index === root.index ? `*${route.name}` : route.name,
      );
    },
    dispose() {
      unmountCurrentRouter?.();
      unregister();
    },
  };
}
