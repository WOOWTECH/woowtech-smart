// Where woowtech smart sends people outside the app: WoowTech's website, support
// email and public releases repository. The app and the CLI both read these, so a
// link changes here and nowhere else. Community help goes to the website's home
// page; nothing leads to the LINE official account any more.

const WEBSITE_HOST = "aiot.woowtech.io";
const WEBSITE = `https://${WEBSITE_HOST}`;
const RELEASES_REPO = "WOOWTECH/woowtech-smart-releases";

export const BRAND_LINKS = {
  website: WEBSITE,
  /** The website as the app shows it, without the scheme. */
  websiteHost: WEBSITE_HOST,
  supportEmail: "mailto:woowtech@designsmart.com.tw",
  releases: `https://github.com/${RELEASES_REPO}/releases`,
  changelogSource: `https://raw.githubusercontent.com/${RELEASES_REPO}/main/CHANGELOG.md`,
  // The website has no documentation pages yet, so every topic opens its home
  // page. Give a topic its own address once its page exists.
  docs: {
    home: WEBSITE,
    cli: WEBSITE,
    configuration: WEBSITE,
    metadataGeneration: WEBSITE,
    schedules: WEBSITE,
    security: WEBSITE,
    skills: WEBSITE,
    worktrees: WEBSITE,
  },
} as const;
