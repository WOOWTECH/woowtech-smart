import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const signHook = require("./woowtech-sign-windows.js");
const { peSignatureSize, planWindowsSigning, signWindowsFile } = signHook;

const SECRETS = {
  ESIGNER_STOREPASS: "release-bot@woowtech|correct horse battery",
  ESIGNER_TOTP_SECRET: "dG90cC1zZWNyZXQtZm9yLXRlc3Rz",
};
const RELEASE_ENV = {
  WOOWTECH_SIGN: "1",
  JSIGN_JAR: "C:\\a\\_temp\\jsign-7.5.jar",
  ESIGNER_CREDENTIAL_ID: "8b072e22-7685-4771-b5c6-48e46614915f",
  ...SECRETS,
};

// The headers peSignatureSize reads: DOS stub, PE signature, COFF header, optional header.
function peImage({ magic = 0x20b, certificateSize = 0 } = {}) {
  const peOffset = 0x80;
  const image = Buffer.alloc(peOffset + 24 + 240);
  image.write("MZ", 0, "latin1");
  image.writeUInt32LE(peOffset, 0x3c);
  image.write("PE\0\0", peOffset, "latin1");
  const optional = peOffset + 24;
  const pe32Plus = magic === 0x20b;
  image.writeUInt16LE(magic, optional);
  image.writeUInt32LE(16, optional + (pe32Plus ? 108 : 92));
  const certificateEntry = optional + (pe32Plus ? 112 : 96) + 4 * 8;
  image.writeUInt32LE(certificateSize > 0 ? 0x4000 : 0, certificateEntry);
  image.writeUInt32LE(certificateSize, certificateEntry + 4);
  return image;
}

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeTemp(name, contents) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "woowtech-sign-"));
  tempDirs.push(dir);
  const file = path.join(dir, name);
  writeFileSync(file, contents);
  return file;
}

describe("peSignatureSize", () => {
  it("reads the certificate table of 64-bit and 32-bit images", () => {
    expect(peSignatureSize(writeTemp("conpty.dll", peImage({ certificateSize: 10312 })))).toBe(
      10312,
    );
    expect(
      peSignatureSize(writeTemp("x86.dll", peImage({ magic: 0x10b, certificateSize: 9000 }))),
    ).toBe(9000);
    expect(peSignatureSize(writeTemp("ffmpeg.dll", peImage()))).toBe(0);
  });

  it("treats a file that is not a whole PE image as unsigned", () => {
    expect(peSignatureSize(writeTemp("notes.txt", "MZ but nothing else"))).toBe(0);
    expect(peSignatureSize(writeTemp("cut.exe", peImage().subarray(0, 0x90)))).toBe(0);
  });
});

