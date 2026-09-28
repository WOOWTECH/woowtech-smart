import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import {
  checkProviderLaunchAvailable,
  resolveProviderLaunch,
} from "../server/agent/provider-launch-config.js";
import { isPlatform } from "../test-utils/platform.js";
import { probeExecutable } from "./executable-resolution.js";
import {
  builtinLaunchDefault,
  claudeFallbackLocations,
  findDefaultClaudeExecutable,
  type ClaudeExecutableIo,
} from "./woowtech-claude-fallback.js";

// The order woowtech/README.md §3 documents. `~` is the daemon's home directory.
const FALLBACKS = [
  "~/.local/bin/claude",
  "~/.claude/local/claude",
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
] as const;

const FAKE_CLAUDE = '#!/bin/sh\necho "2.1.283 (Claude Code)"\n';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A machine inside a temporary directory, with its own file system root, home
 * directory and PATH directory. Nothing here reaches the real home or the real
 * /opt/homebrew and /usr/local, so no real `claude` ever runs.
 */
function fakeMachine(options: { platform?: NodeJS.Platform } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "woowtech-claude-fallback-"));
  tempDirs.push(root);
  const home = path.join(root, "home", "someone");
  const pathDir = path.join(root, "path-bin");
  mkdirSync(home, { recursive: true });
  mkdirSync(pathDir, { recursive: true });
  const pathLookups: string[] = [];

  const at = (location: string): string =>
    location.startsWith("~/") ? path.join(home, location.slice(2)) : path.join(root, location);

  const write = (file: string, contents: string, mode: number): string => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
    chmodSync(file, mode);
    return file;
  };

  const io: ClaudeExecutableIo = {
    platform: options.platform ?? process.platform,
    homeDir: () => home,
    rootDir: root,
    // PATH holds only this machine's PATH directory.
    findOnPath: async (name) => {
      pathLookups.push(name);
      const candidate = path.join(pathDir, name);
      return (await probeExecutable(candidate)) ? candidate : null;
    },
  };

  return {
    io,
    at,
    pathLookups,
    /** A `claude` that answers --version, at a location such as "~/.local/bin/claude". */
    installClaude: (location: string) => write(at(location), FAKE_CLAUDE, 0o755),
    installClaudeOnPath: () => write(path.join(pathDir, "claude"), FAKE_CLAUDE, 0o755),
    /** Like the native installer: the location is a symlink to a versioned binary. */
    installClaudeAsSymlink: (location: string) => {
      const target = write(at("~/.local/share/claude/versions/2.1.283"), FAKE_CLAUDE, 0o755);
      mkdirSync(path.dirname(at(location)), { recursive: true });
      symlinkSync(target, at(location));
      return at(location);
    },
    writeFile: (location: string, contents: string, mode: number) =>
      write(at(location), contents, mode),
    makeDirectory: (location: string) => mkdirSync(at(location), { recursive: true }),
  };
}

