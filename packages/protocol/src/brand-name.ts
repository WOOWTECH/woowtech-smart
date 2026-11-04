// The product's name where the daemon writes it in English: its errors and prompts that the
// app and the CLI show, its diagnostics report, and text that leaves the machine, such as the
// body of a pull request it opens. Chinese screens show PRODUCT_NAME_ZH through the app's
// translations (packages/app/src/i18n/brand.ts). The values are the brand this checkout
// builds (woowtech/brands).
import { BRAND } from "./brand-values.js";

export const PRODUCT_NAME = BRAND.name;

/** The name in Chinese text: 渥屋智能. Apporo smart has no Chinese name, so it is the English one. */
export const PRODUCT_NAME_ZH = BRAND.nameZh;

/** Who runs the relay and the push relay, as text names them: "WoowTech cannot read your code". */
export const BRAND_OPERATOR = BRAND.company.operator;

/** The desktop app's copyright line: macOS Get Info, the About window, the Windows executable. */
export const BRAND_COPYRIGHT = BRAND.company.copyright;

/** "Paseo Desktop" in Chinese text: 渥屋智能桌面版, Apporo smart 桌面版. */
export const PRODUCT_DESKTOP_NAME_ZH = BRAND.desktopNameZh;
