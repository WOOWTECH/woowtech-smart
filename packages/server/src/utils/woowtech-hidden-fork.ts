import type { ForkOptions } from "node:child_process";

// woowtech smart: fork() hands its options to spawn(), which honors windowsHide, but
// @types/node leaves windowsHide off ForkOptions. A worker forked from a daemon that runs
// under node.exe (the npm CLI daemon) would otherwise open its own console window on Windows
// (woowtech/README.md §31, G11).
export function withHiddenWindow<T extends ForkOptions>(options: T): T {
  return { ...options, windowsHide: true };
}
