// woowtech smart: the About window names WOOW TECH as the copyright holder and shows the
// product website. electron-builder.yml's `copyright` becomes the Mac app's
// NSHumanReadableCopyright (Finder's Get Info and the About window); left unset, electron-builder
// wrote "Copyright © <year> <package.json author>", upstream's author. Passing the same line
// here also covers unpackaged runs, and a guard keeps the two equal. macOS does not show the
// `website` option (Linux does), so the URL goes into `credits` as well. The app name and
// version keep their defaults.
import { BRAND_LINKS } from "@getpaseo/protocol/brand-links";

export const WOOWTECH_COPYRIGHT = "© 2026 WOOW TECH CO., LTD.";

/** The website with its root path, as a browser shows it: https://aiot.woowtech.io/ */
const WEBSITE = new URL(BRAND_LINKS.website).href;

export function woowtechAboutPanelOptions(): Electron.AboutPanelOptionsOptions {
  return {
    copyright: WOOWTECH_COPYRIGHT,
    credits: WEBSITE,
    website: WEBSITE,
  };
}
