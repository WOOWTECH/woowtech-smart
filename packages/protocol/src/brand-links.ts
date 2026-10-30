// Where the app sends people outside it: the brand's website, privacy policy, support
// email and public releases repository. The app and the CLI both read these, so a link
// changes in the brand's JSON (woowtech/brands) and nowhere else. Community help goes to
// the website's home page; nothing leads to the LINE official account any more.
import { BRAND } from "./brand-values.js";

const WEBSITE_HOST = BRAND.links.websiteHost;
const WEBSITE = `https://${WEBSITE_HOST}`;
const RELEASES_REPO = BRAND.links.releasesRepo;

export const BRAND_LINKS = {
  website: WEBSITE,
  /** The website as the app shows it, without the scheme. */
  websiteHost: WEBSITE_HOST,
  supportEmail: `mailto:${BRAND.links.supportEmail}`,
  /** The privacy policy (Apple 5.1.1 and Google Play want it in the app). */
  privacyPolicy: BRAND.links.privacyPolicy,
  /** The privacy policy for the app in Chinese. */
  privacyPolicyZh: BRAND.links.privacyPolicyZh,
  releases: `https://github.com/${RELEASES_REPO}/releases`,
  /** The newest release's page, for people who install the desktop app by hand. */
  latestRelease: `https://github.com/${RELEASES_REPO}/releases/latest`,
  /** Where a release's files download from: `${releaseDownloads}/v0.8.1/<file>`. */
  releaseDownloads: `https://github.com/${RELEASES_REPO}/releases/download`,
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
