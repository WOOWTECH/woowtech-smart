// COMPAT(windowsCommandHelpers): moved into the plugin SDK in v0.17.4; remove after
// 2027-05-26 once fork callers use the plugin exports directly.
export {
  isWindowsCommandScript,
  quoteWindowsArgument,
  quoteWindowsCommand,
} from "@getpaseo/plugin/server";
