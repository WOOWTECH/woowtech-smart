// woowtech smart's agent skills are upstream's under our own names. The official
// Paseo installs paseo, paseo-advisor, … into the same agent homes, and a shared
// name would make each daemon rewrite, and each uninstall delete, the other's.
// woowtech/tools/generate-skills.mjs names the skills we ship with this, and the
// daemon names the skills it used to ship with it.
import { CLI_COMMAND } from "./brand-cli.js";

/** Our name for the skill upstream calls `upstreamName`: paseo-advisor → woowtech-smart-advisor. */
export function brandSkillName(upstreamName: string): string {
  return upstreamName.replace(/^paseo(?=-|$)/, CLI_COMMAND);
}
