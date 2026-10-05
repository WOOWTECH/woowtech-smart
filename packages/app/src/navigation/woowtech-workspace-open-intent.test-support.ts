// Drives the app's notification and workspace navigation without rendering. Real: the app's
// navigation code, React Navigation's StackRouter, and expo-router's route tree built from the
// src/app file names. Transcribed from expo-router 6.0.23, because its routing modules import
// react-native and cannot load in the unit project: the action router.navigate,
// router.dismissTo and router.replace dispatch, and the merged params useGlobalSearchParams
// returns. Modeled: React Navigation starting a nested navigator from its parent's
// `screen`/`params`, the workspace route's open-intent effect, and the welcome screen's
// host-online effect. The witnesses in the tests check the transcription against the navigation
// state the Android runs recorded (woowtech-smart logs/ultra-device-s3b.txt,
// logs/integ0929-real-android-tap-probe.txt).
import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { NavigationContainerRefWithCurrent } from "@react-navigation/native";
import {
  CommonActions,
  StackActions,
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
import { shouldWelcomeMoveOnToHost } from "@/navigation/woowtech-welcome-host-online";
import {
  isAgentOpenIntentWaitingForWorkspace,
  readWorkspaceRouteOpenParam,
  type WorkspaceRouteOpenParams,
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
  decodeWorkspaceIdFromPathSegment,
  parseHostWorkspaceRouteFromPathname,
  parseWorkspaceOpenIntent,
  type WorkspaceOpenIntent,
} from "@/utils/host-routes";
import { resolveNavigateToAgent } from "@/utils/navigate-to-agent/resolve";
import { buildNotificationRoute, resolveNotificationTarget } from "@/utils/notification-routing";
import { prepareWorkspaceTab } from "@/utils/prepare-workspace-tab";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

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
const WELCOME_ROUTE_NAME = "welcome";
export const WORKSPACE_ROUTE_NAME = "workspace/[workspaceId]/index";

// The root-level screens the scenarios visit, by path.
const ROOT_LEAF_ROUTE_NAMES: Readonly<Record<string, string>> = {
  "/": "index",
  "/welcome": WELCOME_ROUTE_NAME,
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

// Only the file names shape the tree: no route file sets unstable_settings.
function createRouteContext(): RequireContext {
  const keys = listRouteFiles(join(__dirname, "../app"), ".");
  const load = () => ({ default: RouteScreen });
  return Object.assign(load, {
    keys: () => keys,
    resolve: (id: string) => id,
    id: "packages/app/src/app",
  }) as unknown as RequireContext;
}

// The route names of each navigator, keyed by the route that renders it. expo-router's own
// container stack holds only __root.
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

// The options expo-router's useStore passes for this app (app.config.js sets `router: {}`).
const routeTree = getRoutes(createRouteContext(), {
  skipGenerated: true,
  ignoreEntryPoints: true,
  platform: "android",
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

function hydrate(
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

// expo-router's getStateFromPath for the routes the scenarios visit: every path param on the
// focused route (the device's workspace route had both serverId and workspaceId), and ?open.
function actionStateFor(href: string): ActionRoute {
  const [pathname, search = ""] = href.split("?");
  const selection = parseHostWorkspaceRouteFromPathname(pathname);
  if (!selection) {
    const leafName = ROOT_LEAF_ROUTE_NAMES[pathname];
    if (!leafName) {
      throw new Error(`the scenarios do not visit ${href}`);
    }
    return { name: ROOT_SLOT_NAME, state: { routes: [{ name: leafName }] } };
  }
  const open = new URLSearchParams(search).get("open");
  const workspace: ActionRoute = {
    name: WORKSPACE_ROUTE_NAME,
    params: {
      serverId: selection.serverId,
      workspaceId: selection.workspaceId,
      ...(open === null ? {} : { open }),
    },
  };
  const host: ActionRoute = {
    name: HOST_ROUTE_NAME,
    params: { serverId: selection.serverId },
    state: { routes: [workspace] },
  };
  return { name: ROOT_SLOT_NAME, state: { routes: [host] } };
}

// expo-router's findDivergentState: the deepest navigator whose focused route still matches the
// href. Only a route named exactly `[param]` also compares its param (matchDynamicName), so
// h/[serverId] matches by name alone.
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

// expo-router's getPayloadFromStateRoute, line for line. Each level's params absorb the params of
// every deeper route ("React Nav merges them after the first layer"), so the route the action
// creates in the target navigator keeps a copy of the focused route's query, ?open included.
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

/** What useGlobalSearchParams returns: expo-router's getRouteInfoFromState merges the params of
 * every focused route below __root, deeper routes last. */
export function readMergedOpenParam(input: { container: StackState }): string {
  const merged: Params = {};
  let state = input.container.routes[input.container.index].state as StackState | undefined;
  while (state) {
    const route: StackRoute = state.routes[state.index];
    Object.assign(merged, route.params);
    state = route.state as StackState | undefined;
  }
  return paramValue(merged.open);
}

/**
 * The workspace route's open param, read the way app/h/[serverId]/workspace/[workspaceId]/index.tsx
 * reads it: its own params (useLocalSearchParams) through readWorkspaceRouteOpenParam.
 * woowtech/workspace-open-intent.test.mjs pins that line of the route.
 */
export function readOpenParamLikeWorkspaceRoute(input: {
  container: StackState;
  route: StackRoute;
}): string {
  return readWorkspaceRouteOpenParam((input.route.params ?? {}) as WorkspaceRouteOpenParams);
}

export type OpenParamReader = (input: { container: StackState; route: StackRoute }) => string;

interface NestedScreen {
  name: string;
  params: object | undefined;
  path: string | undefined;
  merge: boolean | undefined;
  pop: boolean | undefined;
}

// React Navigation's useNavigationBuilder (@react-navigation/core 7.16): a nested navigator
// starts on, or navigates to, `params.screen` with `params.params`, once per params object.
const consumedNestedParams = new WeakSet<object>();

function unconsumedNestedScreen(params: object | undefined): NestedScreen | null {
  if (!params || consumedNestedParams.has(params)) {
    return null;
  }
  const nested = params as {
    screen?: unknown;
    params?: object;
    path?: string;
    merge?: boolean;
    pop?: boolean;
  };
  if (typeof nested.screen !== "string") {
    return null;
  }
  return {
    name: nested.screen,
    params: nested.params,
    path: nested.path,
    merge: nested.merge,
    pop: nested.pop,
  };
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
  const state = hydrate(route.state, routeNames);
  if (!screen) {
    return state;
  }
  const next = stackRouter.getStateForAction(state, CommonActions.navigate(screen), options);
  return next ? hydrate(next, routeNames) : state;
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
  const state = hydrate(container, containerRouteNames);
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
    return hydrate(next, state.routeNames);
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

export interface FocusedRoute {
  route: StackRoute;
  navigator: StackState;
}

function focusedRouteIn(state: StackState): FocusedRoute {
  const route = state.routes[state.index];
  return route.state ? focusedRouteIn(route.state as StackState) : { route, navigator: state };
}

function paramValue(value: unknown): string {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" ? first.trim() : "";
}

export interface OpenedTab {
  workspaceKey: string;
  target: WorkspaceTabTarget;
  pin: boolean;
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

/** What the welcome screen's host-online effect sees on a render. */
export interface WelcomeEffectInput {
  /** useAnyHostOnline: the first host that is online, or null. */
  anyOnlineServerId: string | null;
  /** Whether this welcome screen is the focused route of the root stack. */
  isFocused: boolean;
}

/** The welcome screen's host-online effect: its dependency list and its body. */
export interface WelcomeEffectModel {
  deps(input: WelcomeEffectInput): readonly unknown[];
  /** Whether the body calls router.replace(buildOpenProjectRoute()). */
  movesOn(input: WelcomeEffectInput): boolean;
}

/** Upstream's components/welcome-screen.tsx (getpaseo/paseo 4965af219): `useEffect(() => {
 * if (!anyOnlineServerId) return; router.replace(buildOpenProjectRoute()); },
 * [anyOnlineServerId, router])`. */
export const welcomeEffectLikeUpstream: WelcomeEffectModel = {
  deps: ({ anyOnlineServerId }) => [anyOnlineServerId],
  movesOn: ({ anyOnlineServerId }) => Boolean(anyOnlineServerId),
};

/** The app's components/welcome-screen.tsx: `useEffect(() => { if
 * (!shouldWelcomeMoveOnToHost({ anyOnlineServerId, isFocused })) return;
 * router.replace(buildOpenProjectRoute()); }, [anyOnlineServerId, isFocused, router])`, with
 * isFocused from useIsFocused. woowtech/welcome-host-online.test.mjs pins those lines. */
export const welcomeEffectLikeWelcomeScreen: WelcomeEffectModel = {
  deps: ({ anyOnlineServerId, isFocused }) => [anyOnlineServerId, isFocused],
  movesOn: shouldWelcomeMoveOnToHost,
};

export interface NavigationScenario {
  readonly openedTabs: readonly OpenedTab[];
  /** A tapped push notification, as _layout.tsx's PushNotificationRouter handles it. */
  tapNotification(data: Record<string, string>): void;
  /** The host's workspace directory arrives, as after T1's directory demand. */
  directoryArrives(workspaceIds: string[]): void;
  /** A workspace row in the sidebar. */
  openWorkspaceFromSidebar(workspaceId: string): void;
  /** A link the app is opened with while it runs: expo-router's linking navigates to its path. */
  openLink(pathname: string): void;
  /** router.push(href) from anywhere in the app. */
  push(href: string): void;
  /** router.replace(href) from anywhere in the app. */
  replace(href: string): void;
  /** Android Back on a root-level screen. */
  back(): void;
  /** The first online host changes: it connects (a server ID) or its connection drops (null). */
  setAnyOnlineHost(serverId: string | null): void;
  focusedRoute(): FocusedRoute;
  /** The route names of the root stack, bottom first, with the focused one marked with `*`. */
  rootStack(): string[];
  hostRouteParams(): object | undefined;
  /** The workspace navigateToWorkspace remembered last (paseo:last-workspace-route-selection). */
  lastWorkspaceId(): string | null;
  dispose(): void;
}

export function createNavigationScenario(input: {
  serverId: string;
  /** The route the app shows first, such as /open-project after the welcome screen's Connect. */
  startAt: string;
  readOpenParam: OpenParamReader;
  /** The welcome screen's host-online effect. Defaults to the app's. */
  welcomeEffect?: WelcomeEffectModel;
}): NavigationScenario {
  const { serverId, readOpenParam } = input;
  const welcomeEffect = input.welcomeEffect ?? welcomeEffectLikeWelcomeScreen;
  let container = settle({
    routes: [actionStateFor(input.startAt)],
  } as unknown as PartialState<NavigationState>);
  const knownWorkspaceIds = new Set<string>();
  const openedTabs: OpenedTab[] = [];
  let lastWorkspaceId: string | null = null;
  let anyOnlineServerId: string | null = null;
  // HostWorkspaceRouteContent's consumedIntentRef, one per mounted workspace route.
  const consumedIntentByRouteKey = new Map<string, string>();
  // The dependency list each mounted welcome screen's effect last ran with.
  const welcomeEffectDepsByRouteKey = new Map<string, readonly unknown[]>();

  function dispatch(action: NavigationAction): void {
    const next = applyAction(container, action);
    if (!next) {
      throw new Error(`no navigator has the key ${String(action.target)}`);
    }
    container = settle(next);
  }

  // expo-router's linkTo -> getNavigateAction for a stack, without anchors or previews. The action
  // has no `source`, so StackRouter's REPLACE replaces the stack's focused route.
  function linkTo(type: "NAVIGATE" | "POP_TO" | "PUSH" | "REPLACE", href: string): void {
    const { navigator, route } = findDivergentNavigator(actionStateFor(href), container);
    const payload = payloadFromActionRoute(route);
    dispatch({
      type,
      target: navigator.key,
      payload: { name: payload.screen, params: payload.params },
    });
  }

  const current = {
    isReady: () => true,
    getRootState: () => container,
    dispatch,
  };
  const unregister = registerWorkspaceRouteNavigationRef({
    ...current,
    current,
    addListener: () => () => undefined,
  } as unknown as NavigationContainerRefWithCurrent<ReactNavigation.RootParamList>);

  const workspaceDeps: NavigateToWorkspaceDeps = {
    getSessionWorkspaces: () =>
      new Map(Array.from(knownWorkspaceIds, (id) => [id, { id } as WorkspaceDescriptor] as const)),
    getSessionAgents: () => [],
    isWorkspaceLayoutHydrated: () => true,
    openTab: ({ workspaceKey, target, pin = false }) => {
      openedTabs.push({ workspaceKey, target, pin });
      return null;
    },
    rememberLastWorkspace: (selection) => {
      lastWorkspaceId = selection.workspaceId;
    },
    navigateToRoute: (route) =>
      navigateToHostWorkspaceRoute(route, { dismissTo: (href) => linkTo("POP_TO", href) }),
  };

  function rootStackState(): StackState {
    const rootStack = container.routes[container.index].state as StackState | undefined;
    if (!rootStack) {
      throw new Error("the root stack is not mounted");
    }
    return rootStack;
  }

  function sameDeps(previous: readonly unknown[] | undefined, next: readonly unknown[]): boolean {
    return (
      previous !== undefined &&
      previous.length === next.length &&
      previous.every((value, index) => Object.is(value, next[index]))
    );
  }

  // WelcomeScreen's host-online effect, for every welcome screen the root stack keeps mounted:
  // it runs on mount and when its dependencies change. Returns whether it navigated.
  function runWelcomeEffects(): boolean {
    const rootStack = rootStackState();
    const focusedKey = rootStack.routes[rootStack.index].key;
    const mountedKeys = new Set<string>();
    for (const route of rootStack.routes) {
      if (route.name !== WELCOME_ROUTE_NAME) {
        continue;
      }
      mountedKeys.add(route.key);
      const effectInput: WelcomeEffectInput = {
        anyOnlineServerId,
        isFocused: route.key === focusedKey,
      };
      const deps = welcomeEffect.deps(effectInput);
      if (sameDeps(welcomeEffectDepsByRouteKey.get(route.key), deps)) {
        continue;
      }
      welcomeEffectDepsByRouteKey.set(route.key, deps);
      if (welcomeEffect.movesOn(effectInput)) {
        linkTo("REPLACE", "/open-project");
        return true;
      }
    }
    for (const key of welcomeEffectDepsByRouteKey.keys()) {
      if (!mountedKeys.has(key)) {
        welcomeEffectDepsByRouteKey.delete(key);
      }
    }
    return false;
  }

  // HostWorkspaceRouteContent's open-intent effect. Returns whether it changed the route params,
  // which runs the effect again.
  function runWorkspaceRouteEffect(): boolean {
    const { route, navigator } = focusedRouteIn(container);
    if (route.name !== WORKSPACE_ROUTE_NAME) {
      return false;
    }
    const params = (route.params ?? {}) as Params;
    const workspaceValue = paramValue(params.workspaceId);
    const workspaceId = decodeWorkspaceIdFromPathSegment(workspaceValue) ?? "";
    const openValue = readOpenParam({ container, route });
    const openIntent = parseWorkspaceOpenIntent(openValue);
    const waitingForWorkspace = isAgentOpenIntentWaitingForWorkspace({
      openIntent,
      workspaceExists: knownWorkspaceIds.has(workspaceId),
    });
    if (!openValue || waitingForWorkspace) {
      return false;
    }
    const consumptionKey = `${paramValue(params.serverId)}:${workspaceId}:${openValue}`;
    if (consumedIntentByRouteKey.get(route.key) !== consumptionKey) {
      consumedIntentByRouteKey.set(route.key, consumptionKey);
      if (openIntent) {
        prepareWorkspaceTab(
          {
            serverId: paramValue(params.serverId),
            workspaceId,
            target: openIntentTarget(openIntent),
            pin: openIntent.kind === "agent",
          },
          workspaceDeps,
        );
      }
    }
    // clearConsumedOpenIntent: navigation.setParams on the workspace route itself.
    dispatch({
      ...CommonActions.setParams({ open: undefined }),
      source: route.key,
      target: navigator.key,
    });
    return true;
  }

  function render(): void {
    for (let pass = 0; pass < 5; pass += 1) {
      if (!runWelcomeEffects() && !runWorkspaceRouteEffect()) {
        return;
      }
    }
    throw new Error("the screens' effects did not settle");
  }

  render();

  return {
    openedTabs,
    tapNotification(data) {
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
      } else {
        linkTo("NAVIGATE", buildNotificationRoute(data));
      }
      render();
    },
    directoryArrives(workspaceIds) {
      for (const workspaceId of workspaceIds) {
        knownWorkspaceIds.add(workspaceId);
      }
      render();
    },
    openWorkspaceFromSidebar(workspaceId) {
      navigateToWorkspace({ serverId, workspaceId }, workspaceDeps);
      render();
    },
    openLink(pathname) {
      linkTo("NAVIGATE", pathname);
      render();
    },
    push(href) {
      linkTo("PUSH", href);
      render();
    },
    replace(href) {
      linkTo("REPLACE", href);
      render();
    },
    back() {
      dispatch({ ...StackActions.pop(1), target: rootStackState().key });
      render();
    },
    setAnyOnlineHost(onlineServerId) {
      anyOnlineServerId = onlineServerId;
      render();
    },
    focusedRoute: () => focusedRouteIn(container),
    rootStack() {
      const rootStack = rootStackState();
      return rootStack.routes.map((route, index) =>
        index === rootStack.index ? `*${route.name}` : route.name,
      );
    },
    hostRouteParams() {
      const rootStack = container.routes[container.index].state as StackState | undefined;
      return rootStack?.routes.find((route) => route.name === HOST_ROUTE_NAME)?.params;
    },
    lastWorkspaceId: () => lastWorkspaceId,
    dispose: unregister,
  };
}