describe("planWindowsSigning", () => {
  const unsigned = () => 0;

  it("leaves every build unsigned unless WOOWTECH_SIGN is 1, secrets or not", () => {
    expect(
      planWindowsSigning({ file: "app.exe", hash: "sha256", env: {}, signatureSize: unsigned }),
    ).toEqual({ action: "skip", reason: "left unsigned (WOOWTECH_SIGN is not 1)" });
    expect(
      planWindowsSigning({
        file: "app.exe",
        hash: "sha256",
        env: { ...RELEASE_ENV, WOOWTECH_SIGN: "true" },
        signatureSize: unsigned,
      }).action,
    ).toBe("skip");
  });

  it("fails the release build when a signing variable is missing, without printing values", () => {
    const sign = () =>
      planWindowsSigning({
        file: "app.exe",
        hash: "sha256",
        env: { WOOWTECH_SIGN: "1", JSIGN_JAR: RELEASE_ENV.JSIGN_JAR, ...SECRETS },
        signatureSize: unsigned,
      });
    expect(sign).toThrow("set ESIGNER_CREDENTIAL_ID to sign Windows builds");
    expect(() =>
      planWindowsSigning({
        file: "app.exe",
        hash: "sha256",
        env: { WOOWTECH_SIGN: "1" },
        signatureSize: unsigned,
      }),
    ).toThrow("JSIGN_JAR, ESIGNER_STOREPASS, ESIGNER_CREDENTIAL_ID, ESIGNER_TOTP_SECRET");
  });

  it("keeps a file's existing signature and skips a SHA-1 pass", () => {
    expect(
      planWindowsSigning({
        file: "OpenConsole.exe",
        hash: "sha256",
        env: RELEASE_ENV,
        signatureSize: () => 10312,
      }),
    ).toEqual({ action: "skip", reason: "keeps its existing signature" });
    expect(
      planWindowsSigning({
        file: "app.exe",
        hash: "sha1",
        env: RELEASE_ENV,
        signatureSize: unsigned,
      }).action,
    ).toBe("skip");
  });

  it("signs with SHA-256 and an RFC 3161 timestamp, passing secrets only by variable name", () => {
    const file = "C:\\build\\win-unpacked\\woowtech smart.exe";
    const plan = planWindowsSigning({
      file,
      hash: "sha256",
      env: RELEASE_ENV,
      signatureSize: unsigned,
    });
    expect(plan.action).toBe("sign");
    const option = (name) => plan.args[plan.args.indexOf(name) + 1];
    expect(plan.args.slice(0, 2)).toEqual(["-jar", RELEASE_ENV.JSIGN_JAR]);
    expect(option("--storetype")).toBe("ESIGNER");
    expect(option("--storepass")).toBe("env:ESIGNER_STOREPASS");
    expect(option("--keypass")).toBe("env:ESIGNER_TOTP_SECRET");
    expect(option("--alias")).toBe(RELEASE_ENV.ESIGNER_CREDENTIAL_ID);
    expect(option("--alg")).toBe("SHA-256");
    expect(option("--tsmode")).toBe("RFC3161");
    expect(option("--tsaurl").split(",")[0]).toBe("http://ts.ssl.com");
    expect(plan.args.at(-1)).toBe(file);
    expect(plan.args.join("\n")).not.toContain("correct horse");
    expect(plan.args.join("\n")).not.toContain(SECRETS.ESIGNER_TOTP_SECRET);
  });
});

describe("signWindowsFile", () => {
  function recorder(outcomes) {
    const calls = { runs: [], waits: [], logs: [] };
    return {
      calls,
      run: async (args) => {
        calls.runs.push(args);
        const outcome = outcomes.shift();
        if (outcome) throw outcome;
      },
      wait: async (ms) => {
        calls.waits.push(ms);
      },
      log: (line) => calls.logs.push(line),
    };
  }

  it("does not start java for an unsigned build", async () => {
    const file = writeTemp("app.exe", peImage());
    const { calls, run, wait, log } = recorder([]);
    await signWindowsFile({
      configuration: { path: file, hash: "sha256" },
      env: {},
      run,
      wait,
      log,
    });
    expect(calls.runs).toEqual([]);
    expect(calls.logs).toEqual([
      `[woowtech-sign-windows] left unsigned (WOOWTECH_SIGN is not 1): ${file}`,
    ]);
  });

  it("retries a failed signing after a new TOTP step", async () => {
    const file = writeTemp("conpty.node", peImage());
    const { calls, run, wait, log } = recorder([new Error("timeout"), new Error("503")]);
    await signWindowsFile({
      configuration: { path: file, hash: "sha256" },
      env: RELEASE_ENV,
      run,
      wait,
      log,
    });
    expect(calls.runs).toHaveLength(3);
    expect(calls.waits).toEqual([30_000, 60_000]);
    expect(calls.logs.at(-1)).toBe(`[woowtech-sign-windows] signed: ${file}`);
  });

  it("fails the build after three failed attempts, or at once when java is missing", async () => {
    const file = writeTemp("esbuild.exe", peImage());
    const failing = recorder([new Error("1"), new Error("2"), new Error("unauthorized")]);
    await expect(
      signWindowsFile({
        configuration: { path: file, hash: "sha256" },
        env: RELEASE_ENV,
        ...failing,
      }),
    ).rejects.toThrow("unauthorized");
    expect(failing.calls.runs).toHaveLength(3);

    const noJava = recorder([Object.assign(new Error("spawn java ENOENT"), { code: "ENOENT" })]);
    await expect(
      signWindowsFile({
        configuration: { path: file, hash: "sha256" },
        env: RELEASE_ENV,
        ...noJava,
      }),
    ).rejects.toThrow("ENOENT");
    expect(noJava.calls.runs).toHaveLength(1);
  });
});

it("exports no function named sign, which electron-builder would take over the default", () => {
  expect(signHook.sign).toBeUndefined();
  expect(typeof signHook.default).toBe("function");
});
