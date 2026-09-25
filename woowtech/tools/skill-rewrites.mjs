// How upstream's agent skills become woowtech smart's. generate-skills.mjs runs
// every SKILL.md through the rewriter: first the passages rewritten by hand,
// then the patterns that apply everywhere.
//
// The plugin API is still upstream's, so its identifiers (`usePaseo()`,
// `{ paseo }`, `requirements.paseo`, @getpaseo/plugin), the Paseo SDK and the
// plugin docs and examples on paseo.sh and GitHub stay as they are.

/**
 * Passages rewritten by hand. Each must appear exactly once in its upstream
 * skill: when upstream edits one, generation stops until it is updated here.
 */
function passageRewrites({ cliCommand, links, port, productName }) {
  const cliFallback = [
    `The CLI command is \`${cliCommand}\`. If it is not on \`PATH\`, run \`"$PASEO_CLI"\``,
    "instead when that variable is set; the desktop app sets it to its bundled CLI for the",
    "daemon and the agents it starts.",
  ].join(" ");
  const supportAddress = links.supportEmail.replace(/^mailto:/, "");
  const append = (find, addition) => ({ find, replace: `${find}\n${addition}\n` });

  return [
    {
      skill: "paseo",
      ...append(
        "Paseo is a remote daemon that manages coding agents, terminals. Control it through MCP tools or the CLI.\n",
        cliFallback,
      ),
    },
    {
      skill: "paseo-plugin",
      ...append(
        "Use an absolute path on the daemon machine. `init` writes files but does not install packages.\n",
        cliFallback,
      ),
    },
    {
      // Our website instead of Paseo's documentation.
      skill: "paseo-help",
      find: [
        "Fetch [https://paseo.sh/llms.txt](https://paseo.sh/llms.txt) first. It is the current index of Paseo documentation, with a description and Markdown URL for each page.",
        "",
        "Use that index to select the page that owns the user's question, then fetch the linked `.md` page before answering. For troubleshooting, begin with [Common problems](https://paseo.sh/docs/troubleshooting.md) and follow its links when the issue belongs to a more specific page.",
        "",
        "Prefer the deployed docs over memory. Answer the user directly, then link the relevant `.md` page as supporting documentation.",
      ].join("\n"),
      replace: [
        `${productName}'s documentation is on its website, [${links.docs.home}](${links.docs.home}). Fetch it and follow its links to the page that owns the user's question before answering. When it has no page on the topic, answer from the checks below and tell the user the topic is not documented yet.`,
        "",
        "Prefer the website over memory. Answer the user directly, then link the page you used as supporting documentation.",
      ].join("\n"),
    },
    {
      // The daemon ships with the desktop app; there is no npm package.
      skill: "paseo-help",
      find: "   - **Standalone:** the daemon was installed separately, commonly through the npm CLI, and runs independently of the desktop app.",
      replace: `   - **Standalone:** the daemon was started separately with \`${cliCommand} daemon start\` and runs independently of the desktop app.`,
    },
    {
      skill: "paseo-help",
      find: "- A standalone daemon follows its own CLI/npm lifecycle",
      replace: "- A standalone daemon follows its own CLI lifecycle",
    },
    {
      // Our relay is off by default, and the daemon listens on loopback only.
      skill: "paseo-help",
      find: "   - relay connection\n   - direct LAN, VPN, or Tailscale connection\n",
      replace: [
        `   - relay connection, which is off until the user enables it with **Pair a device → Enable relay** in the desktop app or \`${cliCommand} daemon pair --relay\``,
        `   - direct LAN, VPN, or Tailscale connection; the daemon listens only on \`127.0.0.1:${port}\` unless \`daemon.listen\` in its \`config.json\` names another address`,
        "",
      ].join("\n"),
    },
    {
      // We publish no Docker image.
      skill: "paseo-help",
      find: "In the official Docker image, the default is `/home/paseo/.paseo`;",
      replace: "In a Docker container, use the container's `PASEO_HOME`;",
    },
    {
      skill: "paseo-help",
      find: [
        "If diagnosing the bundled daemon on a computer with Paseo Desktop installed, but `paseo` is not on `PATH`, the bundled CLI is at:",
        "",
        "- macOS: `/Applications/Paseo.app/Contents/Resources/bin/paseo`",
        "- Linux: `<install-dir>/resources/bin/paseo`",
        "- Windows: `C:\\Program Files\\Paseo\\resources\\bin\\paseo.cmd`",
        "",
        "Offer to fix the PATH or symlink; do not change shell configuration silently.",
      ].join("\n"),
      replace: [
        `If diagnosing the bundled daemon on a computer with ${productName} Desktop installed, but \`${cliCommand}\` is not on \`PATH\`, use \`"$PASEO_CLI"\` when it is set: the desktop app sets it to its bundled CLI for the daemon and the agents it starts. Otherwise the bundled CLI is at:`,
        "",
        `- macOS: \`/Applications/${productName}.app/Contents/Resources/bin/${cliCommand}\``,
        `- Linux: \`<install-dir>/resources/bin/${cliCommand}\``,
        `- Windows: \`C:\\Program Files\\${productName}\\resources\\bin\\${cliCommand}.cmd\``,
        "",
        `Offer to install it with **Settings → Integrations → Command line → Install**, which links \`~/.local/bin/${cliCommand}\`, or to fix the PATH; do not change shell configuration silently.`,
      ].join("\n"),
    },
    {
      // WoowTech's help channels instead of Paseo's GitHub and Discord.
      skill: "paseo-help",
      find: [
        "- Bugs: [GitHub Issues](https://github.com/getpaseo/paseo/issues)",
        "- Questions and quick help: [Paseo Discord](https://discord.gg/jz8T2uahpH)",
        "- Product workflow discussions: [GitHub Discussions](https://github.com/getpaseo/paseo/discussions) or `#product` in Discord",
      ].join("\n"),
      replace: [
        `- Bugs and problems: email support at [${supportAddress}](${links.supportEmail})`,
        `- Questions and quick help: [LINE official account](${links.lineOfficialAccount})`,
      ].join("\n"),
    },
  ];
}

