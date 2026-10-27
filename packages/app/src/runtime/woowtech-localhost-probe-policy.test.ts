import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decideLocalhostProbe,
  isBrowserRuntime,
  isLoopbackHostname,
  isMobileBrowser,
  NATIVE_RELEASE_AUTO_PROBE,
  PUBLIC_WEB_AUTO_PROBE,
  shouldAutoProbeLocalhost,
  shouldOfferThisComputerAction,
  type ProbePolicyInput,
} from "./woowtech-localhost-probe-policy";

// O2 (owner, 2026-10-27): the public web app and phone releases no longer probe localhost at boot.
const UPSTREAM = { publicWebAutoProbe: true, nativeReleaseAutoProbe: true };
const OURS = { publicWebAutoProbe: false, nativeReleaseAutoProbe: false };

function input(overrides: Partial<ProbePolicyInput>): ProbePolicyInput {
  return {
    platform: "web",
    dev: false,
    electron: false,
    location: { protocol: "https:", hostname: "app.example.test" },
    mobileBrowser: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("probing localhost at boot", () => {
  it("ships with the owner's defaults", () => {
    expect({ PUBLIC_WEB_AUTO_PROBE, NATIVE_RELEASE_AUTO_PROBE }).toEqual({
      PUBLIC_WEB_AUTO_PROBE: false,
      NATIVE_RELEASE_AUTO_PROBE: false,
    });
  });

  it("phones probe only in development builds, unless the release constant says so", () => {
    for (const platform of ["ios", "android"]) {
      expect(decideLocalhostProbe(input({ platform, location: null }), OURS)).toEqual({
        autoProbe: false,
        offerThisComputer: false,
      });
      expect(decideLocalhostProbe(input({ platform, location: null, dev: true }), OURS)).toEqual({
        autoProbe: true,
        offerThisComputer: false,
      });
      expect(decideLocalhostProbe(input({ platform, location: null }), UPSTREAM)).toEqual({
        autoProbe: true,
        offerThisComputer: false,
      });
    }
  });

  it("Electron keeps upstream's probe and has no button", () => {
    expect(decideLocalhostProbe(input({ electron: true }), OURS)).toEqual({
      autoProbe: true,
      offerThisComputer: false,
    });
  });

  it("probes where there is no window, as the host runtime's own tests expect", () => {
    expect(decideLocalhostProbe(input({ location: null }), OURS)).toEqual({
      autoProbe: true,
      offerThisComputer: false,
    });
  });

  it("probes from pages that are not https: the dev server and a daemon's own http page", () => {
    for (const page of [
      { protocol: "http:", hostname: "metro-host" },
      { protocol: "http:", hostname: "192.168.1.20" },
      // host-runtime.test.ts stubs a window whose location has a host but no hostname.
      { protocol: "http:" },
    ]) {
      expect(decideLocalhostProbe(input({ location: page }), OURS)).toEqual({
        autoProbe: true,
        offerThisComputer: false,
      });
    }
  });

  it("probes from https pages this computer serves", () => {
    for (const hostname of ["localhost", "127.0.0.1", "127.8.9.10", "[::1]", "::1"]) {
      expect(
        decideLocalhostProbe(input({ location: { protocol: "https:", hostname } }), OURS),
      ).toEqual({ autoProbe: true, offerThisComputer: false });
    }
  });

  it("public https pages do not probe and offer the button in desktop browsers", () => {
    for (const hostname of ["app.example.test", "woowtech-smart-web.pages.dev", "10.0.0.5"]) {
      expect(
        decideLocalhostProbe(input({ location: { protocol: "https:", hostname } }), OURS),
      ).toEqual({ autoProbe: false, offerThisComputer: true });
    }
  });

  it("phone browsers get neither the probe nor the button", () => {
    expect(decideLocalhostProbe(input({ mobileBrowser: true }), OURS)).toEqual({
      autoProbe: false,
      offerThisComputer: false,
    });
  });

  it("public pages probe again, without the button, when the constant goes back to upstream", () => {
    expect(decideLocalhostProbe(input({}), UPSTREAM)).toEqual({
      autoProbe: true,
      offerThisComputer: false,
    });
  });

  it("does not throw on a location without a hostname", () => {
    expect(() =>
      decideLocalhostProbe(input({ location: { protocol: "https:" } }), OURS),
    ).not.toThrow();
    expect(decideLocalhostProbe(input({ location: {} }), OURS).autoProbe).toBe(true);
  });
});

describe("reading the runtime", () => {
  it("treats vitest's node environment as no browser and probes like upstream", () => {
    vi.stubGlobal("window", undefined);
    expect(isBrowserRuntime()).toBe(false);
    expect(shouldAutoProbeLocalhost()).toBe(true);
    expect(shouldOfferThisComputerAction()).toBe(false);
  });

  it("reads a public https page in a desktop browser", () => {
    vi.stubGlobal("window", { location: { protocol: "https:", hostname: "app.example.test" } });
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (Macintosh) Chrome/155",
      platform: "MacIntel",
      maxTouchPoints: 0,
    });
    expect(isBrowserRuntime()).toBe(true);
    expect(shouldAutoProbeLocalhost()).toBe(false);
    expect(shouldOfferThisComputerAction()).toBe(true);
  });

  it("hides the button from a phone's browser", () => {
    vi.stubGlobal("window", { location: { protocol: "https:", hostname: "app.example.test" } });
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Linux; Android 15) Chrome/155 Mobile" });
    expect(shouldAutoProbeLocalhost()).toBe(false);
    expect(shouldOfferThisComputerAction()).toBe(false);
  });

  it("is not a browser inside Electron", () => {
    vi.stubGlobal("window", {
      location: { protocol: "https:", hostname: "app.example.test" },
      paseoDesktop: {},
    });
    expect(isBrowserRuntime()).toBe(false);
  });

  it("does not throw where window has no location, as in a React Native release build", () => {
    vi.stubGlobal("window", {});
    expect(() => shouldAutoProbeLocalhost()).not.toThrow();
    expect(shouldAutoProbeLocalhost()).toBe(true);
    expect(shouldOfferThisComputerAction()).toBe(false);
  });
});

