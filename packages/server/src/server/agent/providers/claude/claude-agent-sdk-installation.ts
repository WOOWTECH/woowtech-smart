import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export class ClaudeAgentSdkRuntimeError extends Error {
  constructor() {
    super(
      "[woowtech:claude-sdk:runtime] Claude component could not be installed or loaded. Send your next message to retry.",
    );
    this.name = "ClaudeAgentSdkRuntimeError";
  }
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function statIfPresent(file: string) {
  try {
    return await lstat(file);
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
}

/** Reject symlinks before reading a pointer, importing code or moving a managed copy. */
async function assertSafePath(file: string): Promise<void> {
  const resolved = path.resolve(file);
  let current = path.parse(resolved).root;
  for (const part of resolved.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    const stat = await statIfPresent(current);
    if (!stat) return;
    if (stat.isSymbolicLink()) throw new ClaudeAgentSdkRuntimeError();
  }
}
async function assertSafeTree(dir: string): Promise<void> {
  await assertSafePath(dir);
  const stat = await statIfPresent(dir);
  if (!stat) return;
  if (!stat.isDirectory()) throw new ClaudeAgentSdkRuntimeError();
  for (const child of await readdir(dir, { withFileTypes: true })) {
    if (child.isSymbolicLink()) throw new ClaudeAgentSdkRuntimeError();
    if (child.isDirectory()) await assertSafeTree(path.join(dir, child.name));
  }
}

/** Only selected generations are inspected. Old successful generations and quarantines have no GC. */
export async function loadManagedClaudeSdk<T>(options: {
  runtimeDir: string;
  version: string;
  install: (directory: string) => Promise<void>;
  importInstalled: (directory: string) => Promise<T>;
}): Promise<T> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.+-]*$/.test(options.version)) throw new ClaudeAgentSdkRuntimeError();
  const root = path.resolve(options.runtimeDir);
  const prefix = `claude-agent-sdk-${options.version}`;
  const pointer = path.join(root, `${prefix}.json`);
  await assertSafePath(pointer);
  let selected = path.join(root, prefix); // Legacy layout, before generation pointers.
  const pointerStat = await statIfPresent(pointer);
  if (pointerStat) {
    if (!pointerStat.isFile() || pointerStat.size > 256) throw new ClaudeAgentSdkRuntimeError();
    let name: unknown;
    try {
      name = JSON.parse(await readFile(pointer, "utf8"));
    } catch {
      throw new ClaudeAgentSdkRuntimeError();
    }
    const generationPrefix = `${prefix}.generation-`;
    if (
      typeof name !== "string" ||
      !name.startsWith(generationPrefix) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        name.slice(generationPrefix.length),
      )
    ) {
      throw new ClaudeAgentSdkRuntimeError();
    }
    selected = path.join(root, name);
  }
  await assertSafeTree(selected);
  if (await statIfPresent(selected)) {
    try {
      return await options.importInstalled(selected);
    } catch {
      // The selected path is immutable and unique: another daemon's winner is never moved.
      await assertSafeTree(selected);
      try {
        await rename(selected, `${selected}.quarantine-${randomUUID()}`);
      } catch (error) {
        if (!isMissingPathError(error)) throw new ClaudeAgentSdkRuntimeError();
      }
    }
  }
  const generation = `${prefix}.generation-${randomUUID()}`;
  const directory = path.join(root, generation);
  const pendingPointer = `${pointer}.partial-${randomUUID()}`;
  let published = false;
  try {
    await mkdir(root, { recursive: true });
    await options.install(directory);
    await assertSafeTree(directory);
    let sdk: T;
    try {
      sdk = await options.importInstalled(directory);
    } catch {
      throw new ClaudeAgentSdkRuntimeError();
    }
    await writeFile(pendingPointer, JSON.stringify(generation), { flag: "wx" });
    await assertSafePath(pointer);
    await rename(pendingPointer, pointer);
    published = true;
    return sdk;
  } finally {
    await rm(pendingPointer, { force: true });
    if (!published) await rm(directory, { recursive: true, force: true });
  }
}
