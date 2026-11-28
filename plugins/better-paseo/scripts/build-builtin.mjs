import { createHash } from "node:crypto";
import { builtinModules, createRequire } from "node:module";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildClient, chunkModule, clientEntry } from "./build-client.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const hostModules = ["@getpaseo/plugin", "@getpaseo/plugin/server", "zod"];
const nodeModules = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

// npm ci is an explicit preparation step. This build never installs or downloads code.
const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
for (const [name, specifier] of Object.entries(lock.packages[""].dependencies)) {
  const installed = JSON.parse(
    await readFile(path.join(root, "node_modules", name, "package.json"), "utf8"),
  );
  const expected = lock.packages[`node_modules/${name}`].version;
  if (installed.version !== expected) {
    throw new Error(
      `${name}: expected locked ${expected} (${specifier}), found ${installed.version}; run npm ci --omit=dev --workspaces=false in ${root}`,
    );
  }
}

// Production builds do not inherit a developer's optional load-trace instrumentation.
delete process.env.BC_LOAD_TRACE;
const client = await buildClient({ root });
const esbuild = require("esbuild");
const server = await esbuild.build({
  absWorkingDir: root,
  entryPoints: ["server/entry.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  external: hostModules,
  write: false,
  metafile: true,
  legalComments: "inline",
  plugins: [
    {
      name: "builtin-tasks-chunk",
      setup(build) {
        build.onLoad({ filter: /[/\\]server[/\\]tasks-chunk\.ts$/ }, () => ({
          contents: chunkModule(client.chunkId, client.chunk),
          loader: "ts",
        }));
      },
    },
  ],
});

for (const output of Object.values(server.metafile.outputs)) {
  for (const dependency of output.imports) {
    if (!hostModules.includes(dependency.path) && !nodeModules.has(dependency.path)) {
      throw new Error(`Unbundled server dependency: ${dependency.path}`);
    }
  }
}

// Keep complete license texts beside the bundles; the server's copy step ships this file.
const packageRoots = new Set();
const inputs = [
  ...client.mainInputs,
  ...client.chunkInputs,
  ...Object.keys(server.metafile.inputs),
];
for (const input of inputs) {
  const segments = input.split("/");
  const at = segments.lastIndexOf("node_modules");
  if (at < 0) continue;
  const count = segments[at + 1].startsWith("@") ? 3 : 2;
  packageRoots.add(segments.slice(0, at + count).join("/"));
}
const notices = [await readFile(path.join(root, "LICENSE"), "utf8")];
for (const relative of [...packageRoots].sort()) {
  const directory = path.resolve(root, relative);
  const metadata = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
  const files = (await readdir(directory))
    .filter((name) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name))
    .sort();
  if (files.length === 0) throw new Error(`Missing bundled dependency license: ${metadata.name}`);
  notices.push(`\n${metadata.name}@${metadata.version} (${metadata.license})\n`);
  for (const file of files) notices.push(await readFile(path.join(directory, file), "utf8"));
}

const source = JSON.parse(await readFile(path.join(root, "upstream-source.json"), "utf8"));
const outputs = {
  "index.client.ts": clientEntry(client.main),
  "server/builtin.js": server.outputFiles[0].text,
  "THIRD_PARTY_NOTICES.txt": notices.join("\n"),
};
// Both builds and their license collection must succeed before replacing either entry.
for (const [name, content] of Object.entries(outputs))
  await writeFile(path.join(root, name), content);
await writeFile(
  path.join(root, "builtin-build.json"),
  JSON.stringify(
    {
      repository: source.repository,
      commit: source.commit,
      version: source.version,
      lockfileSha256: sha256(await readFile(path.join(root, "package-lock.json"))),
      tasksChunkId: client.chunkId,
      outputs: Object.fromEntries(
        Object.entries(outputs).map(([name, content]) => [name, sha256(content)]),
      ),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Prepared Better Paseo ${source.version} (${source.commit}); Tasks chunk ${client.chunkId}`,
);
