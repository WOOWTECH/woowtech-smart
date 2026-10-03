import { describe, expect, it, vi } from "vitest";

import { renameWithRetry } from "./woowtech-rename-retry.js";

function failing(codes: string[]) {
  const calls: string[] = [];
  const rename = vi.fn(async (from: string, to: string) => {
    calls.push(`${from}->${to}`);
    const code = codes.shift();
    if (code) {
      throw Object.assign(new Error(code), { code });
    }
  });
  return { rename, calls };
}

describe("renameWithRetry", () => {
  it("waits out a busy file on Windows", async () => {
    const { rename } = failing(["EBUSY", "EPERM"]);
    const sleep = vi.fn(async () => {});
    await renameWithRetry({ from: "a", to: "b", platform: "win32", rename, sleep });
    expect(rename).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[50], [100]]);
  });

  it("gives up after the last wait", async () => {
    const { rename } = failing(Array.from({ length: 8 }, () => "EACCES"));
    const sleep = vi.fn(async () => {});
    await expect(
      renameWithRetry({ from: "a", to: "b", platform: "win32", rename, sleep }),
    ).rejects.toMatchObject({ code: "EACCES" });
    expect(rename).toHaveBeenCalledTimes(8);
  });

  it("does not retry a missing file, nor anything outside Windows", async () => {
    const missing = failing(["ENOENT"]);
    await expect(
      renameWithRetry({ from: "a", to: "b", platform: "win32", rename: missing.rename }),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(missing.rename).toHaveBeenCalledTimes(1);

    const mac = failing(["EBUSY"]);
    await expect(
      renameWithRetry({ from: "a", to: "b", platform: "darwin", rename: mac.rename }),
    ).rejects.toMatchObject({ code: "EBUSY" });
    expect(mac.rename).toHaveBeenCalledTimes(1);
  });
});
