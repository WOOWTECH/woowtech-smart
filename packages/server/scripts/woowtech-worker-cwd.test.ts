// woowtech smart: tests for woowtech-worker-cwd.ts (woowtech/README.md section 25).
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { describe, expect, test } from "vitest";
import { workerCwd } from "./woowtech-worker-cwd.js";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const supervisorPath = fileURLToPath(new URL("./supervisor.ts", import.meta.url));

describe("the directory a worker starts in", () => {
  const ports = (input: { cwd: string | Error; exists: boolean }) => ({
    cwd: () => {
      if (input.cwd instanceof Error) throw input.cwd;
      return input.cwd;
    },
    exists: () => input.exists,
    home: () => "/Users/someone",
  });

  test("is the supervisor's own while it still exists", () => {
    expect(workerCwd(ports({ cwd: "/Users/someone/project", exists: true }))).toBeUndefined();
  });

  test("is the home directory once it was removed", () => {
    expect(workerCwd(ports({ cwd: "/Users/someone/project", exists: false }))).toBe(
      "/Users/someone",
    );
  });

  test("is the home directory when the working directory cannot be read", () => {
    expect(workerCwd(ports({ cwd: new Error("ENOENT: uv_cwd"), exists: true }))).toBe(
      "/Users/someone",
    );
  });
});

describe("a supervisor whose working directory was removed", () => {
  test("still starts the next worker, which can read its working directory", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "woowtech-worker-cwd-"));
    const startDir = path.join(tempDir, "started-here");
    await mkdir(startDir);
    const marker = path.join(tempDir, "first-worker-ran");
    const secondCwd = path.join(tempDir, "second-worker-cwd");
    const workerPath = path.join(tempDir, "worker.mjs");
    const runnerPath = path.join(tempDir, "runner.mjs");

    // The first worker removes the directory the supervisor runs in, then crashes after it was
    // ready, so the supervisor starts another one. That one reads its working directory first,
    // as the daemon's dependencies do when they load.
    await writeFile(
      workerPath,
      `
        import { existsSync, rmSync, writeFileSync } from "node:fs";
        const ready = () => process.send?.({ type: "paseo:ready", listen: "fixture", serverId: "srv_fixture" });
        if (!existsSync(${JSON.stringify(marker)})) {
          writeFileSync(${JSON.stringify(marker)}, "1");
          ready();
          rmSync(${JSON.stringify(startDir)}, { recursive: true, force: true });
          setTimeout(() => process.exit(1), 200);
        } else {
          const cwd = process.cwd();
          ready();
          writeFileSync(${JSON.stringify(secondCwd)}, cwd);
          setTimeout(() => process.exit(0), 200);
        }
      `,
    );
    // The runner starts in the repo, where --import tsx resolves, then moves into the directory
    // the first worker removes.
    await writeFile(
      runnerPath,
      `
        import { runSupervisor } from ${JSON.stringify(pathToFileURL(supervisorPath).href)};
        process.chdir(${JSON.stringify(startDir)});
        runSupervisor({
          name: "TestSupervisor",
          startupMessage: "starting fixture",
          resolveWorkerEntry: () => ${JSON.stringify(workerPath)},
          workerArgs: [],
          workerEnv: process.env,
          workerExecArgv: [],
          restartOnCrash: true,
          logFile: { path: ${JSON.stringify(path.join(tempDir, "daemon.log"))}, rotate: { maxSize: "1m", maxFiles: 2 } },
        });
      `,
    );

    const child = spawn(process.execPath, ["--import", "tsx", runnerPath], {
      cwd: repoRoot,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`supervisor fixture timed out\n${stderr}`));
      }, 20_000);
      child.on("error", reject);
      child.on("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    expect(existsSync(startDir)).toBe(false);
    expect(existsSync(secondCwd), stderr).toBe(true);
    expect(await readFile(secondCwd, "utf8")).toBe(await realpath(homedir()));
  }, 30_000);
});
