import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { ConfirmDialogInput } from "@/utils/confirm-dialog";
import { requestArchiveSubagent, type ArchiveSubagentDeps } from "./archive-subagent";
import { requestDetachSubagent, type DetachSubagentDeps } from "./detach-subagent";

function fixture(confirmed: boolean, error?: Error) {
  const dialogs: ConfirmDialogInput[] = [];
  const actions: string[] = [];
  const errors: unknown[] = [];
  const deps: ArchiveSubagentDeps & DetachSubagentDeps = {
    getSubagent: () => ({ title: "User-written title", status: "running" }),
    confirm: async (dialog) => {
      dialogs.push(dialog);
      return confirmed;
    },
    archiveAgent: async (input) => {
      expect(input).toEqual({ serverId: "server", agentId: "child" });
      if (error) throw error;
      actions.push("archive");
    },
    detachAgent: async (input) => {
      expect(input).toEqual({ serverId: "server", agentId: "child" });
      if (error) throw error;
      actions.push("detach");
    },
    openDetachedAgent: (input) => {
      expect(input).toEqual({ serverId: "server", agentId: "child" });
      actions.push("open");
    },
    reportError: (failure) => {
      errors.push(failure);
    },
  };
  return { dialogs, actions, errors, deps };
}

const input = { serverId: "server", subagentId: "child" };
const operations = [
  { name: "archive", request: requestArchiveSubagent, actions: ["archive"] },
  { name: "detach", request: requestDetachSubagent, actions: ["detach", "open"] },
];

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe.each(operations)("woowtech $name dialog public ports", ({ request, actions }) => {
  it.each([false, true])(
    "localizes Cancel at request time and preserves confirmation %s",
    async (confirmed) => {
      const f = fixture(confirmed);
      await i18n.changeLanguage("zh-TW");
      await request(input, f.deps);
      await i18n.changeLanguage("en");
      await request(input, f.deps);
      expect(f.dialogs.map((dialog) => dialog.cancelLabel)).toEqual(["取消", "Cancel"]);
      expect({ ...f.dialogs[0], cancelLabel: "Cancel" }).toEqual(f.dialogs[1]);
      expect(f.dialogs[0].message).toContain("User-written title");
      expect(f.actions).toEqual(confirmed ? [...actions, ...actions] : []);
      expect(f.errors).toEqual([]);
    },
  );

  it("reports the original mutation error without opening or treating it as success", async () => {
    const failure = new Error("synthetic daemon failure");
    const f = fixture(true, failure);
    await i18n.changeLanguage("zh-TW");
    await request(input, f.deps);
    expect(f.dialogs[0].cancelLabel).toBe("取消");
    expect(f.errors).toEqual([failure]);
    expect(f.actions).toEqual([]);
  });
});
