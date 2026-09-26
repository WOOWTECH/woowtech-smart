import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { DesktopDialogAskOptions } from "@/desktop/host";
import { confirmDialog, type ConfirmDialogPorts } from "./confirm-dialog";

interface AskedDialog {
  message: string;
  options: DesktopDialogAskOptions | undefined;
}

function dialogPort(result: boolean) {
  const calls: AskedDialog[] = [];
  const ports: ConfirmDialogPorts = {
    getDesktopHost: () => ({
      dialog: {
        ask: async (message, options) => {
          calls.push({ message, options });
          return result;
        },
      },
    }),
  };
  return { ports, calls };
}

const input = {
  title: "移除技能",
  message: "確定要移除嗎？",
  confirmLabel: "移除",
  destructive: true,
};

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("woowtech confirm dialog Cancel default", () => {
  it("preserves caller overrides including an explicitly empty Cancel label", async () => {
    await i18n.changeLanguage("zh-TW");
    const fake = dialogPort(false);
    for (const cancelLabel of ["Keep my custom label", ""]) {
      expect(await confirmDialog({ ...input, cancelLabel }, fake.ports)).toBe(false);
    }
    expect(fake.calls.map((call) => call.options?.cancelLabel)).toEqual([
      "Keep my custom label",
      "",
    ]);
  });

  it("resolves Cancel at call time after changing language without changing Confirm", async () => {
    const fake = dialogPort(true);
    const untranslatedInput = { title: "User title", message: "User message" };
    await i18n.changeLanguage("zh-TW");
    await confirmDialog(untranslatedInput, fake.ports);
    await i18n.changeLanguage("en");
    await confirmDialog(untranslatedInput, fake.ports);
    expect(fake.calls).toEqual([
      {
        message: "User message",
        options: { title: "User title", okLabel: "Confirm", cancelLabel: "取消", kind: "info" },
      },
      {
        message: "User message",
        options: { title: "User title", okLabel: "Confirm", cancelLabel: "Cancel", kind: "info" },
      },
    ]);
  });

  it("preserves desktop bridge rejection instead of treating it as confirmation", async () => {
    const failure = new Error("dialog unavailable");
    const ports: ConfirmDialogPorts = {
      getDesktopHost: () => ({
        dialog: {
          ask: async () => {
            throw failure;
          },
        },
      }),
    };
    await expect(confirmDialog(input, ports)).rejects.toBe(failure);
  });
  it("sends the active Traditional Chinese Cancel label through the real renderer helper", async () => {
    await i18n.changeLanguage("zh-TW");
    const fake = dialogPort(true);
    expect(await confirmDialog(input, fake.ports)).toBe(true);
    expect(fake.calls).toEqual([
      {
        message: input.message,
        options: {
          title: input.title,
          okLabel: "移除",
          cancelLabel: "取消",
          kind: "warning",
        },
      },
    ]);
  });
});
