import { BRAND } from "@getpaseo/protocol/brand-values";
import { brandSkillName } from "@getpaseo/protocol/brand-skills";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSkillsController, type SkillsController } from "./controller";
import type { SkillSelection, SkillTargets } from "./operations";
import { resolveSkillTargets } from "./paths";
import { coerceSkillSelection, type SkillSelectionStore } from "./selection-store";
import { beginSkillsTransaction } from "./transaction";

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
const OUR_SKILLS = OFFICIAL_SKILLS.map(brandSkillName);

function skillRoots(targets: SkillTargets): string[] {
  return [...targets.installDirs, targets.codexDir];
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
    home = await mkdtemp(path.join(os.tmpdir(), `${BRAND.cliCommand}-skills-coexistence-`));
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
    for (const root of targets.installDirs) {
      expect(await listSkillDirs(root)).toEqual([...OFFICIAL_SKILLS, ...OUR_SKILLS].sort());
    }
    // Codex now discovers the shared .agents root; its legacy root stays untouched.
    expect(await listSkillDirs(targets.codexDir)).toEqual(OFFICIAL_SKILLS);
    expect(await readSkills(targets, OFFICIAL_SKILLS)).toEqual(officialBefore);
  });

  it("repairs woowtech smart's skills without touching the official ones", async () => {
    await controller.install();
    const edited = path.join(targets.installDirs[1]!, brandSkillName("paseo"), "SKILL.md");

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
    await plantSkills(targets, [brandSkillName("paseo-chat")]);

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
    const deselected = OUR_SKILLS.filter((name) => name !== brandSkillName("paseo"));

    const asked = await controller.save({ mode: "custom", skills: [brandSkillName("paseo")] });
    const saved = await controller.save({
      mode: "custom",
      skills: [brandSkillName("paseo")],
      confirmedRemovals: deselected,
    });

    expect(asked.confirmationRequired).toEqual({ removals: deselected });
    expect(saved.confirmationRequired).toBeNull();
    expect(saved.installed).toEqual([brandSkillName("paseo")]);
    expect(await readSkills(targets, official)).toEqual(before);
  });

  it("stages a save in a folder named for woowtech smart", async () => {
    await controller.install();
    const parent = path.dirname(targets.installDirs[0]!);

    const transaction = await beginSkillsTransaction(
      targets,
      { mode: "all" },
      { mode: "custom", skills: [brandSkillName("paseo")] },
      [{ kind: "delete", name: brandSkillName("paseo-advisor") }],
    );
    const staged = (await readdir(parent)).filter((entry) => entry.includes("-skills-"));
    await transaction.rollback();

    expect(staged).toHaveLength(1);
    expect(staged[0]?.startsWith(`.${BRAND.cliCommand}-skills-transaction-`)).toBe(true);
  });

  it("leaves the official Paseo's interrupted saves for the official Paseo", async () => {
    // Saves the official app was interrupted in while capturing: one that was
    // switching to the selection we have, and one that matches neither of ours.
    const parent = path.dirname(targets.installDirs[0]!);
    const interrupted = [
      { next: { mode: "all" }, id: "0b7f3f5e-7a6c-4a4e-9d3e-1f2a3b4c5d6e" },
      {
        next: { mode: "custom", skills: ["paseo-help"] },
        id: "5c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
      },
    ].map(({ next, id }) => ({
      manifest: path.join(parent, `.paseo-skills-transaction-${id}`, "transaction.json"),
      contents: `${JSON.stringify({
        owner: "paseo-skills-transaction",
        version: 1,
        phase: "capturing",
        previousSelection: { mode: "custom", skills: ["paseo"] },
        nextSelection: next,
        entries: [],
      })}\n`,
    }));
    for (const { manifest, contents } of interrupted) {
      await mkdir(path.dirname(manifest), { recursive: true });
      await writeFile(manifest, contents);
    }

    await controller.install();
    await controller.save({
      mode: "custom",
      skills: [brandSkillName("paseo")],
      confirmedRemovals: OUR_SKILLS,
    });
    await controller.uninstall();

    for (const { manifest, contents } of interrupted) {
      expect(await readFile(manifest, "utf8")).toBe(contents);
    }
  });
});
