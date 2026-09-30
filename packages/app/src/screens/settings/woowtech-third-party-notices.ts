import type { TFunction } from "i18next";

// woowtech smart: the Trademarks and third-party notices page (商標與第三方授權) in Settings,
// woowtech/README.md section 24. It lists every third-party mark the app shows, with its owner and
// the credit or license its owner asks for, and says woowtech smart is not affiliated with them.
//
// This file is the page's only data. woowtech/third-party-notices.test.mjs derives the marks that
// ship from woowtech/vendor-marks.mjs, the forge views and the file-type icon table, and fails
// until each has its entry here and no entry names a mark that does not ship. To show a vendor's
// own logo: set its show to "upstream" in vendor-marks.mjs, run the tool, and add its entry to
// VENDOR_MARK_NOTICES with what its brand rules ask for.
//
// Names, owners, credits and license texts are proper nouns or legal text and stay as their owners
// write them in every language; only the labels around them are translated.
//
// Sources: coord/reports/logo-usage-research.md (not in the repo) and the owners' own pages, read
// on 2026-09-30.

export interface NoticeLicense {
  /** The license's short name. */
  readonly name: string;
  /** Where its text is, when it has one to link to. */
  readonly url?: string;
}

export interface MarkNotice {
  /** The name the app shows next to the mark. */
  readonly name: string;
  /** Who the name and the mark belong to. */
  readonly owner: string;
  /** The attribution or trademark notice the mark's license or owner asks for, word for word. */
  readonly credit?: string;
  /** The license the drawing comes with. */
  readonly license?: NoticeLicense;
  /** Where the licensed drawing is published. */
  readonly source?: string;
}

export interface FileTypeMarkNotice extends MarkNotice {
  /** The icons in components/material-file-icons.ts that draw this mark. */
  readonly icons: readonly string[];
}

export interface MitNotice {
  readonly work: string;
  /** The work's copyright notices, as its license file writes them. */
  readonly copyright: readonly string[];
  readonly source: string;
}

