// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
// vitest resolves the .web file first, as Metro does for the web app.
import {
  clearPairingLinkFromAddressBar,
  REMEMBER_HANDLED_PAIRING_LINKS,
} from "./woowtech-pairing-address-bar";

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("the web app's address bar after a pairing link", () => {
  it("drops the whole fragment and keeps the path, the query and expo-router's history state", () => {
    window.history.replaceState({ id: "x" }, "", "/settings/general?a=1#offer=abc");

    clearPairingLinkFromAddressBar();

    expect({
      hash: window.location.hash,
      pathname: window.location.pathname,
      search: window.location.search,
      state: window.history.state,
    }).toEqual({ hash: "", pathname: "/settings/general", search: "?a=1", state: { id: "x" } });
  });

  it("drops a fragment that carries offer= after another #, which is never imported", () => {
    window.history.replaceState({ id: "y" }, "", "/#x#offer=abc");

    clearPairingLinkFromAddressBar();

    expect(window.location.hash).toBe("");
    expect(window.history.state).toEqual({ id: "y" });
  });

  it("leaves other fragments alone", () => {
    window.history.replaceState({ id: "z" }, "", "/settings#other");

    clearPairingLinkFromAddressBar();

    expect(window.location.hash).toBe("#other");
  });

  it("remembers links it handled: every message event reports the same address again", () => {
    expect(REMEMBER_HANDLED_PAIRING_LINKS).toBe(true);
  });

  it("does nothing without a window, as in the node test environment", () => {
    vi.stubGlobal("window", undefined);
    expect(() => clearPairingLinkFromAddressBar()).not.toThrow();
  });
});
