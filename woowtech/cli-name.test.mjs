// woowtech smart's CLI is the woowtech-smart command. The official Paseo owns
// `paseo`: its desktop app installs ~/.local/bin/paseo, and both apps' terminal
// hooks call it. These checks read the sources and the packaging config, because
// an upstream merge can bring the upstream name back in a file we never touched.
//
//   node --test woowtech/cli-name.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import YAML from "yaml";

import { findInShippedSources } from "./shipped-sources.mjs";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("the desktop app bundles the CLI as woowtech-smart and keeps paseo for terminal hooks", () => {
  const builder = YAML.parse(read("packages/desktop/electron-builder.yml"));
  const bundledCli = (platform) =>
    (builder[platform]?.extraResources ?? [])
      .filter((resource) => resource.to?.startsWith("bin/"))
      .map((resource) => `${resource.from} -> ${resource.to}`)
      .sort();

  // Upstream's OpenCode hook plugin runs a bare `paseo`, which our daemon's
  // terminals find in the bundle's bin folder, so the shim stays there under
  // that name as well.
  for (const platform of ["mac", "linux"]) {
    assert.deepEqual(bundledCli(platform), [
      "bin/paseo -> bin/paseo",
      "bin/paseo -> bin/woowtech-smart",
    ]);
  }
  assert.deepEqual(bundledCli("win"), [
    "bin/paseo.cmd -> bin/paseo.cmd",
    "bin/paseo.cmd -> bin/woowtech-smart.cmd",
  ]);
});

test("terminal hooks keep upstream's exact text, so both apps install the same hooks", () => {
  // Paseo and woowtech smart write these hooks into the same agent settings and
  // recognise them by their text: any difference makes each daemon rewrite the
  // other's on every start. Our terminals reach our CLI through PASEO_HOOK_CLI
  // and the bundle's bin/paseo instead.
  const installer = read("packages/server/src/terminal/agent-hooks/agent-hook-installer.ts");
  const openCodePlugin = read(
    "packages/server/src/terminal/agent-hooks/opencode/opencode-plugin.ts",
  );

  for (const upstreamText of [
    'const hookCommand = `"\\${PASEO_HOOK_CLI:-paseo}" hooks ${shellToken(provider.id)} ${shellToken(event.event)}`;',
    '(if defined PASEO_HOOK_CLI ("%PASEO_HOOK_CLI%" ${hookArgs}) else (paseo ${hookArgs}))',
  ]) {
    assert.ok(installer.includes(upstreamText), upstreamText);
  }
  for (const upstreamText of [
    `'      const child = Bun.spawn(["paseo", "hooks", "opencode", event], {',`,
    `'  id: "paseo-terminal-activity",',`,
    'configFile: "plugins/paseo-terminal-activity.js",',
    'hookMarker: "paseo hooks opencode",',
  ]) {
    assert.ok(openCodePlugin.includes(upstreamText), upstreamText);
  }
});

test("hints the CLI prints or returns itself name the woowtech-smart command", () => {
  // Errors go through the CLI's renderError, which names our command. These
  // hints are printed directly or returned as result fields, so they spell out
  // CLI_COMMAND.
  const printsHints = [
    "packages/cli/src/commands/onboard.ts",
    "packages/cli/src/commands/daemon/config.ts",
    "packages/cli/src/commands/daemon/pair.ts",
    "packages/cli/src/commands/daemon/reload.ts",
    "packages/cli/src/commands/daemon/set-password.ts",
    "packages/cli/src/commands/agent/attach.ts",
    "packages/cli/src/commands/agent/logs.ts",
    "packages/cli/src/commands/agent/wait.ts",
  ];
  assert.deepEqual(
    findInShippedSources([/(?:^|[\s"'`(])paseo (?:[a-z]|-)/], {
      dirs: [],
      files: printsHints,
      skipComments: true,
    }),
    [],
  );
});

test("the daemon's messages name the woowtech-smart command", () => {
  // The CLI and the desktop app show the daemon's messages as they are.
  assert.deepEqual(
    findInShippedSources([/(?:^|[\s"'`(])paseo (?:[a-z]|-)/], {
      dirs: ["packages/server/src"],
      skipComments: true,
      allowLines: [
        // Upstream's hook marker; terminal hooks keep upstream's text.
        /hookMarker: "paseo hooks opencode"/,
        // The contents of a file the file watcher probe writes.
        /"paseo watcher liveness canary\\n"/,
      ],
    }),
    [],
  );
});

test("the CLI's own messages name woowtech smart", () => {
  const naming = findInShippedSources([/\bPaseo\b(?! Hub\b)/], {
    dirs: ["packages/cli/src"],
    skipComments: true,
    // The plugin template is written against upstream's plugin API.
    skipPaths: ["packages/cli/src/commands/plugin/scaffold.ts"],
    allowLines: [
      // Help text, which packages/cli/src/brand.ts rewrites as it prints.
      /\.(?:description|option|requiredOption|argument|summary)\(/,
      // Paseo Hub's chat bot, renamed with our own Hub.
      /@Paseo have a look/,
      // The relay's operator, which is upstream until we run our own relay.
      /Paseo cannot read your code or messages/,
    ],
  });
  assert.deepEqual(naming, []);
});

test("the desktop's CLI install names only woowtech-smart, never Paseo's command", () => {
  assert.deepEqual(
    findInShippedSources([/["'`]paseo(?:\.cmd)?["'`]/, /\.local[/\\]bin[/\\]paseo\b/], {
      dirs: ["packages/desktop/src/integrations/cli-install"],
    }),
    [],
  );
});
