import { BRAND } from "./brand-values.js";
import { describe, expect, it } from "vitest";
import { CLI_COMMAND, cliCommandFileName, withCliCommand } from "./brand-cli.js";

describe(`the ${BRAND.name} CLI command`, () => {
  it(`is ${BRAND.cliCommand}, apart from the official Paseo's paseo`, () => {
    expect(CLI_COMMAND).toBe(BRAND.cliCommand);
  });

  it("is a .cmd trampoline on Windows and a plain executable elsewhere", () => {
    expect(cliCommandFileName("darwin")).toBe(BRAND.cliCommand);
    expect(cliCommandFileName("linux")).toBe(BRAND.cliCommand);
    expect(cliCommandFileName("win32")).toBe(`${BRAND.cliCommand}.cmd`);
  });
});

describe("naming our command in upstream's text", () => {
  it("replaces paseo where it runs a CLI command", () => {
    expect(withCliCommand("Usage: paseo agent archive <id-or-name>")).toBe(
      `Usage: ${BRAND.cliCommand} agent archive <id-or-name>`,
    );
    expect(withCliCommand('Use "paseo ls" to list available agents')).toBe(
      `Use "${BRAND.cliCommand} ls" to list available agents`,
    );
    expect(withCliCommand("Use `paseo terminal ls --all` to list available terminals.")).toBe(
      `Use \`${BRAND.cliCommand} terminal ls --all\` to list available terminals.`,
    );
    expect(withCliCommand("paseo --help")).toBe(`${BRAND.cliCommand} --help`);
    expect(withCliCommand("paseo host ls")).toBe(`${BRAND.cliCommand} host ls`);
    expect(withCliCommand("paseo usage")).toBe(`${BRAND.cliCommand} usage`);
    expect(withCliCommand("Run paseo hub init again.")).toBe(
      `Run ${BRAND.cliCommand} hub init again.`,
    );
    expect(
      withCliCommand(
        "Usage: paseo permit deny <agent> <req_id> or paseo permit deny <agent> --all",
      ),
    ).toBe(
      `Usage: ${BRAND.cliCommand} permit deny <agent> <req_id> or ${BRAND.cliCommand} permit deny <agent> --all`,
    );
    expect(withCliCommand('Logs: /h/daemon.log\nStatus: paseo daemon status --home "/h"')).toBe(
      `Logs: /h/daemon.log\nStatus: ${BRAND.cliCommand} daemon status --home "/h"`,
    );
  });

  it("leaves paths, files, variables, packages, links and other words alone", () => {
    const untouched = [
      "~/.paseo/daemon.log",
      "Wrote paseo.json",
      "PASEO_HOME is set",
      "npm install @getpaseo/cli",
      "paseo://h/server/agent/1",
      "/Users/me/paseo run",
      "C:\\paseo run",
      "[paseo] Plugin ready",
      'MCP server name "paseo" is reserved',
      "an agent named paseo helper",
      "the paseo-advisor skill",
      "Paseo daemon is running.",
      "paseo hooksy",
    ];
    for (const text of untouched) {
      expect(withCliCommand(text)).toBe(text);
    }
  });

  it("leaves text it already rewrote unchanged", () => {
    const once = withCliCommand("Start with: paseo daemon start");
    expect(withCliCommand(once)).toBe(once);
  });
});
