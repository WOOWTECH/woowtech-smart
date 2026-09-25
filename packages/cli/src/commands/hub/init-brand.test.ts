import { afterEach, describe, expect, it, vi } from "vitest";
import { createHubCommand } from "./index.js";

// `hub init` prints its own stop messages instead of going through the CLI's
// error output, so it names our command itself.
describe("hub init", () => {
  const savedExitCode = process.exitCode;

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = savedExitCode;
  });

  it("names the woowtech-smart command when it stops", async () => {
    let printed = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      printed += String(chunk);
      return true;
    });

    await createHubCommand({ isInteractive: () => false }).parseAsync(["init"], {
      from: "user",
    });

    expect(printed).toContain("woowtech-smart hub init requires a TTY.");
    expect(printed).not.toContain("paseo hub init");
  });
});
