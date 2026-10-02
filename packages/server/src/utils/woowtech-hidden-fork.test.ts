import { describe, expect, it } from "vitest";
import { withHiddenWindow } from "./woowtech-hidden-fork.js";

describe("withHiddenWindow", () => {
  it("adds windowsHide and keeps every other fork option", () => {
    const options = {
      execArgv: ["--enable-source-maps"],
      serialization: "advanced" as const,
      stdio: ["ignore", "pipe", "pipe", "ipc"] as Array<"ignore" | "pipe" | "ipc">,
    };
    expect(withHiddenWindow(options)).toEqual({ ...options, windowsHide: true });
    expect(options).not.toHaveProperty("windowsHide");
  });
});
