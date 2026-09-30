// Every third-party vendor mark upstream ships in the app and the desktop app, by vendor, and
// whether woowtech smart shows it. woowtech/README.md section 22.
//
//   show       "badge": woowtech smart's neutral text badge
//              (packages/app/src/components/icons/vendor-badge.ts).
//              "upstream": the vendor's own logo, as upstream shows it. Only for a vendor whose
//              logo the owner has cleared for use.
//   logo       How the badge's icon component names what it replaces, for its comment.
//   files      The vendor's icon files, as upstream ships them at UPSTREAM_REF.
//   acpIcons   The vendor's entries in packages/app/src/assets/acp-provider-icons.ts.
//   logoPaths  The start of each copy of the logo's path data, compared with whitespace and
//              commas removed. Nothing that ships may contain one while the vendor shows its
//              badge. Logos drawn only from circles, rectangles or <text>, or from paths too plain
//              to tell apart from other drawings, have none; the file checks cover them.
//
// To show one vendor's upstream logo again: set its show to "upstream", then run
//   node woowtech/tools/write-vendor-badges.mjs
//   node --test woowtech/claude-badge.test.mjs
// The tool restores the vendor's files and ACP entries from UPSTREAM_REF; setting show back to
// "badge" and running it again writes the badge.

// The last commit before woowtech smart changed any vendor icon. For every vendor but Claude it
// matches main fde226d05; fde226d05 already had the Claude badge (commit 130705c02).
export const UPSTREAM_REF = "130705c02^";

const icons = "packages/app/src/components/icons";
const acp = "packages/app/src/assets/acp-provider-icons";
const editors = "packages/desktop/assets/editor-targets";

