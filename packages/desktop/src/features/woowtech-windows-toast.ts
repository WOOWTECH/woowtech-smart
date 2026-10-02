// woowtech smart: on Windows an agent notification is a protocol toast. A click makes Windows
// run `"woowtech smart.exe" "woowtech-smart://h/<server>/agent/<agent>"`, which lands in the
// existing argv / second-instance routing whether the app is running, sitting in the tray,
// or was quit long ago (README §25). Electron's default toast has no launch argument, so a
// click from Action Center after the notification object is gone opens nothing.

export interface ProtocolToastInput {
  launch: string;
  title: string;
  body?: string;
  /** file: URL of the app icon shown at the left of the toast. */
  iconUrl?: string | null;
  silent: boolean;
}

// XML 1.0 allows only tab, line feed, carriage return and the ranges below; one other
// character in an agent message would make Windows reject the whole toast. Iterating by code
// point leaves an unpaired surrogate as its own unit, in the excluded D800-DFFF range.
function isXmlCharacter(codePoint: number): boolean {
  return (
    codePoint === 0x9 ||
    codePoint === 0xa ||
    codePoint === 0xd ||
    (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
    (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
    codePoint >= 0x10000
  );
}

export function escapeToastXml(value: string): string {
  let text = "";
  for (const character of value) {
    if (isXmlCharacter(character.codePointAt(0) ?? 0)) {
      text += character;
    }
  }
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function buildProtocolToastXml(input: ProtocolToastInput): string {
  const texts = [input.title, input.body]
    .filter((text): text is string => typeof text === "string" && text.length > 0)
    .map((text) => `<text>${escapeToastXml(text)}</text>`)
    .join("");
  const image = input.iconUrl
    ? `<image placement="appLogoOverride" src="${escapeToastXml(input.iconUrl)}"/>`
    : "";
  const audio = input.silent ? `<audio silent="true"/>` : "";
  return (
    `<toast activationType="protocol" launch="${escapeToastXml(input.launch)}">` +
    `<visual><binding template="ToastGeneric">${texts}${image}</binding></visual>` +
    `${audio}</toast>`
  );
}

export function shouldUseProtocolToast(input: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  protocolRegistered: boolean;
  hasAgentTarget: boolean;
}): boolean {
  // Unpackaged runs toast as "Electron" and have no registered scheme (README §25).
  return (
    input.platform === "win32" &&
    input.isPackaged &&
    input.protocolRegistered &&
    input.hasAgentTarget
  );
}
