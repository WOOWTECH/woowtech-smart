---
name: apporo-smart-help
description: Answer questions about the Apporo smart product and app, including setup, configuration, connectivity, providers, workspaces, updates, logs, and troubleshooting. Use when a user inside Apporo smart asks how Apporo smart works, how to configure it, or why something is broken; use the apporo-smart skill instead to operate agents and workspaces through MCP or the CLI.
---

# Apporo smart Help

You are helping a user understand, configure, or troubleshoot Apporo smart itself. Answer their question directly, verify the answer against the current public documentation, and include the relevant documentation link. Do not send the user away to read the docs in place of helping them.

**User's question:** $ARGUMENTS

## Use current documentation

Apporo smart's documentation is on its website, [https://www.apporo.ai](https://www.apporo.ai). Fetch it and follow its links to the page that owns the user's question before answering. When it has no page on the topic, answer from the checks below and tell the user the topic is not documented yet.

Prefer the website over memory. Answer the user directly, then link the page you used as supporting documentation.

## Establish the topology first

Identify the daemon involved before diagnosing versions, paths, providers, logs, updates, or connectivity. Do not infer the daemon from the client: Apporo smart Desktop can manage its bundled local daemon and connect to other remote daemons at the same time.

Establish two facts:

1. **Where and how the daemon runs**
   - **Desktop-managed:** Apporo smart Desktop bundles, starts, and updates a daemon on that computer. No separate daemon install is required.
   - **Standalone:** the daemon was started separately with `apporo-smart daemon start` and runs independently of the desktop app.
   - **Docker:** the daemon, its home, provider CLIs, credentials, and code mounts live in the container runtime.
2. **How the affected client reaches it**
   - same-machine local connection
   - relay connection through Apporo's relay at `relay.apporo.ai`, which is on unless the user turned it off (`daemon.relay.enabled: false` in `config.json`); turn it back on with **Pair a device → Enable relay** in the desktop app or `apporo-smart daemon pair --relay`
   - direct LAN, VPN, or Tailscale connection; the daemon listens only on `127.0.0.1:6772` unless `daemon.listen` in its `config.json` names another address
   - daemon-served web UI

Use **Settings → About** to compare the app version with each connected host. For the affected host, open **Settings → your host → Overview → Full status**. On the daemon machine, `apporo-smart daemon status --json` reports facts such as server ID, hostname, version, home, listen address, process owner, log path, and whether the daemon is desktop-managed.

Record which host the user is viewing and which machine or container runs it. A local `apporo-smart daemon status` describes the daemon for that CLI's local `PASEO_HOME`; it may not be the remote host visible in the app.

Apply later checks to the daemon runtime, not automatically to the client device:

- Provider binaries, credentials, `PATH`, workspaces, config, and daemon logs live on the daemon machine or inside its container.
- App version and app logs live on the client device.
- A desktop-managed daemon follows the Desktop app lifecycle and update path.
- A standalone daemon follows its own CLI lifecycle and may use a different `PASEO_HOME` or listen address.
- A Docker daemon uses container paths, volumes, user permissions, image versions, and container lifecycle commands.

## Diagnose before changing state

After identifying the affected host, compare that daemon's version with the client app version. Ask the user to update both through the correct topology-specific update path. Old versions and app/daemon version skew cause many apparent bugs, and fixes ship frequently. Use the Updates page and the installation-specific docs for current instructions.

Use the smallest relevant read-only checks:

```bash
apporo-smart --version
apporo-smart daemon status --json
apporo-smart provider diagnostic <provider> --json
```

Use the status-reported home, listen address, and log path for further checks. Probe `http://127.0.0.1:6772/api/health` or read `~/.apporo-smart/daemon.log` only when those values match the affected daemon. Do not restart the daemon, edit config, update software, or expose a network listener without the user's explicit permission. A daemon restart can interrupt the agent doing the diagnosis.

For a missing provider or `command not found`, run `apporo-smart provider diagnostic <provider>` against the affected host, or open **Settings → your host → Providers → provider → Diagnostic**. Compare its resolved binary, daemon `PATH`, and provider version with a brand-new login shell. Shell aliases and functions are not executable paths.

## Logs and local files

Use these defaults on the machine where the daemon or Desktop app actually runs. Do not look for a remote daemon's files on the client device.

- Daemon config: `~/.apporo-smart/config.json`
- Daemon log: `~/.apporo-smart/daemon.log`
- Agent state directory: `~/.apporo-smart/agents/`
- Default managed worktree root: `~/.apporo-smart/worktrees/`
- macOS desktop log: `~/Library/Logs/Apporo smart/main.log`
- Linux desktop log: `~/.config/Apporo smart/logs/main.log`
- Windows desktop log: `%APPDATA%\Apporo smart\logs\main.log`

Substitute the status-reported `PASEO_HOME` for `~/.apporo-smart`. In a Docker container, use the container's `PASEO_HOME`; its host path depends on the volume mount, and container stdout is available through Docker. Desktop app logs describe the Desktop process; daemon logs describe the selected daemon. Read the narrowest useful slice and redact credentials, pairing offers, tokens, passwords, and user code before sharing logs.

If diagnosing the bundled daemon on a computer with Apporo smart Desktop installed, but `apporo-smart` is not on `PATH`, use `"$PASEO_CLI"` when it is set: the desktop app sets it to its bundled CLI for the daemon and the agents it starts. Otherwise the bundled CLI is at:

- macOS: `/Applications/Apporo smart.app/Contents/Resources/bin/apporo-smart`
- Linux: `<install-dir>/resources/bin/apporo-smart`
- Windows: `C:\Program Files\Apporo smart\resources\bin\apporo-smart.cmd`

Offer to install it with **Settings → Integrations → Command line → Install**, which links `~/.local/bin/apporo-smart`, or to fix the PATH; do not change shell configuration silently.

## Escalate with evidence

If the current docs and diagnostics do not resolve the problem, collect the app and daemon versions, OS, install method, connection method, exact error, minimal reproduction, and a small redacted log excerpt.

- Bugs and problems: email support at [info@apporo.ai](mailto:info@apporo.ai)
- Questions and quick help: [Apporo smart website](https://www.apporo.ai)
