import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import { buildSettingsSectionRoute, isSettingsSectionSlug } from "@/utils/host-routes";
import {
  EDITOR_MARK_NOTICES,
  FILE_TYPE_MARK_NOTICES,
  FORGE_MARK_NOTICES,
  MIT_LICENSE_TEXT,
  MIT_NOTICES,
  VENDOR_MARK_NOTICES,
  buildThirdPartyNotices,
  type NoticeRow,
  type NoticeSection,
} from "./woowtech-third-party-notices";

// woowtech smart's page of the third-party marks it shows (woowtech/README.md section 24). Which
// marks ship is guarded by woowtech/third-party-notices.test.mjs; these tests pin what the page
// says about each of them.

const CC_BY_4 = { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" };
const CC_BY_SA_4 = { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" };

function fileTypeNotice(icon: string) {
  const notice = FILE_TYPE_MARK_NOTICES.find((candidate) => candidate.icons.includes(icon));
  if (!notice) throw new Error(`no notice draws the ${icon} icon`);
  return notice;
}

/** Every line the page shows in `language`, section by section. */
function pageIn(language: string): NoticeSection[] {
  return buildThirdPartyNotices(i18n.getFixedT(language));
}

const rowTexts = (row: NoticeRow) => [row.title].concat(row.lines);

/** Every title and line the page shows in `language`, in order. */
function textsIn(language: string): string[] {
  return pageIn(language).flatMap((section) =>
    [section.title].concat(section.rows.flatMap(rowTexts)),
  );
}

function rowOf(sections: NoticeSection[], sectionId: NoticeSection["id"], key: string) {
  const row = sections
    .find((section) => section.id === sectionId)
    ?.rows.find((candidate) => candidate.key === key);
  if (!row) throw new Error(`no ${key} row in the ${sectionId} section`);
  return row;
}

describe("the trademarks and third-party notices page", () => {
  beforeAll(async () => {
    if (!i18n.isInitialized) {
      await i18n.init();
    }
  });

  it("opens from Settings at /settings/notices", () => {
    expect(isSettingsSectionSlug("notices")).toBe(true);
    expect(buildSettingsSectionRoute("notices")).toBe("/settings/notices");
  });

  it("is called 商標與第三方授權 in Traditional Chinese and Trademarks and third-party notices in English", () => {
    expect(i18n.t("woowtech.thirdPartyNotices.title", { lng: "zh-TW" })).toBe("商標與第三方授權");
    expect(i18n.t("woowtech.thirdPartyNotices.title", { lng: "en" })).toBe(
      "Trademarks and third-party notices",
    );
  });

  it("opens with the statement that woowtech smart is not affiliated with the owners", () => {
    const [english] = pageIn("en");
    expect(english).toMatchObject({ id: "trademarks", title: "Trademarks" });
    expect(english?.rows).toEqual([
      {
        key: "statement",
        title:
          "woowtech smart is not affiliated with, sponsored or endorsed by the companies or projects listed here. Their names and marks belong to their owners and appear only to identify the agents, editors, services and file types they stand for.",
        lines: [],
      },
    ]);
    const [chinese] = pageIn("zh-TW");
    expect(chinese).toMatchObject({ id: "trademarks", title: "商標" });
    expect(chinese?.rows[0]?.title).toBe(
      "渥屋智能與這裡列出的公司或專案沒有從屬關係，也沒有獲得它們的贊助或背書。這些名稱與標誌屬於各自的所有者，只用來標示它們代表的 Agent、編輯器、服務與檔案類型。",
    );
  });

  it("lists the 16 agents that show their own icon, each with its owner", () => {
    expect(
      Object.fromEntries(
        Object.entries(VENDOR_MARK_NOTICES).map(([vendor, notice]) => [
          vendor,
          `${notice.name} — ${notice.owner}`,
        ]),
      ),
    ).toEqual({
      agoragentic: "Agoragentic — Agoragentic",
      autohand: "Autohand Code — Autohand AI",
      "cortex-code": "Cortex Code — Snowflake Inc.",
      crow: "crow-cli — Thomas Wood",
      cursor: "Cursor — Anysphere, Inc.",
      dimcode: "DimCode — ArcShips (法至)",
      dirac: "Dirac — Dirac Delta Labs",
      "fast-agent": "fast-agent — evalstate",
      "gajae-code": "Gajae Code — Yeachan-Heo",
      grok: "Grok — SpaceXAI LLC",
      junie: "Junie — JetBrains s.r.o.",
      nova: "Nova — Compass AI",
      qoder: "Qoder CLI — Qoder (BRIGHT ZENITH PRIVATE LIMITED)",
      sigit: "siGit Code — PT Sigit Mitra Bangun",
      stakpak: "Stakpak — Stakpak",
      vtcode: "VT Code — Vinh Nguyen",
    });
  });

  // Stage 2 (woowtech/README.md section 25): the marks restored under their owners' rules, with the
  // trademark line each owner asks for, word for word, and JetBrains' link back to its site. VS
  // Code keeps its text badge, so the page does not list it.
  it("credits JetBrains and Zed in the words their brand rules ask for", () => {
    expect(VENDOR_MARK_NOTICES.junie).toEqual({
      name: "Junie",
      owner: "JetBrains s.r.o.",
      credit:
        "Copyright © 2026 JetBrains s.r.o. Junie and the Junie logo are trademarks of JetBrains s.r.o.",
      link: "https://www.jetbrains.com",
    });
    // Cursor and SpaceXAI ask for no credit line.
    expect(VENDOR_MARK_NOTICES.cursor).toEqual({ name: "Cursor", owner: "Anysphere, Inc." });
    expect(VENDOR_MARK_NOTICES.grok).toEqual({ name: "Grok", owner: "SpaceXAI LLC" });
    expect(EDITOR_MARK_NOTICES).toEqual({
      zed: {
        name: "Zed",
        owner: "Zed Industries, Inc.",
        credit: "The Zed name and logos are trademarks of Zed Industries, Inc.",
      },
    });
    expect(rowOf(pageIn("en"), "agents", "junie").lines).toEqual([
      "Owner: JetBrains s.r.o.",
      "Copyright © 2026 JetBrains s.r.o. Junie and the Junie logo are trademarks of JetBrains s.r.o.",
      "Website: https://www.jetbrains.com",
    ]);
    expect(rowOf(pageIn("zh-TW"), "agents", "junie").lines).toEqual([
      "所有者：JetBrains s.r.o.",
      "Copyright © 2026 JetBrains s.r.o. Junie and the Junie logo are trademarks of JetBrains s.r.o.",
      "網站：https://www.jetbrains.com",
    ]);
    expect(rowOf(pageIn("zh-TW"), "editors", "zed")).toEqual({
      key: "zed",
      title: "Zed",
      lines: [
        "所有者：Zed Industries, Inc.",
        "The Zed name and logos are trademarks of Zed Industries, Inc.",
      ],
    });
    // Zed, JetBrains and SpaceXAI forbid suggesting their endorsement; the page opens by saying
    // there is none.
    expect(rowOf(pageIn("en"), "trademarks", "statement").title).toContain(
      "is not affiliated with, sponsored or endorsed by",
    );
  });

  it("lists the forge marks still shown, with Forgejo's CC BY-SA 4.0 credit to Caesar Schinas", () => {
    expect(Object.keys(FORGE_MARK_NOTICES)).toEqual(["github", "gitea", "forgejo", "codeberg"]);
    expect(FORGE_MARK_NOTICES.github).toEqual({ name: "GitHub", owner: "GitHub, Inc." });
    // The credit is the one Forgejo asks for; what woowtech smart changed is a line of its own.
    expect(FORGE_MARK_NOTICES.forgejo).toEqual({
      name: "Forgejo",
      owner: "Forgejo",
      credit: "Forgejo logo by Caesar Schinas",
      changes: "singleColor",
      license: CC_BY_SA_4,
      source: "https://codeberg.org/forgejo/meta/src/branch/readme/branding",
    });
    expect(FORGE_MARK_NOTICES.codeberg).toMatchObject({
      owner: "Codeberg e.V.",
      credit: "Codeberg and the Codeberg Logo are trademarks of Codeberg e.V.",
    });
  });

  it("credits each file-type logo in the form its license or owner asks for", () => {
    const credits = Object.fromEntries(
      ["rust", "php", "r", "zig", "ruby", "html", "nix", "svg"].map((icon) => {
        const { credit, license, source } = fileTypeNotice(icon);
        return [icon, { credit, license, source }];
      }),
    );
    expect(credits).toEqual({
      rust: {
        credit: "Rust logo by the Rust Foundation",
        license: CC_BY_4,
        source: "https://github.com/rust-lang/rust-artwork",
      },
      php: {
        credit: "PHP logo by Colin Viebrock",
        license: CC_BY_SA_4,
        source: "https://www.php.net/download-logos.php",
      },
      r: {
        credit: "R logo © 2016 The R Foundation",
        license: CC_BY_SA_4,
        source: "https://www.r-project.org/logo/",
      },
      zig: {
        credit: "Zig logo by the Zig project",
        license: CC_BY_SA_4,
        source: "https://github.com/ziglang/logo",
      },
      ruby: {
        credit: "Ruby logo Copyright © 2006, Yukihiro Matsumoto",
        license: { name: "CC BY-SA 2.5", url: "https://creativecommons.org/licenses/by-sa/2.5/" },
        source: "https://www.ruby-lang.org/en/about/logo/",
      },
      html: {
        credit: "HTML5 Logo by W3C",
        license: { name: "CC BY 3.0", url: "https://creativecommons.org/licenses/by/3.0/" },
        source: "https://www.w3.org/html/logo/",
      },
      nix: {
        credit:
          "“NixOS Logo” by Simon Frankau, Tim Cuthbertson, and Daniel Baker (maintained by the NixOS Marketing Team), from nixos/branding",
        license: CC_BY_4,
        source: "https://github.com/NixOS/branding",
      },
      svg: {
        credit: "W3C SVG Logo",
        license: CC_BY_SA_4,
        source: "https://www.w3.org/2009/08/svg-logos.html",
      },
    });
    expect(fileTypeNotice("python").credit).toBe(
      "“Python” and the Python logos are trademarks or registered trademarks of the Python Software Foundation, used by woowtech smart with permission from the Foundation.",
    );
    // One React logo draws both the .jsx and the .tsx icon.
    expect(fileTypeNotice("react_ts")).toBe(fileTypeNotice("react"));
  });

  it("lists the 24 file-type logos still shown, and not the twelve that became the generic icon", () => {
    expect(FILE_TYPE_MARK_NOTICES.map((notice) => notice.name)).toEqual([
      "Apache Groovy",
      "Clojure",
      "CSS",
      "Erlang",
      "Haskell",
      "HTML5",
      "JavaScript",
      "Kotlin",
      "Markdown",
      "Nix",
      "OCaml",
      "PHP",
      "Python",
      "R",
      "React",
      "Ruby",
      "Rust",
      "Scala",
      "Svelte",
      "SVG",
      "TOML",
      "TypeScript",
      "WebAssembly",
      "Zig",
    ]);
  });

  it("carries material-icon-theme's copyright line and the MIT permission notice as its license says", () => {
    const license = readFileSync(
      createRequire(import.meta.url).resolve("material-icon-theme/LICENSE"),
      "utf8",
    );
    const [header, ...body] = license.split(/\n\s*\n/);
    const squeeze = (text: string) => text.replace(/\s+/g, " ").trim();

    expect(MIT_NOTICES[0]).toEqual({
      work: "material-icon-theme",
      copyright: ["Copyright (c) 2025 Material Extensions"],
      source: "https://github.com/material-extensions/vscode-material-icon-theme",
    });
    expect(header).toContain(MIT_NOTICES[0]?.copyright[0]);
    expect(squeeze(MIT_LICENSE_TEXT)).toBe(squeeze(body.join("\n\n")));
    expect(MIT_NOTICES.map((notice) => [notice.work, notice.logo === true])).toEqual([
      ["material-icon-theme", false],
      ["JS", true],
      ["TOML", true],
      ["Gitea", true],
    ]);
  });

  it("shows every agent, forge and file-type mark with its owner, credit, license and source", () => {
    const english = pageIn("en");
    expect(english.map((section) => section.id)).toEqual([
      "trademarks",
      "agents",
      "editors",
      "forges",
      "fileTypes",
      "mit",
    ]);
    expect(rowOf(english, "agents", "cortex-code")).toEqual({
      key: "cortex-code",
      title: "Cortex Code",
      lines: ["Owner: Snowflake Inc."],
    });
    expect(rowOf(english, "forges", "forgejo")).toEqual({
      key: "forgejo",
      title: "Forgejo",
      lines: [
        "Owner: Forgejo",
        "Forgejo logo by Caesar Schinas",
        "Changes: redrawn in a single color",
        "License: CC BY-SA 4.0 https://creativecommons.org/licenses/by-sa/4.0/",
        "Source: https://codeberg.org/forgejo/meta/src/branch/readme/branding",
      ],
    });
    expect(rowOf(english, "fileTypes", "haskell").lines).toContain("License: Public domain");
    expect(rowOf(english, "fileTypes", "rust")).toEqual({
      key: "rust",
      title: "Rust",
      lines: [
        "Owner: Rust Foundation",
        "Rust logo by the Rust Foundation",
        "License: CC BY 4.0 https://creativecommons.org/licenses/by/4.0/",
        "Source: https://github.com/rust-lang/rust-artwork",
      ],
    });
    // The file-type card says how the icons differ from the logos they are drawn from.
    expect(rowOf(english, "fileTypes", "changes")).toEqual({
      key: "changes",
      title: "Changes from the original logos",
      lines: [
        "material-icon-theme redrew these logos as file icons, and woowtech smart tones down their colors. Icons adapted from a logo under a Creative Commons ShareAlike license are shared under that same license.",
      ],
    });

    const agents = english.find((section) => section.id === "agents")?.rows ?? [];
    expect(agents.map((row) => row.key)).toEqual(Object.keys(VENDOR_MARK_NOTICES));
    const editors = english.find((section) => section.id === "editors")?.rows ?? [];
    expect(editors.map((row) => row.key)).toEqual(["zed"]);
    const fileTypes = english.find((section) => section.id === "fileTypes")?.rows ?? [];
    expect(fileTypes.map((row) => row.key)).toEqual([
      "changes",
      ...FILE_TYPE_MARK_NOTICES.map((notice) => notice.icons[0]),
    ]);
  });

  it("closes with the MIT License text and the copyright notice of each work under it", () => {
    const mit = pageIn("en").find((section) => section.id === "mit");
    expect(mit?.title).toBe("MIT License");
    expect(mit?.rows.map((row) => row.key)).toEqual([
      "material-icon-theme",
      "JS logo",
      "TOML logo",
      "Gitea logo",
      "text",
    ]);
    expect(rowOf(pageIn("en"), "mit", "Gitea logo").lines).toEqual([
      "Copyright (c) 2016 The Gitea Authors",
      "Copyright (c) 2015 The Gogs Authors",
      "Source: https://github.com/go-gitea/gitea",
    ]);
    expect(rowOf(pageIn("en"), "mit", "text")).toEqual({
      key: "text",
      title: "License text",
      lines: [MIT_LICENSE_TEXT],
    });
    expect(mit?.rows.map((row) => row.title)).toEqual([
      "material-icon-theme",
      "JS logo",
      "TOML logo",
      "Gitea logo",
      "License text",
    ]);
    expect(
      pageIn("zh-TW")
        .find((section) => section.id === "mit")
        ?.rows.map((row) => row.title),
    ).toEqual(["material-icon-theme", "JS 標誌", "TOML 標誌", "Gitea 標誌", "授權條文"]);
  });

  it("labels the lines in Traditional Chinese and keeps names, credits and license text as written", () => {
    const chinese = pageIn("zh-TW");
    expect(chinese.map((section) => section.title)).toEqual([
      "商標",
      "Agent",
      "編輯器",
      "Git 平台",
      "檔案類型圖示",
      "MIT 授權",
    ]);
    expect(rowOf(chinese, "fileTypes", "ruby")).toEqual({
      key: "ruby",
      title: "Ruby",
      lines: [
        "所有者：Yukihiro Matsumoto",
        "Ruby logo Copyright © 2006, Yukihiro Matsumoto",
        "授權：CC BY-SA 2.5 https://creativecommons.org/licenses/by-sa/2.5/",
        "來源：https://www.ruby-lang.org/en/about/logo/",
      ],
    });
    // Public domain is no license's name, so it reads in the page's language.
    expect(rowOf(chinese, "fileTypes", "haskell").lines).toEqual([
      "所有者：Haskell.org",
      "Thompson-Wheeler logo by Darrin A. Thompson and Jeffrey Wheeler",
      "授權：公眾領域",
      "來源：https://wiki.haskell.org/Thompson-Wheeler_logo",
    ]);
    expect(rowOf(chinese, "fileTypes", "markdown").lines).toContain("授權：公眾領域");
    // Forgejo's credit as Forgejo writes it; the change woowtech smart made, in Chinese.
    expect(rowOf(chinese, "forges", "forgejo").lines).toEqual([
      "所有者：Forgejo",
      "Forgejo logo by Caesar Schinas",
      "修改：重新繪製成單色",
      "授權：CC BY-SA 4.0 https://creativecommons.org/licenses/by-sa/4.0/",
      "來源：https://codeberg.org/forgejo/meta/src/branch/readme/branding",
    ]);
    expect(rowOf(chinese, "fileTypes", "changes")).toEqual({
      key: "changes",
      title: "與原始標誌的差異",
      lines: [
        "material-icon-theme 把這些標誌重新繪製成檔案圖示，渥屋智能再調淡它們的顏色。改作自創用 CC「相同方式分享」授權標誌的圖示，以同一授權分享。",
      ],
    });
    // What each section is for, in its header's info tooltip (docs/design.md section 7).
    expect(chinese.map((section) => [section.id, section.info])).toEqual([
      ["trademarks", undefined],
      [
        "agents",
        "以自己的圖示顯示的 Agent，圖示取自廠商或作者公開的版本。其他 Agent 顯示文字徽章。",
      ],
      ["editors", "顯示在桌面版選擇編輯器的選單。其他編輯器顯示文字徽章或通用圖示。"],
      [
        "forges",
        "顯示在開啟 Git 平台的連結旁。GitHub 與 Codeberg 只用黑色或白色顯示，GitLab 顯示文字徽章。",
      ],
      ["fileTypes", "檔案總管裡，代表這些程式語言與格式的檔案圖示。"],
      ["mit", "MIT 授權適用於下列每項作品，著作權聲明列在各項作品下。"],
    ]);
    expect(pageIn("en").map((section) => [section.id, section.info])).toEqual([
      ["trademarks", undefined],
      [
        "agents",
        "Agents shown with their own icon, as their makers publish it. Other agents show a text badge.",
      ],
      [
        "editors",
        "Shown in the desktop app's Choose editor menu. Other editors show a text badge or a generic icon.",
      ],
      [
        "forges",
        "Shown next to links that open a forge. GitHub and Codeberg draw in black or white, and GitLab shows a text badge.",
      ],
      [
        "fileTypes",
        "Icons for files written in these languages and formats, in the file explorer.",
      ],
      [
        "mit",
        "The MIT License applies to each work below, under the copyright notice listed with it.",
      ],
    ]);
  });

  it("shows no English of woowtech smart's own in Traditional Chinese, only what the owners write", () => {
    // Names, owners, credits, sources, license names and copyright lines stay as written.
    const asWritten = new Set<string>([MIT_LICENSE_TEXT]);
    const markNotices = [
      ...Object.values(VENDOR_MARK_NOTICES),
      ...Object.values(EDITOR_MARK_NOTICES),
      ...Object.values(FORGE_MARK_NOTICES),
      ...FILE_TYPE_MARK_NOTICES,
    ];
    for (const notice of markNotices) {
      for (const text of [notice.name, notice.owner, notice.credit, notice.source, notice.link]) {
        if (text) asWritten.add(text);
      }
      const license = notice.license;
      if (license && "name" in license) {
        asWritten.add(license.url ? `${license.name} ${license.url}` : license.name);
      }
    }
    for (const notice of MIT_NOTICES) {
      if (!notice.logo) asWritten.add(notice.work);
      for (const text of [...notice.copyright, notice.source]) asWritten.add(text);
    }
    // zh-TW keeps the word Agent in English across the app (woowtech/tools/zh-tw-untranslated.mjs).
    asWritten.add("Agent");
    const untranslated = textsIn("zh-TW")
      .map((text) => text.replace(/^(?:所有者|授權|來源|修改|網站)：/, ""))
      .filter((text) => !asWritten.has(text) && !/[㐀-鿿]/.test(text));
    expect(untranslated).toEqual([]);
  });
});
