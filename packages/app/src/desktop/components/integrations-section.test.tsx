/**
 * @vitest-environment jsdom
 */
import { i18n as testI18n } from "@/i18n/i18next";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationsSection } from "./integrations-section";

const cli = vi.hoisted(() => ({ installed: false }));

vi.mock("@/desktop/daemon/desktop-daemon", () => ({
  shouldUseDesktopDaemon: () => true,
}));

vi.mock("@/desktop/hooks/use-install-status", () => ({
  useCliInstall: () => ({
    status: { installed: cli.installed },
    isLoading: false,
    isInstalling: false,
    error: null,
    install: () => {},
    refresh: () => {},
  }),
}));

vi.mock("@react-navigation/native", () => ({
  useFocusEffect: () => {},
}));

// The official Paseo installs `paseo` into the same ~/.local/bin. The row names
// the command this app installs, so people know what to type; it shows it before
// and after the install, so the row keeps its height when the status arrives.
describe("the command line row in Settings > Integrations", () => {
  beforeAll(async () => {
    if (!testI18n.isInitialized) {
      await testI18n.init();
    }
  });

  beforeEach(() => {
    vi.stubGlobal("React", React);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("names the woowtech-smart command, installed or not", () => {
    for (const installed of [false, true]) {
      cli.installed = installed;
      render(<IntegrationsSection />);

      expect(screen.getByText("Command line")).toBeTruthy();
      expect(screen.getByText(installed ? "Installed" : "Install")).toBeTruthy();
      expect(screen.getByText("woowtech-smart")).toBeTruthy();
      expect(screen.queryByText(/\bpaseo\b/)).toBeNull();
      cleanup();
    }
  });
});
