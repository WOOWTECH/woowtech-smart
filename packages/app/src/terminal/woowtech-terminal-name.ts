import type { TFunction } from "i18next";

// woowtech smart (woowtech/README.md section 25): the daemon names a new terminal "Terminal 1",
// "Terminal 2" and so on in English (packages/server/src/terminal/terminal-manager.ts), and one
// created without a name "Terminal" (terminal.ts). Those default names read in the app language. A
// name someone gave the terminal, or a title its shell set, stays as it is.
const NUMBERED_DEFAULT_NAME = /^Terminal (\d+)$/;

export function terminalDisplayName(name: string, t: TFunction): string {
  if (name === "Terminal") {
    return t("workspace.tabs.fallback.terminal");
  }
  const numbered = NUMBERED_DEFAULT_NAME.exec(name);
  return numbered ? t("woowtech.terminalName.numbered", { number: numbered[1] }) : name;
}