describe.skipIf(isPlatform("win32"))("findDefaultClaudeExecutable", () => {
  test("tries ~/.local/bin, ~/.claude/local, Homebrew, then /usr/local", () => {
    expect(claudeFallbackLocations({ homeDir: "/Users/someone", rootDir: "/" })).toEqual([
      "/Users/someone/.local/bin/claude",
      "/Users/someone/.claude/local/claude",
      "/opt/homebrew/bin/claude",
      "/usr/local/bin/claude",
    ]);
  });

  test("uses claude from PATH even when a fallback location has one too", async () => {
    const machine = fakeMachine();
    const onPath = machine.installClaudeOnPath();
    machine.installClaude("~/.local/bin/claude");

    await expect(findDefaultClaudeExecutable(machine.io)).resolves.toBe(onPath);
  });

  test.each(FALLBACKS.map((location, index) => ({ location, index })))(
    "falls back to $location when PATH has no claude and no earlier location does",
    async ({ index }) => {
      const machine = fakeMachine();
      for (const location of FALLBACKS.slice(index)) {
        machine.installClaude(location);
      }

      await expect(findDefaultClaudeExecutable(machine.io)).resolves.toBe(
        machine.at(FALLBACKS[index]),
      );
    },
  );

  test("keeps the native installer's symlink path instead of its versioned target", async () => {
    const machine = fakeMachine();
    const link = machine.installClaudeAsSymlink("~/.local/bin/claude");

    await expect(findDefaultClaudeExecutable(machine.io)).resolves.toBe(link);
  });

  test("skips a fallback that is not executable", async () => {
    const machine = fakeMachine();
    machine.writeFile("~/.local/bin/claude", FAKE_CLAUDE, 0o644);
    machine.installClaude("~/.claude/local/claude");

    await expect(findDefaultClaudeExecutable(machine.io)).resolves.toBe(
      machine.at("~/.claude/local/claude"),
    );
  });

  test("skips a directory named claude", async () => {
    const machine = fakeMachine();
    machine.makeDirectory("~/.local/bin/claude");
    machine.installClaude("/opt/homebrew/bin/claude");

    await expect(findDefaultClaudeExecutable(machine.io)).resolves.toBe(
      machine.at("/opt/homebrew/bin/claude"),
    );
  });

  test("skips a fallback that fails the --version probe", async () => {
    const machine = fakeMachine();
    machine.writeFile("~/.local/bin/claude", "#!/no/such/interpreter\n", 0o755);
    machine.installClaude("/usr/local/bin/claude");

    await expect(findDefaultClaudeExecutable(machine.io)).resolves.toBe(
      machine.at("/usr/local/bin/claude"),
    );
  });

  test("finds nothing when neither PATH nor any fallback location has claude", async () => {
    const machine = fakeMachine();

    await expect(findDefaultClaudeExecutable(machine.io)).resolves.toBeNull();
  });

  test("has no fallback locations on Windows", async () => {
    const machine = fakeMachine({ platform: "win32" });
    machine.installClaude("~/.local/bin/claude");

    await expect(findDefaultClaudeExecutable(machine.io)).resolves.toBeNull();
  });
});

describe.skipIf(isPlatform("win32"))("the claude launch check", () => {
  test("the default claude launch is available from a fallback location", async () => {
    const machine = fakeMachine();
    machine.installClaude("~/.claude/local/claude");
    const claudeDefault = builtinLaunchDefault("claude", machine.io);

    const launch = await resolveProviderLaunch({ defaultBinary: "claude" });

    await expect(checkProviderLaunchAvailable(launch, claudeDefault)).resolves.toEqual({
      available: true,
      resolvedPath: machine.at("~/.claude/local/claude"),
    });
  });

  test("a manual command wins over PATH and the fallback locations", async () => {
    const machine = fakeMachine();
    machine.installClaudeOnPath();
    machine.installClaude("~/.local/bin/claude");
    const manual = machine.installClaude("/opt/custom/claude");
    const claudeDefault = builtinLaunchDefault("claude", machine.io);

    const launch = await resolveProviderLaunch({
      commandConfig: { mode: "replace", argv: [manual, "--flag"] },
      defaultBinary: "claude",
    });

    await expect(checkProviderLaunchAvailable(launch, claudeDefault)).resolves.toEqual({
      available: true,
      resolvedPath: manual,
    });
    expect(machine.pathLookups).toEqual([]);
  });

  test("a manual command that is missing stays unavailable instead of using a fallback", async () => {
    const machine = fakeMachine();
    machine.installClaude("~/.local/bin/claude");
    const claudeDefault = builtinLaunchDefault("claude", machine.io);

    const launch = await resolveProviderLaunch({
      commandConfig: { mode: "replace", argv: [machine.at("/opt/custom/claude")] },
      defaultBinary: "claude",
    });

    await expect(checkProviderLaunchAvailable(launch, claudeDefault)).resolves.toEqual({
      available: false,
      resolvedPath: null,
    });
    expect(machine.pathLookups).toEqual([]);
  });

  test("only claude gets fallback locations", () => {
    expect(builtinLaunchDefault("codex")).toBeUndefined();
    expect(builtinLaunchDefault("opencode")).toBeUndefined();
  });
});
