import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSkillsController, type SkillsController } from "./controller";
import type { SkillSelection, SkillTargets } from "./operations";
import { resolveSkillTargets } from "./paths";
import { coerceSkillSelection, type SkillSelectionStore } from "./selection-store";

// The official Paseo installs these into the same agent homes, and older
// versions of it installed the retired ones.
const OFFICIAL_SKILLS = [
  "paseo",
  "paseo-advisor",
  "paseo-committee",
  "paseo-handoff",
  "paseo-help",
  "paseo-plugin",
];
const OFFICIAL_RETIRED_SKILLS = [
  "paseo-chat",
  "paseo-epic",
  "paseo-orchestrate",
  "paseo-orchestrator",
];
const OUR_SKILLS = [
  "woowtech-smart",
  "woowtech-smart-advisor",
  "woowtech-smart-committee",
  "woowtech-smart-handoff",
  "woowtech-smart-help",
  "woowtech-smart-plugin",
];

function skillRoots(targets: SkillTargets): string[] {
  return [targets.agentsDir, targets.claudeDir, targets.codexDir];
}

function memorySelectionStore(): SkillSelectionStore {
  let selection: SkillSelection = { mode: "all" };
  return {
    get: async () => selection,
    set: async (next) => {
      selection = coerceSkillSelection(next);
      return selection;
    },
    isSet: async () => true,
  };
}

/** Skills another install left in every agent home, each with its managed-files manifest. */
async function plantSkills(targets: SkillTargets, names: string[]): Promise<void> {
  for (const root of skillRoots(targets)) {
    for (const name of names) {
      await mkdir(path.join(root, name), { recursive: true });
      await writeFile(path.join(root, name, "SKILL.md"), `---\nname: ${name}\n---\nplanted\n`);
      await writeFile(
        path.join(root, name, ".paseo-managed-files.json"),
        `${JSON.stringify({ version: 1, files: { "SKILL.md": "planted" } })}\n`,
      );
    }
  }
}

/** Every file of the named skills, by path, or null for a missing skill. */
async function readSkills(
  targets: SkillTargets,
  names: string[],
): Promise<Record<string, unknown>> {
  const skills: Record<string, unknown> = {};
  for (const root of skillRoots(targets)) {
    for (const name of names) {
      const dir = path.join(root, name);
      const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(
        () => null,
      );
      const files: Record<string, string> = {};
      for (const entry of (entries ?? []).filter((candidate) => candidate.isFile())) {
        const file = path.join(entry.parentPath, entry.name);
        files[path.relative(dir, file)] = await readFile(file, "utf8");
      }
      skills[dir] = entries ? files : null;
    }
  }
  return skills;
}

async function listSkillDirs(root: string): Promise<string[]> {
  return (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

describe("orchestration skills beside the official Paseo's", () => {
  let home: string;
  let targets: SkillTargets;
  let controller: SkillsController;
  let officialBefore: Record<string, unknown>;

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), "woowtech-smart-skills-coexistence-"));
    // The catalog the daemon really ships, installed into a temporary home.
    targets = resolveSkillTargets(home);
    controller = createSkillsController({
      resolveTargets: () => targets,
      selectionStore: memorySelectionStore(),
    });
    await plantSkills(targets, OFFICIAL_SKILLS);
    officialBefore = await readSkills(targets, OFFICIAL_SKILLS);
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("installs woowtech smart's skills under their own names and leaves the official ones alone", async () => {
    const status = await controller.install();

    expect(status.available).toEqual(OUR_SKILLS);
    expect(status.installed).toEqual(OUR_SKILLS);
    expect(status.state).toBe("up-to-date");
    for (const root of skillRoots(targets)) {
      expect(await listSkillDirs(root)).toEqual([...OFFICIAL_SKILLS, ...OUR_SKILLS].sort());
    }
    expect(await readSkills(targets, OFFICIAL_SKILLS)).toEqual(officialBefore);
  });

  it("repairs woowtech smart's skills without touching the official ones", async () => {
    await controller.install();
    const edited = path.join(targets.claudeDir, "woowtech-smart", "SKILL.md");

    await writeFile(edited, "edited");
    expect((await controller.autoUpdate()).state).toBe("up-to-date");
    await writeFile(edited, "edited again");
    expect((await controller.update()).state).toBe("up-to-date");

    expect(await readFile(edited, "utf8")).not.toMatch(/^edited/);
    expect(await readSkills(targets, OFFICIAL_SKILLS)).toEqual(officialBefore);
  });

  it("does not count the official Paseo's retired skills as its own", async () => {
    await plantSkills(targets, OFFICIAL_RETIRED_SKILLS);

    const status = await controller.status();

    expect(status.installed).toEqual([]);
    expect(status.state).toBe("not-installed");
    expect(status.ops.filter((op) => op.kind === "delete")).toEqual([]);
  });

  it("uninstalls its own skills, current and retired, and nothing of the official Paseo's", async () => {
    const official = [...OFFICIAL_SKILLS, ...OFFICIAL_RETIRED_SKILLS];
    await plantSkills(targets, OFFICIAL_RETIRED_SKILLS);
    const before = await readSkills(targets, official);
    await controller.install();
    // A name an older woowtech smart shipped.
    await plantSkills(targets, ["woowtech-smart-chat"]);

    const status = await controller.uninstall();

    expect(status.installed).toEqual([]);
    for (const root of skillRoots(targets)) {
      expect(await listSkillDirs(root)).toEqual(official.sort());
    }
    expect(await readSkills(targets, official)).toEqual(before);
  });

  it("asks to remove only its own skills when the selection shrinks", async () => {
    const official = [...OFFICIAL_SKILLS, ...OFFICIAL_RETIRED_SKILLS];
    await plantSkills(targets, OFFICIAL_RETIRED_SKILLS);
    const before = await readSkills(targets, official);
    await controller.install();
    const deselected = OUR_SKILLS.filter((name) => name !== "woowtech-smart");

    const asked = await controller.save({ mode: "custom", skills: ["woowtech-smart"] });
    const saved = await controller.save({
      mode: "custom",
      skills: ["woowtech-smart"],
      confirmedRemovals: deselected,
    });

    expect(asked.confirmationRequired).toEqual({ removals: deselected });
    expect(saved.confirmationRequired).toBeNull();
    expect(saved.installed).toEqual(["woowtech-smart"]);
    expect(await readSkills(targets, official)).toEqual(before);
  });
});