/** Rewrites that apply wherever they match, in this order. */
function patternRewrites({
  cliCommand,
  withCliCommand,
  brandSkillName,
  daemonHome,
  port,
  productName,
  upstreamSkills,
}) {
  const skillName = (name) => (upstreamSkills.includes(name) ? brandSkillName(name) : name);
  return [
    // The skill's own name.
    (text) =>
      text.replace(/^(name: )(paseo(?:-[a-z]+)*)$/m, (_, key, name) => `${key}${skillName(name)}`),
    // Another skill: **paseo-help**, /paseo-advisor or "the paseo skill". A
    // slash before a file name, as in /paseo-plugin.json, is a path.
    (text) => text.replace(/\*\*(paseo(?:-[a-z]+)*)\*\*/g, (_, name) => `**${skillName(name)}**`),
    (text) =>
      text.replace(
        /(?<=^|[\s`(])\/(paseo(?:-[a-z]+)*)(?![\w-]|\.\w)/g,
        (_, name) => `/${skillName(name)}`,
      ),
    (text) =>
      text.replace(/(?<![\w.@/-])paseo(?:-[a-z]+)*(?= skill\b)/g, (name) => skillName(name)),
    // The CLI: `paseo <command>` and the `paseo <cmd> --help` placeholder.
    (text) => withCliCommand(text),
    (text) => text.replace(/(?<=^|[\s"'`(])paseo(?= <[\w-]+>)/g, cliCommand),
    // The daemon's home and port.
    (text) => text.replace(/~\/\.paseo\b/g, daemonHome),
    (text) => text.replace(/\b6767\b/g, port),
    // The product. Paseo Hub stays upstream's service until we run our own, as
    // in the CLI, and the Paseo SDK is the plugin API's name.
    (text) => text.replace(/\bPaseo\b(?! (?:Hub|SDK)\b)/g, productName),
  ];
}

export function createSkillRewriter(context) {
  const passages = passageRewrites(context);
  const patterns = patternRewrites(context);
  const applied = new Set();

  return {
    rewrite(skill, file, text) {
      let result = text;
      for (const passage of passages) {
        if (passage.skill !== skill || file !== "SKILL.md") continue;
        const count = result.split(passage.find).length - 1;
        if (count !== 1) {
          throw new Error(
            `skills/${skill}/${file} has this passage ${count} times instead of once. ` +
              `Upstream changed it: update woowtech/tools/skill-rewrites.mjs.\n\n${passage.find}`,
          );
        }
        result = result.replace(passage.find, () => passage.replace);
        applied.add(passage);
      }
      return patterns.reduce((current, rewrite) => rewrite(current), result);
    },
    assertEveryRuleApplied() {
      const missing = passages.filter((passage) => !applied.has(passage));
      if (missing.length > 0) {
        throw new Error(
          "Upstream no longer has these skills: " +
            [...new Set(missing.map((passage) => passage.skill))].join(", ") +
            ". Update woowtech/tools/skill-rewrites.mjs.",
        );
      }
    },
  };
}
