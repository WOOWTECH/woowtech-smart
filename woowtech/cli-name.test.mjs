// woowtech smart's CLI is the woowtech-smart command. The official Paseo owns
// `paseo`: its desktop app installs ~/.local/bin/paseo, and both apps' terminal
// hooks call it. These checks run the CLI, the app's translations and the
// desktop's CLI install from source, and read the sources and the packaging
// config, because an upstream merge can bring the upstream name back in a file
// we never touched.
//
//   node --test woowtech/cli-name.test.mjs
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import YAML from "yaml";

import { findInShippedSources } from "./shipped-sources.mjs";
import { importSource, requireSource } from "./source-modules.mjs";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

// `paseo <command>` in text people or agents read. Wider than the rewrite in
// packages/protocol/src/brand-cli.ts, so a command upstream adds later, or one
// written without a space before it, fails here instead of slipping through.
const UPSTREAM_COMMAND = /(?<![\w.@/$~-])paseo(?= +(?:[a-z<[]|-))/;

function withSubcommands(command) {
  return [command, ...command.commands.flatMap(withSubcommands)];
}

/** Everything `<command> --help` prints, including text added with addHelpText. */
function printedHelp(command) {
  let printed = "";
  command.outputHelp({
    write: (text) => {
      printed += text;
    },
  });
  return printed;
}

function allStrings(value) {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value).flatMap(allStrings);
}

test("every help page the CLI prints names woowtech-smart and woowtech smart", async () => {
  // Upstream's help text, rewritten as it prints (packages/cli/src/brand.ts).
  const { createCli } = await importSource("packages/cli/src/cli.ts");
  const pages = withSubcommands(createCli()).map(printedHelp);

  assert.deepEqual(
    pages.filter((page) => !/^Usage: woowtech-smart /m.test(page)),
    [],
  );
  assert.deepEqual(
    pages
      .flatMap((page) => page.split("\n"))
      // Paseo Hub is upstream's service until we run our own Hub.
      .filter((line) => UPSTREAM_COMMAND.test(line) || /\bPaseo\b(?! Hub\b)/.test(line)),
    [],
  );
});

test("errors the CLI prints name the woowtech-smart command, for people and for agents", async () => {
  const { renderError } = await importSource("packages/cli/src/output/render.ts");
  const error = {
    code: "DAEMON_NOT_RUNNING",
    message: "Cannot connect to daemon. Start with: paseo daemon start",
    details: 'Use "paseo ls" to list available agents',
  };

  for (const options of [{ noColor: true }, { format: "json" }, { format: "yaml" }]) {
    const printed = renderError(error, options);
    assert.match(printed, /woowtech-smart daemon start/, JSON.stringify(options));
    assert.doesNotMatch(printed, UPSTREAM_COMMAND, JSON.stringify(options));
  }
});

test("the app shows the woowtech-smart command in every language", async () => {
  // Upstream's translations, rewritten as they load (packages/app/src/i18n/brand.ts).
  const { i18n } = requireSource("packages/app/src/i18n/i18next.ts");
  if (!i18n.isInitialized) {
    await i18n.init();
  }
  const showingPaseo = Object.keys(i18n.store.data).flatMap((language) =>
    allStrings(i18n.getResourceBundle(language, "translation"))
      .filter((text) => UPSTREAM_COMMAND.test(text))
      .map((text) => `${language}: ${text}`),
  );

  assert.deepEqual(showingPaseo, []);
  assert.equal(
    i18n.t("desktop.daemon.fullStatus.hint", { lng: "en" }),
    "Runs `woowtech-smart daemon status` and shows the output",
  );
});

/** A macOS app bundle in `root` whose Resources/bin holds `clis`. */
function macApp(root, name, clis) {
  const contents = path.join(root, "Applications", `${name}.app`, "Contents");
  mkdirSync(path.join(contents, "MacOS"), { recursive: true });
  writeFileSync(path.join(contents, "MacOS", name), "");
  mkdirSync(path.join(contents, "Resources", "bin"), { recursive: true });
  for (const cli of clis) {
    writeFileSync(path.join(contents, "Resources", "bin", cli), "#!/bin/sh\n");
  }
  return contents;
}

test(
  "Install CLI adds woowtech-smart and leaves the official Paseo's paseo alone",
  // The stand-in app bundles below are laid out the way macOS lays them out.
  { skip: process.platform !== "darwin" && "macOS app bundle layout" },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), "woowtech-cli-install-"));
    const launchEnv = { HOME: process.env.HOME, SHELL: process.env.SHELL, PATH: process.env.PATH };
    try {
      // A home of its own, so nothing touches the real ~/.local/bin or ~/.zshrc.
      const home = path.join(root, "home");
      const localBin = path.join(home, ".local", "bin");
      mkdirSync(localBin, { recursive: true });
      Object.assign(process.env, { HOME: home, SHELL: "/bin/zsh", PATH: "/usr/bin:/bin" });
      const ourApp = macApp(root, "woowtech smart", ["woowtech-smart", "paseo"]);
      const officialPaseo = path.join(
        macApp(root, "Paseo", ["paseo"]),
        "Resources",
        "bin",
        "paseo",
      );
      symlinkSync(officialPaseo, path.join(localBin, "paseo"));
      // Left behind when our app moved: it runs no CLI of ours.
      symlinkSync(
        path.join(root, "Moved.app", "Contents", "Resources", "bin", "woowtech-smart"),
        path.join(localBin, "woowtech-smart"),
      );

      const { getCliInstallStatus, installCli } = requireSource(
        "packages/desktop/src/integrations/cli-install/install.ts",
        {
          electron: {
            app: { isPackaged: true, getPath: () => path.join(ourApp, "MacOS", "woowtech smart") },
          },
          "electron-log/main": { info() {}, warn() {} },
        },
      );

      assert.deepEqual(
        await getCliInstallStatus(),
        { installed: false },
        "a link that runs another app's CLI counted as ours",
      );
      assert.deepEqual(await installCli(), { installed: true });
      assert.deepEqual(readdirSync(localBin).sort(), ["paseo", "woowtech-smart"]);
      assert.equal(readlinkSync(path.join(localBin, "paseo")), officialPaseo);
      assert.equal(
        readlinkSync(path.join(localBin, "woowtech-smart")),
        path.join(ourApp, "Resources", "bin", "woowtech-smart"),
      );
    } finally {
      for (const [key, value] of Object.entries(launchEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(root, { recursive: true, force: true });
    }
  },
);

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

test("the daemon's, the apps' and the client's messages name the woowtech-smart command", () => {
  // The CLI and the desktop app show the daemon's messages as they are.
  assert.deepEqual(
    findInShippedSources([/(?:^|[\s"'`(])paseo (?:[a-z]|-)/], {
      dirs: [
        "packages/server/src",
        "packages/desktop/src",
        "packages/app/src",
        "packages/client/src",
        "packages/protocol/src",
      ],
      skipComments: true,
      // Translations are rewritten as they load; the app check above reads what they show.
      skipPaths: ["packages/app/src/i18n/resources/"],
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
