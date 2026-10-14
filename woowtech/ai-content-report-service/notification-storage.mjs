import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const RECEIPT = /^air_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const STATE_DIRECTORY = "notifications";

export async function assertNoSymlinks(target) {
  if (!path.isAbsolute(target)) throw new Error("absolute path required");
  let current = path.parse(target).root;
  for (const part of target.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new Error("symlink refused");
  }
}

export async function privateDirectory(dir) {
  await assertNoSymlinks(dir);
  const info = await lstat(dir);
  if (!info.isDirectory() || (info.mode & 0o7777) !== 0o700 || info.uid !== process.getuid())
    throw new Error("directory must be owned and 0700");
}

export async function readPrivate(file) {
  await assertNoSymlinks(file);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      (info.mode & 0o7777) !== 0o600 ||
      info.uid !== process.getuid()
    )
      throw new Error("file must be owned, regular and 0600");
    if (info.size > 256 * 1024) throw new Error("file too large");
    return { text: await handle.readFile("utf8"), mtimeMs: info.mtimeMs };
  } finally {
    await handle.close();
  }
}

export async function syncDirectory(dir) {
  const handle = await open(dir, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function writeState(dir, receipt, state) {
  const file = path.join(dir, `${receipt}.json`);
  const temp = path.join(dir, `${receipt}.${randomUUID()}.tmp`);
  const handle = await open(temp, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(state)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temp, file);
  await syncDirectory(dir);
}

// A crash deliberately leaves the lock. Only an operator may remove it after reconciliation.
export async function withNotificationLock(
  queueDir,
  operation,
  { create = true, skipBusy = false } = {},
) {
  const dir = path.join(queueDir, STATE_DIRECTORY);
  if (create) {
    await privateDirectory(queueDir);
    await mkdir(dir, { mode: 0o700 }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
  } else {
    try {
      await lstat(dir);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }
  await privateDirectory(queueDir);
  await privateDirectory(dir);
  await syncDirectory(queueDir);
  const lock = path.join(dir, "worker.lock");
  let handle;
  try {
    handle = await open(lock, "wx", 0o600);
  } catch (error) {
    if (error.code === "EEXIST" && skipBusy) return;
    throw error;
  }
  // Do not remove a lock if its initial durability could not be established.
  try {
    await handle.writeFile(`${process.pid}\n`);
    await handle.sync();
    await syncDirectory(dir);
  } finally {
    await handle.close();
  }
  try {
    return await operation(dir);
  } finally {
    await unlink(lock);
    await syncDirectory(dir);
  }
}

export async function cleanupNotificationStates(queueDir, dir, retentionMs, now) {
  for (const name of await readdir(dir)) {
    const receipt = name.slice(0, -5);
    if (!name.endsWith(".json") || !RECEIPT.test(receipt)) continue;
    await readPrivate(path.join(dir, name));
    let expired;
    try {
      const record = await readPrivate(path.join(queueDir, name));
      expired = now - record.mtimeMs > retentionMs;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      expired = true;
    }
    if (expired) await unlink(path.join(dir, name));
  }
  // Interrupted atomic writes are safe to discard under the exclusive lock.
  for (const name of await readdir(dir)) {
    if (!/^air_[0-9a-f-]+\.[0-9a-f-]+\.tmp$/.test(name)) continue;
    await readPrivate(path.join(dir, name));
    await unlink(path.join(dir, name));
  }
  await syncDirectory(dir);
}