const LICENSES = {
  ccBy3: { name: "CC BY 3.0", url: "https://creativecommons.org/licenses/by/3.0/" },
  ccBy4: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  ccBySa25: { name: "CC BY-SA 2.5", url: "https://creativecommons.org/licenses/by-sa/2.5/" },
  ccBySa4: { name: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" },
  cc0: { name: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
  mit: { name: "MIT License" },
  publicDomain: { name: "Public domain" },
  unlicense: { name: "The Unlicense", url: "https://unlicense.org/" },
} as const satisfies Record<string, NoticeLicense>;

/**
 * The agents that show their own logo, keyed as in woowtech/vendor-marks.mjs: the 13 whose
 * authors put their icon in the Agent Client Protocol registry (research §2.2). The research asks
 * for the registry's own file, the agent's name next to it and no suggestion of endorsement.
 */
export const VENDOR_MARK_NOTICES: Readonly<Record<string, MarkNotice>> = {
  agoragentic: { name: "Agoragentic", owner: "Agoragentic" },
  autohand: { name: "Autohand Code", owner: "Autohand AI" },
  "cortex-code": { name: "Cortex Code", owner: "Snowflake Inc." },
  crow: { name: "crow-cli", owner: "Thomas Wood" },
  dimcode: { name: "DimCode", owner: "ArcShips (法至)" },
  dirac: { name: "Dirac", owner: "Dirac Delta Labs" },
  "fast-agent": { name: "fast-agent", owner: "evalstate" },
  "gajae-code": { name: "Gajae Code", owner: "Yeachan-Heo" },
  nova: { name: "Nova", owner: "Compass AI" },
  qoder: { name: "Qoder CLI", owner: "Qoder (BRIGHT ZENITH PRIVATE LIMITED)" },
  sigit: { name: "siGit Code", owner: "PT Sigit Mitra Bangun" },
  stakpak: { name: "Stakpak", owner: "Stakpak" },
  vtcode: { name: "VT Code", owner: "Vinh Nguyen" },
};

/**
 * The git forges drawn with their own mark, by forge id (research §2.5). GitLab shows the text
 * badge, so it has no entry.
 */
export const FORGE_MARK_NOTICES: Readonly<Record<string, MarkNotice>> = {
  github: { name: "GitHub", owner: "GitHub, Inc." },
  gitea: {
    name: "Gitea",
    owner: "Gitea Ltd.",
    license: LICENSES.mit,
    source: "https://github.com/go-gitea/gitea",
  },
  forgejo: {
    name: "Forgejo",
    owner: "Forgejo",
    credit: "Forgejo logo by Caesar Schinas, redrawn in a single color",
    license: LICENSES.ccBySa4,
    source: "https://codeberg.org/forgejo/meta/src/branch/readme/branding",
  },
  codeberg: {
    name: "Codeberg",
    owner: "Codeberg e.V.",
    credit: "Codeberg and the Codeberg Logo are trademarks of Codeberg e.V.",
    license: LICENSES.cc0,
    source: "https://codeberg.org/Codeberg/Design",
  },
};

/**
 * The file-type icons that draw a language's or tool's logo (research §2.4), sorted by name.
 * material-icon-theme redrew each of them; the page says so above the list.
 */
export const FILE_TYPE_MARK_NOTICES: readonly FileTypeMarkNotice[] = [
  {
    icons: ["groovy"],
    name: "Apache Groovy",
    owner: "The Apache Software Foundation",
    credit:
      "Apache, Apache Groovy, Groovy, and the ASF logo are either registered trademarks or trademarks of The Apache Software Foundation.",
  },
  { icons: ["astro"], name: "Astro", owner: "Astro" },
  {
    icons: ["clojure"],
    name: "Clojure",
    owner: "Rich Hickey",
    credit: "Clojure logo by Tom Hickey",
  },
  {
    icons: ["css"],
    name: "CSS",
    owner: "CSS-Next Community Group",
    license: LICENSES.cc0,
    source: "https://github.com/CSS-Next/logo.css",
  },
  { icons: ["erlang"], name: "Erlang", owner: "Ericsson AB" },
  {
    icons: ["gradle"],
    name: "Gradle",
    owner: "Gradle, Inc.",
    credit: "Gradle® and the Gradlephant logo are registered trademarks of Gradle, Inc.",
  },
  {
    icons: ["graphql"],
    name: "GraphQL",
    owner: "GraphQL Foundation",
    credit: "“GraphQL” is a trademark managed by the GraphQL Foundation.",
  },
  {
    icons: ["haskell"],
    name: "Haskell",
    owner: "Haskell.org",
    credit: "Thompson-Wheeler logo by Darrin A. Thompson and Jeffrey Wheeler",
    license: LICENSES.publicDomain,
    source: "https://wiki.haskell.org/Thompson-Wheeler_logo",
  },
  {
    icons: ["html"],
    name: "HTML5",
    owner: "W3C",
    credit: "HTML5 Logo by W3C",
    license: LICENSES.ccBy3,
    source: "https://www.w3.org/html/logo/",
  },
  {
    icons: ["javascript"],
    name: "JavaScript",
    owner: "Christopher Williams",
    license: LICENSES.mit,
    source: "https://github.com/voodootikigod/logo.js",
  },
  {
    icons: ["kotlin"],
    name: "Kotlin",
    owner: "Kotlin Foundation",
    credit: "Kotlin® is a registered trademark of the Kotlin Foundation.",
  },
  {
    icons: ["lua"],
    name: "Lua",
    owner: "Lua.org, PUC-Rio",
    credit: "Copyright © 1998 Lua.org. Graphic design by Alexandre Nakonechnyj.",
    source: "https://www.lua.org/images/",
  },
  {
    icons: ["markdown"],
    name: "Markdown",
    owner: "Dustin Curtis",
    credit: "Markdown Mark by Dustin Curtis",
    license: LICENSES.publicDomain,
    source: "https://github.com/dcurtis/markdown-mark",
  },
  {
    icons: ["nix"],
    name: "Nix",
    owner: "NixOS project",
    credit:
      "“NixOS Logo” by Simon Frankau, Tim Cuthbertson, and Daniel Baker (maintained by the NixOS Marketing Team), from nixos/branding",
    license: LICENSES.ccBy4,
    source: "https://github.com/NixOS/branding",
  },
  {
    icons: ["ocaml"],
    name: "OCaml",
    owner: "Inria",
    license: LICENSES.unlicense,
    source: "https://github.com/ocaml/ocaml-logo",
  },
  {
    icons: ["php"],
    name: "PHP",
    owner: "The PHP Group",
    credit: "PHP logo by Colin Viebrock",
    license: LICENSES.ccBySa4,
    source: "https://www.php.net/download-logos.php",
  },
  {
    icons: ["python"],
    name: "Python",
    owner: "Python Software Foundation",
    credit:
      "“Python” and the Python logos are trademarks or registered trademarks of the Python Software Foundation, used by woowtech smart with permission from the Foundation.",
  },
  {
    icons: ["r"],
    name: "R",
    owner: "The R Foundation",
    credit: "R logo © 2016 The R Foundation",
    license: LICENSES.ccBySa4,
    source: "https://www.r-project.org/logo/",
  },
  { icons: ["react", "react_ts"], name: "React", owner: "Meta Platforms, Inc." },
  {
    icons: ["ruby"],
    name: "Ruby",
    owner: "Yukihiro Matsumoto",
    credit: "Ruby logo Copyright © 2006, Yukihiro Matsumoto",
    license: LICENSES.ccBySa25,
    source: "https://www.ruby-lang.org/en/about/logo/",
  },
  {
    icons: ["rust"],
    name: "Rust",
    owner: "Rust Foundation",
    credit: "Rust logo by the Rust Foundation",
    license: LICENSES.ccBy4,
    source: "https://github.com/rust-lang/rust-artwork",
  },
  { icons: ["scala"], name: "Scala", owner: "EPFL" },
  { icons: ["svelte"], name: "Svelte", owner: "Svelte project" },
  {
    icons: ["svg"],
    name: "SVG",
    owner: "W3C",
    credit: "W3C SVG Logo",
    license: LICENSES.ccBySa4,
    source: "https://www.w3.org/2009/08/svg-logos.html",
  },
  {
    icons: ["toml"],
    name: "TOML",
    owner: "Tom Preston-Werner",
    license: LICENSES.mit,
    source: "https://github.com/toml-lang/toml",
  },
  { icons: ["typescript"], name: "TypeScript", owner: "Microsoft Corporation" },
  {
    icons: ["webassembly"],
    name: "WebAssembly",
    owner: "WebAssembly Community Group",
    credit: "WebAssembly logo by Carlos Baraza",
    license: LICENSES.cc0,
    source: "https://github.com/carlosbaraza/web-assembly-logo",
  },
  {
    icons: ["zig"],
    name: "Zig",
    owner: "Zig Software Foundation",
    credit: "Zig logo by the Zig project",
    license: LICENSES.ccBySa4,
    source: "https://github.com/ziglang/logo",
  },
];

/**
 * The file-type icons that draw no third-party mark: letters, braces and plain symbols that
 * material-icon-theme drew itself (research §2.4, group A generic). The icon set's MIT notice
 * covers them.
 */
export const GENERIC_FILE_ICONS: readonly string[] = [
  "_default",
  "c",
  "console",
  "cpp",
  "csharp",
  "database",
  "document",
  "h",
  "hpp",
  "image",
  "java",
  "json",
  "less",
  "lock",
  "settings",
  "xml",
  "yaml",
];

/** The works the app includes under the MIT License, whose license asks for these notices. */
export const MIT_NOTICES: readonly MitNotice[] = [
  {
    work: "material-icon-theme",
    copyright: ["Copyright (c) 2025 Material Extensions"],
    source: "https://github.com/material-extensions/vscode-material-icon-theme",
  },
  {
    work: "JS logo",
    copyright: ["Copyright (c) 2011 Christopher Williams <chris@iterativedesigns.com>"],
    source: "https://github.com/voodootikigod/logo.js",
  },
  {
    work: "TOML logo",
    copyright: ["Copyright (c) Tom Preston-Werner"],
    source: "https://github.com/toml-lang/toml",
  },
  {
    work: "Gitea logo",
    copyright: ["Copyright (c) 2016 The Gitea Authors", "Copyright (c) 2015 The Gogs Authors"],
    source: "https://github.com/go-gitea/gitea",
  },
];

/** The MIT License's permission notice, as material-icon-theme's LICENSE writes it. */
export const MIT_LICENSE_TEXT = [
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
  "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.",
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
].join("\n\n");

export interface NoticeRow {
  readonly key: string;
  readonly title: string;
  readonly lines: readonly string[];
}

export interface NoticeSection {
  readonly id: "trademarks" | "agents" | "forges" | "fileTypes" | "mit";
  readonly title: string;
  /** What the section is for, for its header's info tooltip. */
  readonly info?: string;
  readonly rows: readonly NoticeRow[];
}

const COPY = "woowtech.thirdPartyNotices";

function noticeLines(notice: MarkNotice, t: TFunction): string[] {
  const license = notice.license;
  return [
    t(`${COPY}.owner`, { owner: notice.owner }),
    ...(notice.credit ? [notice.credit] : []),
    ...(license
      ? [
          t(`${COPY}.license`, {
            license: license.url ? `${license.name} ${license.url}` : license.name,
          }),
        ]
      : []),
    ...(notice.source ? [t(`${COPY}.source`, { source: notice.source })] : []),
  ];
}

function markRows(notices: Readonly<Record<string, MarkNotice>>, t: TFunction): NoticeRow[] {
  return Object.entries(notices).map(([key, notice]) => ({
    key,
    title: notice.name,
    lines: noticeLines(notice, t),
  }));
}

/** Everything the page shows, in `t`'s language, section by section and row by row. */
export function buildThirdPartyNotices(t: TFunction): NoticeSection[] {
  return [
    {
      id: "trademarks",
      title: t(`${COPY}.sections.trademarks`),
      rows: [{ key: "statement", title: t(`${COPY}.statement`), lines: [] }],
    },
    {
      id: "agents",
      title: t(`${COPY}.sections.agents`),
      info: t(`${COPY}.sections.agentsInfo`),
      rows: markRows(VENDOR_MARK_NOTICES, t),
    },
    {
      id: "forges",
      title: t(`${COPY}.sections.forges`),
      info: t(`${COPY}.sections.forgesInfo`),
      rows: markRows(FORGE_MARK_NOTICES, t),
    },
    {
      id: "fileTypes",
      title: t(`${COPY}.sections.fileTypes`),
      info: t(`${COPY}.sections.fileTypesInfo`),
      rows: [
        {
          key: "changes",
          title: t(`${COPY}.sections.fileTypesChangesTitle`),
          lines: [t(`${COPY}.sections.fileTypesChanges`)],
        },
        ...FILE_TYPE_MARK_NOTICES.map((notice) => ({
          key: notice.icons[0] ?? notice.name,
          title: notice.name,
          lines: noticeLines(notice, t),
        })),
      ],
    },
    {
      id: "mit",
      title: t(`${COPY}.sections.mit`),
      info: t(`${COPY}.sections.mitInfo`),
      rows: [
        ...MIT_NOTICES.map((notice) => ({
          key: notice.work,
          title: notice.work,
          lines: notice.copyright.concat(t(`${COPY}.source`, { source: notice.source })),
        })),
        { key: "text", title: t(`${COPY}.sections.mitTextTitle`), lines: [MIT_LICENSE_TEXT] },
      ],
    },
  ];
}
