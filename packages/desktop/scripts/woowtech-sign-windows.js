// woowtech smart: electron-builder's Windows sign hook (woowtech/README.md §31, plan §4.8 D8).
// electron-builder 26.17.0 calls it once for every file it signs: the app's exe, the .dll and
// .node files win.signExts adds, every .exe under app.asar.unpacked, the uninstaller before the
// installer embeds it, and the installer. Only the release job signs (WOOWTECH_SIGN=1), with jsign
// and the OV certificate's key in SSL.com eSigner; every other build stays unsigned. A file that
// already carries a signature keeps it: Microsoft signs Electron's d3dcompiler_47.dll and dxil.dll
// and node-pty's conpty.dll and OpenConsole.exe. The release job's signature check fails on any
// PE file that is not validly signed and timestamped, so a file skipped here cannot ship unnoticed.
// With a custom hook, win.forceCodeSigning never fails the build, so a missing secret throws here.
const { execFile } = require("node:child_process");
const { closeSync, openSync, readSync } = require("node:fs");

// The brand this tree builds (woowtech/tools/apply-brand.mjs): the signature names its app and
// website, so another brand's release tree signs with its own.
const { appliedBrand } = require("../../../woowtech/brands/index.cjs");

const REQUIRED_ENV = [
  "JSIGN_JAR",
  "ESIGNER_STOREPASS",
  "ESIGNER_CREDENTIAL_ID",
  "ESIGNER_TOTP_SECRET",
];
// RFC 3161 timestamps keep a signature valid after the certificate expires (460 days at most).
// jsign falls back to DigiCert's timestamp server when SSL.com's does not answer.
const TIMESTAMP_URLS = "http://ts.ssl.com,http://timestamp.digicert.com";
// Each retry waits past a 30-second TOTP step, so eSigner gets a new one-time password.
const RETRY_DELAYS_MS = [30_000, 60_000];
const SIGN_TIMEOUT_MS = 10 * 60 * 1000;

/** The size of a PE file's certificate table, 0 when the file carries no signature. */
function peSignatureSize(file) {
  const fd = openSync(file, "r");
  try {
    const dos = Buffer.alloc(64);
    if (readSync(fd, dos, 0, dos.length, 0) < dos.length || dos.readUInt16LE(0) !== 0x5a4d) {
      return 0;
    }
    // "PE\0\0", the COFF header, then the optional header up to its certificate table entry.
    const header = Buffer.alloc(4 + 20 + 152);
    if (readSync(fd, header, 0, header.length, dos.readUInt32LE(0x3c)) < header.length) {
      return 0;
    }
    const optional = 24;
    const magic = header.readUInt16LE(optional);
    if (header.readUInt32LE(0) !== 0x4550 || (magic !== 0x10b && magic !== 0x20b)) {
      return 0;
    }
    const pe32Plus = magic === 0x20b;
    if (header.readUInt32LE(optional + (pe32Plus ? 108 : 92)) <= 4) {
      return 0;
    }
    // Data directory 4 is the certificate table: a file offset, then a size.
    return header.readUInt32LE(optional + (pe32Plus ? 112 : 96) + 4 * 8 + 4);
  } finally {
    closeSync(fd);
  }
}

function jsignArguments({ jar, credentialId, file, brand = appliedBrand() }) {
  return [
    "-jar",
    jar,
    "--storetype",
    "ESIGNER",
    // jsign reads "<username>|<password>" and the base64 TOTP secret from these variables, so
    // neither appears in the build log or a process listing.
    "--storepass",
    "env:ESIGNER_STOREPASS",
    "--alias",
    credentialId,
    "--keypass",
    "env:ESIGNER_TOTP_SECRET",
    "--alg",
    "SHA-256",
    "--tsaurl",
    TIMESTAMP_URLS,
    "--tsmode",
    "RFC3161",
    "--name",
    brand.name,
    "--url",
    `https://${brand.links.websiteHost}`,
    file,
  ];
}

/** What the hook does with one file. Throws when the release job lacks a signing secret. */
function planWindowsSigning({ file, hash, env, signatureSize = peSignatureSize }) {
  if (env.WOOWTECH_SIGN !== "1") {
    return { action: "skip", reason: "left unsigned (WOOWTECH_SIGN is not 1)" };
  }
  const missing = REQUIRED_ENV.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`woowtech-sign-windows: set ${missing.join(", ")} to sign Windows builds`);
  }
  // signingHashAlgorithms is ["sha256"]; a SHA-1 pass would only add a second signature.
  if (hash && hash !== "sha256") {
    return { action: "skip", reason: `skipped the ${hash} pass` };
  }
  if (signatureSize(file) > 0) {
    return { action: "skip", reason: "keeps its existing signature" };
  }
  return {
    action: "sign",
    args: jsignArguments({ jar: env.JSIGN_JAR, credentialId: env.ESIGNER_CREDENTIAL_ID, file }),
  };
}

function runJava(args) {
  return new Promise((resolve, reject) => {
    execFile(
      "java",
      args,
      { timeout: SIGN_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        process.stdout.write(stdout);
        process.stderr.write(stderr);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      },
    );
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function signWindowsFile({
  configuration,
  env = process.env,
  run = runJava,
  wait = delay,
  log = console.log,
}) {
  const file = configuration.path;
  const plan = planWindowsSigning({ file, hash: configuration.hash, env });
  if (plan.action === "skip") {
    log(`[woowtech-sign-windows] ${plan.reason}: ${file}`);
    return;
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      await run(plan.args);
      log(`[woowtech-sign-windows] signed: ${file}`);
      return;
    } catch (error) {
      // No java on PATH will not fix itself.
      if (error.code === "ENOENT" || attempt >= RETRY_DELAYS_MS.length) {
        throw error;
      }
      const seconds = RETRY_DELAYS_MS[attempt] / 1000;
      log(`[woowtech-sign-windows] signing failed, retrying in ${seconds} s: ${file}`);
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
}

// electron-builder takes a module's export named "sign" before its default, so none is named that.
exports.default = async function signWindows(configuration) {
  await signWindowsFile({ configuration });
};
exports.peSignatureSize = peSignatureSize;
exports.planWindowsSigning = planWindowsSigning;
exports.signWindowsFile = signWindowsFile;
