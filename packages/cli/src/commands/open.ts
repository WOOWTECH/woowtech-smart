import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnProcess } from "@getpaseo/server/process";
import { buildAgentDeepLink, type AgentDeepLinkTarget } from "@getpaseo/protocol/agent-deep-link";
import { BRAND_LINKS } from "@getpaseo/protocol/brand-links";
import { DESKTOP_APP_NAME } from "@getpaseo/protocol/brand-desktop";
import { windowsDesktopAppPath } from "./woowtech-windows-desktop-app.js";

function findDesktopApp(): string | null {
  if (process.platform === "darwin") {
    const candidates = [
      `/Applications/${DESKTOP_APP_NAME}.app`,
      path.join(homedir(), "Applications", `${DESKTOP_APP_NAME}.app`),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  if (process.platform === "linux") {
    const candidates = [
      `/usr/bin/${DESKTOP_APP_NAME}`,
      `/opt/${DESKTOP_APP_NAME}/${DESKTOP_APP_NAME}`,
      path.join(homedir(), "Applications", `${DESKTOP_APP_NAME}.AppImage`),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  if (process.platform === "win32") {
    return windowsDesktopAppPath({
      env: process.env,
      execPath: process.execPath,
      exists: existsSync,
    });
  }

  return null;
}

function cleanEnvForDesktopLaunch(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  // The CLI runs via ELECTRON_RUN_AS_NODE=1. On Linux/Windows the spawned
  // desktop process inherits the env directly, so we must strip it or the
  // desktop app would start as a bare Node process instead of Electron.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  delete env.PASEO_NODE_ENV;
  return env;
}

function spawnDetached(command: string, args: string[]): void {
  spawnProcess(command, args, {
    detached: true,
    stdio: "ignore",
    env: cleanEnvForDesktopLaunch(),
  }).unref();
}

function launchDesktop(args: string[]): void {
  if (process.env.PASEO_DESKTOP_CLI === "1") {
    throw new Error(
      `Cannot open ${DESKTOP_APP_NAME} Desktop while running in desktop CLI passthrough mode.`,
    );
  }

  const desktopApp = findDesktopApp();
  if (!desktopApp) {
    throw new Error(
      `${DESKTOP_APP_NAME} desktop app not found. Install it from ${BRAND_LINKS.releases}`,
    );
  }

  if (process.platform === "darwin") {
    // -n forces a new instance even if the app is already running. The new
    // instance relays its argv to the existing one through Electron's
    // single-instance lock. -g keeps the terminal in the foreground.
    spawnDetached("open", ["-n", "-g", "-a", desktopApp, "--args", ...args]);
    return;
  }

  if (process.platform === "win32") {
    // woowtech smart: spawnProcess hides every child's window, and Windows applies that to a GUI
    // app's first window, so a cold start would show nothing (H5 F4).
    spawn(desktopApp, args, {
      detached: true,
      stdio: "ignore",
      env: cleanEnvForDesktopLaunch(),
      windowsHide: false,
    }).unref();
    return;
  }

  spawnDetached(desktopApp, args);
}

export async function openDesktopWithProject(projectPath: string): Promise<void> {
  try {
    launchDesktop([projectPath]);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) throw error;
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

export async function openDesktopWithAgent(target: AgentDeepLinkTarget): Promise<void> {
  launchDesktop([buildAgentDeepLink(target)]);
}