describe("phone browsers", () => {
  it("are told apart from desktop browsers", () => {
    expect(isMobileBrowser({ userAgentData: { mobile: true }, userAgent: "" })).toBe(true);
    for (const userAgent of [
      "Mozilla/5.0 (Linux; Android 15; Pixel 7) Chrome/155 Mobile Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Safari/604.1",
      "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Safari/604.1",
      "Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)",
    ]) {
      expect(isMobileBrowser({ userAgent })).toBe(true);
    }
    // iPadOS asks for the desktop site and reports a Mac with a touch screen.
    expect(
      isMobileBrowser({
        userAgent: "Mozilla/5.0 (Macintosh)",
        platform: "MacIntel",
        maxTouchPoints: 5,
      }),
    ).toBe(true);
    expect(
      isMobileBrowser({
        userAgent: "Mozilla/5.0 (Macintosh)",
        platform: "MacIntel",
        maxTouchPoints: 0,
      }),
    ).toBe(false);
    expect(isMobileBrowser({ userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/155" })).toBe(false);
    expect(isMobileBrowser(undefined)).toBe(false);
  });
});

describe("loopback host names", () => {
  it("are localhost, 127.0.0.0/8 and ::1, with or without brackets", () => {
    for (const hostname of ["localhost", "LOCALHOST", "127.0.0.1", "127.255.0.9", "[::1]", "::1"]) {
      expect(isLoopbackHostname(hostname)).toBe(true);
    }
    for (const hostname of ["", "127.0.0", "128.0.0.1", "localhost.example", "10.0.0.1", "[::2]"]) {
      expect(isLoopbackHostname(hostname)).toBe(false);
    }
  });
});