export const VENDOR_MARKS = {
  claude: {
    show: "badge",
    logo: "Anthropic's Claude logo",
    files: [
      `${icons}/claude-icon.tsx`,
      "packages/app/assets/icons/claude.svg",
      `${acp}/claude-acp.svg`,
    ],
    acpIcons: ["claude-acp"],
    logoPaths: [
      "M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073",
      "M 233.959793 800.214905 L 468.644287 668.536987 L 472.590637 657.100647",
    ],
  },
  codex: {
    show: "badge",
    logo: "OpenAI's Codex logo",
    files: [
      `${icons}/codex-icon.tsx`,
      "packages/app/assets/icons/codex.svg",
      `${acp}/codex-acp.svg`,
    ],
    acpIcons: ["codex-acp"],
    logoPaths: [
      "M21.55 10.004a5.416 5.416 0 00-.478-4.501c-1.217-2.09-3.662-3.166-6.05",
      "M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9",
    ],
  },
  copilot: {
    show: "badge",
    logo: "GitHub Copilot's logo",
    files: [`${icons}/copilot-icon.tsx`, `${acp}/github-copilot-cli.svg`],
    acpIcons: ["github-copilot-cli"],
    logoPaths: [
      "M512.002 246.393v57.384c-.02 7.411-3.696 14.638-9.67 19.011",
      "M7.99816 14.2779C12.0678 14.2779 14.9997 11.6274 14.9997 10.9574",
    ],
  },
  opencode: {
    show: "badge",
    logo: "OpenCode's logo",
    files: [`${icons}/opencode-icon.tsx`, `${acp}/opencode.svg`],
    acpIcons: ["opencode"],
    logoPaths: [
      "M384 416H128V96H384V416ZM320 160H192V352H320V160Z",
      "M13 14H3V2H13V14ZM10.5 4.4H5.5V11.6H10.5V4.4Z",
    ],
  },
  pi: {
    show: "badge",
    logo: "Pi's logo",
    files: [`${icons}/pi-icon.tsx`, `${acp}/pi-acp.svg`],
    acpIcons: [],
    logoPaths: [
      "M165.29 165.29 H517.36 V400 H400 V517.36 H282.65 V634.72 H165.29 Z",
      "M1 1H11.7692V7.9999H8.17942V11.4999H4.58982V15H1V1Z",
    ],
  },
  omp: {
    show: "badge",
    logo: "OMP's logo",
    files: [`${icons}/omp-icon.tsx`],
    acpIcons: [],
    logoPaths: ["M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z"],
  },
  minimax: {
    show: "badge",
    logo: "MiniMax's logo",
    files: [`${icons}/minimax-icon.tsx`],
    acpIcons: ["minimax-code"],
    logoPaths: [
      "M16.278 2c1.156 0 2.093.927 2.093 2.07v12.501a.74.74 0 00.744.709",
      "M2 3h3l3 5 3-5h3v10h-2V6.5l-4 6-4-6V13H2V3Z",
    ],
  },
  discord: {
    show: "badge",
    logo: "Discord's logo",
    files: [`${icons}/discord-icon.tsx`],
    acpIcons: [],
    logoPaths: ["M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785"],
  },
  antigravity: {
    show: "badge",
    files: [`${editors}/antigravity.png`],
    acpIcons: ["agy"],
    logoPaths: ["M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12"],
  },
  agoragentic: {
    show: "upstream",
    files: [`${acp}/agoragentic-acp.svg`],
    acpIcons: ["agoragentic-acp"],
    logoPaths: [],
  },
  amp: {
    show: "badge",
    files: [`${acp}/amp-acp.svg`],
    acpIcons: ["amp-acp"],
    logoPaths: ["M23.9803 3.55632L27.4422 16.5124L24.3025 17.3512L21.325 6.21062"],
  },
  auggie: {
    show: "badge",
    files: [`${acp}/auggie.svg`],
    acpIcons: ["auggie"],
    logoPaths: ["M9.972 13.193h2.577q.187 0 .277-.09t.091-.294V10.47q0-.324.133-.59"],
  },
  autohand: {
    show: "upstream",
    files: [`${acp}/autohand.svg`],
    acpIcons: ["autohand"],
    logoPaths: ["M7.23002 9.59292C7.23002 9.40231 7.07148 9.24779 6.87591 9.24779"],
  },
  cline: {
    show: "badge",
    files: [`${acp}/cline.svg`],
    acpIcons: ["cline"],
    logoPaths: ["M65.45 16.3c10.89 0 19.71 8.86 19.71 19.8v6.6l5.74 11.46"],
  },
  codebuddy: {
    show: "badge",
    files: [`${acp}/codebuddy-code.svg`],
    acpIcons: ["codebuddy-code"],
    logoPaths: ["M12.13 1.25c.15-.14.16-.14.28-.15.18 0 .36.08.64.34.68.62 1.61 1.89"],
  },
  codewhale: {
    show: "badge",
    files: [`${acp}/codewhale.svg`],
    acpIcons: ["codewhale"],
    logoPaths: [],
  },
  "cortex-code": {
    show: "upstream",
    files: [`${acp}/cortex-code.svg`],
    acpIcons: ["cortex-code"],
    logoPaths: ["M1562.63,107.07h-4.18v5.15h4.18c1.94,0,3.21-.87,3.21-2.53"],
  },
  corust: {
    show: "badge",
    files: [`${acp}/corust-agent.svg`],
    acpIcons: ["corust-agent"],
    logoPaths: ["m 2476.7,5111.6 c -64.95,-6.2305 -71.077,-28.66 -73.528,-325.23"],
  },
  crow: {
    show: "upstream",
    files: [`${acp}/crow-cli.svg`],
    acpIcons: ["crow-cli"],
    logoPaths: ["m 26,275.93574 c 0.65,-9.32 8.46,-15.43 15,-20.96 15.43,-13.04"],
  },
  cursor: {
    show: "badge",
    files: [`${acp}/cursor.svg`, `${editors}/cursor.png`],
    acpIcons: ["cursor"],
    logoPaths: ["M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94"],
  },
  deepagents: {
    show: "badge",
    files: [`${acp}/deepagents.svg`],
    acpIcons: ["deepagents"],
    logoPaths: ["M99.4385 87.698C91.9239 80.1832 81.7121 75.9531 71.0844 75.9531"],
  },
  dimcode: {
    show: "upstream",
    files: [`${acp}/dimcode.svg`],
    acpIcons: ["dimcode"],
    logoPaths: ["M3.12109 11.0078H1.99902V5.49316H3.12109V11.0078Z"],
  },
  dirac: {
    show: "upstream",
    files: [`${acp}/dirac.svg`],
    acpIcons: ["dirac"],
    logoPaths: [],
  },
  "factory-droid": {
    show: "badge",
    files: [`${acp}/factory-droid.svg`],
    acpIcons: ["factory-droid"],
    logoPaths: ["M622.037 192.524a10.58 10.58 0 0 1-4.056-2.001 10.573 10.573 0 0 1-3.9"],
  },
  "fast-agent": {
    show: "upstream",
    files: [`${acp}/fast-agent.svg`],
    acpIcons: ["fast-agent"],
    logoPaths: [],
  },
  gemini: {
    show: "badge",
    files: [`${acp}/gemini.svg`],
    acpIcons: ["gemini"],
    logoPaths: ["M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81"],
  },
  "gajae-code": {
    show: "upstream",
    files: [`${acp}/gjc.svg`],
    acpIcons: ["gjc"],
    logoPaths: ["M365.5 654H450.5A15.5 15.5 0 0 1 466 669.5A15.5 15.5 0 0 1 450.5 685"],
  },
  glm: {
    show: "badge",
    files: [`${acp}/glm-acp-agent.svg`],
    acpIcons: ["glm-acp-agent"],
    logoPaths: ["M8.07 1.333L6.618 3.302H.435L1.887 1.333h6.184z"],
  },
  goose: {
    show: "badge",
    files: [`${acp}/goose.svg`],
    acpIcons: ["goose"],
    logoPaths: ["M20.9093 19.3861L19.5185 18.2413C18.7624 17.619 18.1189 16.8713"],
  },
  grok: {
    show: "badge",
    files: [],
    acpIcons: ["grok"],
    logoPaths: ["M395.479 633.828L735.91 381.105C752.599 368.715 776.454 373.548"],
  },
  junie: {
    show: "badge",
    files: [`${acp}/junie.svg`],
    acpIcons: ["junie"],
    logoPaths: ["M25 15H35V16.75C35 29 30.5001 35 16.5001 35H15V25H16.5001"],
  },
  kilo: {
    show: "badge",
    files: [`${acp}/kilo.svg`],
    acpIcons: ["kilo"],
    logoPaths: ["M27.9998324,34.6666921h6.6666279v5.3333023h-8.3809037"],
  },
  kimi: {
    show: "badge",
    files: [`${acp}/kimi.svg`],
    acpIcons: ["kimi"],
    logoPaths: ["M19.514 7.342C19.711 7.862 19.814 8.413 19.816 8.969C19.816 12.494"],
  },
  "minion-code": {
    show: "badge",
    files: [`${acp}/minion-code.svg`],
    acpIcons: ["minion-code"],
    logoPaths: [],
  },
  "mistral-vibe": {
    show: "badge",
    files: [`${acp}/mistral-vibe.svg`],
    acpIcons: ["mistral-vibe"],
    logoPaths: ["M22.6419 5.35803H19.1851V8.46914H22.6419V5.35803Z"],
  },
  nova: {
    show: "upstream",
    files: [`${acp}/nova.svg`],
    acpIcons: ["nova"],
    logoPaths: [],
  },
  poolside: {
    show: "badge",
    files: [`${acp}/poolside.svg`],
    acpIcons: ["poolside"],
    logoPaths: ["M2.63653 5.50522L2.18735 5.28559C2.09852 5.46726 2.12787 5.68456"],
  },
  qoder: {
    show: "upstream",
    files: [`${acp}/qoder.svg`],
    acpIcons: ["qoder"],
    logoPaths: [],
  },
  "qwen-code": {
    show: "badge",
    files: [`${acp}/qwen-code.svg`],
    acpIcons: ["qwen-code"],
    logoPaths: ["m140.93 85-16.35-28.33-1.93-3.34 8.66-15a3.323 3.323 0 0 0 0-3.34"],
  },
  sigit: {
    show: "upstream",
    files: [`${acp}/sigit.svg`],
    acpIcons: ["sigit"],
    logoPaths: [
      "M6428 6358 c-104 -8 -227 -38 -314 -78 -73 -33 -196 -115 -239 -160",
      "M9010 5130 c-12 -7 -10 -9 7 -7 12 0 19 5 17 9 -6 10 -6 10 -24 -2z",
    ],
  },
  stakpak: {
    show: "upstream",
    files: [`${acp}/stakpak.svg`],
    acpIcons: ["stakpak"],
    logoPaths: ["M6.53 4.412h5.883v3.587H9.471v3.588H3.588V7.999H6.53Z"],
  },
  trae: {
    show: "badge",
    files: [],
    acpIcons: ["traecli"],
    logoPaths: ["M2.4 4.8H21.6V19.2H2.4Z M5.92 7.52H19.2V15.36H5.92Z"],
  },
  vtcode: {
    show: "upstream",
    files: [`${acp}/vtcode.svg`],
    acpIcons: ["vtcode"],
    logoPaths: [],
  },
  "android-studio": {
    show: "badge",
    files: [`${editors}/android-studio.png`],
    acpIcons: [],
    logoPaths: [],
  },
  finder: {
    show: "badge",
    files: [`${editors}/finder.png`],
    acpIcons: [],
    logoPaths: [],
  },
  vscode: {
    show: "badge",
    files: [`${editors}/vscode.png`],
    acpIcons: [],
    logoPaths: [],
  },
  webstorm: {
    show: "badge",
    files: [`${editors}/webstorm.png`],
    acpIcons: [],
    logoPaths: [],
  },
  zed: {
    show: "badge",
    files: [`${editors}/zed.png`],
    acpIcons: [],
    logoPaths: [],
  },
};
