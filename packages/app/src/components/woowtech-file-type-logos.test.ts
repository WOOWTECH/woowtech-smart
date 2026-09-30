import { describe, expect, it } from "vitest";
import { getFileIconSvg } from "./file-icon-svg";
import { getRawFileIconSvg } from "./material-file-icons";

// woowtech smart: on 2026-09-30 the owner replaced eight file-type logos with the generic file
// icon. Go, Swift, Terraform and HCL (HashiCorp), Vue and Sass ask for permission or allow no
// commercial use, and Dart and Elixir forbid the colour changes the file tree makes
// (woowtech/README.md section 24). The stage 1 review found four more whose owners' own words put
// them in the same group: Astro and Gradle forbid the colour change, Lua allows no change except
// to its orbiting text, and GraphQL and Gradle ask for permission first. Until their owners agree
// they show the generic icon too. The other 42 icons stay.

const GENERIC_FILE_ICON = getRawFileIconSvg("README");

const REPLACED_LOGO_FILES = [
  "main.go",
  "App.swift",
  "main.tf",
  "config.hcl",
  "App.vue",
  "theme.scss",
  "main.dart",
  "server.ex",
  "server_test.exs",
  "page.astro",
  "build.gradle",
  "schema.graphql",
  "query.gql",
  "init.lua",
];

// One file for each icon that stays, besides the generic one.
const KEPT_ICON_FILES = {
  c: "main.c",
  clojure: "core.clj",
  console: "build.sh",
  cpp: "main.cpp",
  csharp: "Program.cs",
  css: "style.css",
  database: "schema.sql",
  document: "notes.txt",
  erlang: "server.erl",
  groovy: "Jenkins.groovy",
  h: "main.h",
  haskell: "Main.hs",
  hpp: "main.hpp",
  html: "index.html",
  image: "logo.png",
  java: "Main.java",
  javascript: "index.js",
  json: "package.json",
  kotlin: "Main.kt",
  less: "theme.less",
  lock: "yarn.lock",
  markdown: "README.md",
  nix: "flake.nix",
  ocaml: "main.ml",
  php: "index.php",
  python: "main.py",
  r: "analysis.r",
  react: "App.jsx",
  react_ts: "App.tsx",
  ruby: "app.rb",
  rust: "main.rs",
  scala: "Main.scala",
  settings: "app.ini",
  svelte: "App.svelte",
  svg: "icon.svg",
  toml: "Cargo.toml",
  typescript: "index.ts",
  webassembly: "module.wasm",
  xml: "pom.xml",
  yaml: "config.yaml",
  zig: "main.zig",
};

describe("file type icons", () => {
  it("show the generic file icon for Go, Swift, Terraform, HCL, Vue, Sass, Dart, Elixir, Astro, Gradle, GraphQL and Lua files", () => {
    expect(
      REPLACED_LOGO_FILES.filter((file) => getRawFileIconSvg(file) !== GENERIC_FILE_ICON),
    ).toEqual([]);
    expect(getFileIconSvg("main.go")).toBe(getFileIconSvg("README"));
    expect(getFileIconSvg("init.lua")).toBe(getFileIconSvg("README"));
  });

  it("keep the other 42 icons, each its own drawing", () => {
    const drawings = Object.values(KEPT_ICON_FILES).map((file) => getRawFileIconSvg(file));
    expect(drawings.filter((svg) => svg === GENERIC_FILE_ICON)).toEqual([]);
    expect(new Set([...drawings, GENERIC_FILE_ICON]).size).toBe(42);
  });
});
