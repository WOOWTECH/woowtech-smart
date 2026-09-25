import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { SkillTargets } from "./operations.js";

export function resolveBundledSkillsDir(moduleUrl: string | URL = import.meta.url): string {
  const moduleDir = path.dirname(fileURLToPath(moduleUrl));
  const candidates = [
    path.resolve(moduleDir, "..", "..", "..", "skills"),
    // woowtech smart's skills, generated from upstream's skills/ under our names.
    path.resolve(moduleDir, "..", "..", "..", "..", "..", "..", "woowtech", "skills"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

export function resolveSkillTargets(home: string = os.homedir()): SkillTargets {
  return {
    sourceDir: resolveBundledSkillsDir(),
    agentsDir: path.join(home, ".agents", "skills"),
    claudeDir: path.join(home, ".claude", "skills"),
    codexDir: path.join(home, ".codex", "skills"),
  };
}
