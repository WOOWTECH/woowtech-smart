import { Platform } from "react-native";
import { isDev, isWeb } from "@/constants/platform";
import { isElectronRuntime } from "@/desktop/host";

// woowtech smart (fork-owned; woowtech/README.md, 19): when the app looks for a daemon on this
// computer by itself. Upstream probes localhost on every boot. On a public https page that shows
// every visitor without a daemon the browser's local network prompt, and anything already
// listening on the port, such as another app on the same phone, joins the app without a click.
// The public web app waits for "Connect to this computer" instead, and phone release builds,
// where no daemon runs, do not probe (owner decision O2, 2026-10-27). Setting a constant to true
// restores upstream's probe there.

/** O2: true probes localhost at boot on public https pages too, as upstream does. */
export const PUBLIC_WEB_AUTO_PROBE = false;
/** O2: true probes localhost at boot in iOS and Android release builds, as upstream does. */
export const NATIVE_RELEASE_AUTO_PROBE = false;

export interface ProbePolicyInput {
  /** Platform.OS. */
  platform: string;
  /** __DEV__, false when it is not defined. */
  dev: boolean;
  /** isElectronRuntime(). */
  electron: boolean;
  /** The page's location; null without a window. */
  location: { protocol?: string; hostname?: string } | null;
  mobileBrowser: boolean;
}

export interface ProbePolicyDefaults {
  publicWebAutoProbe: boolean;
  nativeReleaseAutoProbe: boolean;
}

export interface LocalhostProbeDecision {
  /** Probe localhost:6770 while the app boots. */
  autoProbe: boolean;
  /** Show "Connect to this computer" on the welcome screen. */
  offerThisComputer: boolean;
}

const OWNER_DEFAULTS: ProbePolicyDefaults = {
  publicWebAutoProbe: PUBLIC_WEB_AUTO_PROBE,
  nativeReleaseAutoProbe: NATIVE_RELEASE_AUTO_PROBE,
};

const LOOPBACK_IPV4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** localhost, 127.0.0.0/8 or ::1; IPv6 with or without the brackets a URL puts around it. */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || LOOPBACK_IPV4.test(host) || host === "::1" || host === "[::1]";
}

export function decideLocalhostProbe(
  input: ProbePolicyInput,
  defaults: ProbePolicyDefaults = OWNER_DEFAULTS,
): LocalhostProbeDecision {
  if (input.platform !== "web") {
    // Phones run no daemon. Development builds keep the probe: the iOS simulator shares the Mac's
    // localhost.
    return { autoProbe: input.dev || defaults.nativeReleaseAutoProbe, offerThisComputer: false };
  }
  // Electron never gets here (runBoot returns for the desktop daemon first). Without a window
  // (unit tests), on http pages (the dev server, a daemon's own page) and on this computer's own
  // pages the app probes as upstream does.
  const page = input.location;
  const isPublicPage =
    !input.electron &&
    page !== null &&
    page.protocol === "https:" &&
    !isLoopbackHostname(page.hostname ?? "");
  if (!isPublicPage || defaults.publicWebAutoProbe) {
    return { autoProbe: true, offerThisComputer: false };
  }
  return { autoProbe: false, offerThisComputer: !input.mobileBrowser };
}

interface NavigatorLike {
  userAgent?: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { mobile?: boolean };
}

const MOBILE_USER_AGENT = /Android|iPhone|iPad|iPod/;

export function isMobileBrowser(navigatorLike: NavigatorLike | undefined): boolean {
  if (!navigatorLike) return false;
  if (navigatorLike.userAgentData?.mobile === true) return true;
  if (MOBILE_USER_AGENT.test(navigatorLike.userAgent ?? "")) return true;
  // iPadOS asks for desktop sites and reports a Mac, but a Mac has no touch screen.
  return navigatorLike.platform === "MacIntel" && (navigatorLike.maxTouchPoints ?? 0) > 1;
}

function currentLocation(): ProbePolicyInput["location"] {
  return typeof window === "undefined" ? null : window.location;
}

function currentNavigator(): NavigatorLike | undefined {
  return typeof navigator === "undefined" ? undefined : navigator;
}

function currentDecision(): LocalhostProbeDecision {
  return decideLocalhostProbe({
    platform: Platform.OS,
    dev: isDev,
    electron: isElectronRuntime(),
    location: currentLocation(),
    mobileBrowser: isMobileBrowser(currentNavigator()),
  });
}

/** HostRuntimeStore.runBoot's question: probe localhost:6770 now? */
export function shouldAutoProbeLocalhost(): boolean {
  return currentDecision().autoProbe;
}

/** Whether the welcome screen shows "Connect to this computer". */
export function shouldOfferThisComputerAction(): boolean {
  return currentDecision().offerThisComputer;
}

/**
 * The app runs in a browser tab: web with a window, not Electron. A host added here is kept in
 * this browser's storage.
 */
export function isBrowserRuntime(): boolean {
  return isWeb && typeof window !== "undefined" && !isElectronRuntime();
}
