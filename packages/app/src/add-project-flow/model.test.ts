import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import {
  backAddProjectPage,
  chooseAddProjectHost,
  currentAddProjectPage,
  moveAddProjectActiveIndex,
  moveAddProjectSelection,
  openAddProjectFlow,
  openDirectorySearchPage,
  openGithubLocationPage,
  openNewDirectoryNamePage,
  openNewDirectoryParentPage,
  setAddProjectActiveIndex,
  setAddProjectPageInput,
  setNewDirectoryName,
  type AddProjectHost,
} from "./model";
import {
  addProjectMethodEmptyText,
  buildAddProjectMethods,
  buildCloneLocationOptions,
  buildManualGithubRepositoryChoices,
} from "./options";

const HOST: AddProjectHost = {
  serverId: "host-1",
  label: "Local",
  canAddProject: true,
  canBrowse: true,
  canCloneGithubRepositories: true,
  canSearchGithubRepositories: true,
  canCreateDirectory: true,
};

describe("Add Project navigation", () => {
  it("skips a single connected host without adding it to history", () => {
    const state = openAddProjectFlow({ hosts: [HOST] });

    expect(currentAddProjectPage(state)).toEqual({
      kind: "method",
      hostId: "host-1",
      activeIndex: 0,
      error: null,
      isSubmitting: false,
    });
    expect(backAddProjectPage(state)).toBeNull();
  });

  it("restores page input and selection after Back", () => {
    const secondHost = { ...HOST, serverId: "host-2", label: "Remote" };
    let state = openAddProjectFlow({ hosts: [HOST, secondHost] });
    state = setAddProjectPageInput(state, "rem");
    state = setAddProjectActiveIndex(state, 1);
    state = chooseAddProjectHost(state, secondHost.serverId);
    state = openDirectorySearchPage(state, secondHost.serverId);

    state = backAddProjectPage(state) ?? state;
    state = backAddProjectPage(state) ?? state;

    expect(currentAddProjectPage(state)).toEqual({
      kind: "host",
      query: "rem",
      activeIndex: 1,
      error: null,
    });
  });

  it("wraps keyboard selection in both directions", () => {
    expect(moveAddProjectActiveIndex(2, 3, "next")).toBe(0);
    expect(moveAddProjectActiveIndex(0, 3, "previous")).toBe(2);
    expect(moveAddProjectSelection(0, [true, false, true], "next")).toBe(2);
  });

  it("restores a directory name after returning to and reselecting its parent", () => {
    let state = openAddProjectFlow({ hosts: [HOST] });
    state = openNewDirectoryParentPage(state, HOST.serverId);
    state = openNewDirectoryNamePage(state, HOST.serverId, "~/dev");
    state = setNewDirectoryName(state, "command-center");
    state = backAddProjectPage(state) ?? state;
    state = openNewDirectoryNamePage(state, HOST.serverId, "~/dev");

    expect(currentAddProjectPage(state)).toMatchObject({
      kind: "new-directory-name",
      parentPath: "~/dev",
      name: "command-center",
    });
  });

  it("restores the GitHub destination query and active parent when reopening a repository", () => {
    const repository = {
      id: "repo-1",
      nameWithOwner: "getpaseo/paseo",
      cloneUrl: "git@github.com:getpaseo/paseo.git",
      description: null,
      visibility: "public",
      updatedAt: null,
    };
    let state = openAddProjectFlow({ hosts: [HOST] });
    state = openGithubLocationPage(state, HOST.serverId, repository);
    state = setAddProjectPageInput(state, "~/dev");
    state = setAddProjectActiveIndex(state, 2);
    state = backAddProjectPage(state) ?? state;
    state = openGithubLocationPage(state, HOST.serverId, repository);

    expect(currentAddProjectPage(state)).toMatchObject({
      kind: "github-location",
      query: "~/dev",
      activeIndex: 2,
    });
  });
});

describe("Add Project options", () => {
  it("hides every mutating method when the host lacks stable project identity", () => {
    const outdatedHost = { ...HOST, canAddProject: false };

    expect(buildAddProjectMethods(outdatedHost)).toEqual([]);
    expect(addProjectMethodEmptyText(outdatedHost)).toBe("Update the host to use Add Project.");
  });

  it("keeps host-upgrade methods discoverable while hiding local-only Browse", () => {
    expect(
      buildAddProjectMethods({
        ...HOST,
        canBrowse: false,
        canCloneGithubRepositories: false,
        canSearchGithubRepositories: false,
        canCreateDirectory: false,
      }),
    ).toEqual([
      {
        id: "directory-search",
        label: "Search for directory",
        description: "Find a directory on Local",
      },
      {
        id: "github",
        label: "Clone from GitHub",
        description: "Update this host to clone GitHub repositories",
        disabled: true,
      },
      {
        id: "new-directory",
        label: "New directory",
        description: "Update this host to create directories",
        disabled: true,
      },
    ]);
  });

  it("offers manual URL and protocol-specific owner/repo clone choices", () => {
    expect(buildManualGithubRepositoryChoices("git@github.com:getpaseo/paseo.git")).toEqual([
      expect.objectContaining({
        id: "manual:git@github.com:getpaseo/paseo.git",
        nameWithOwner: "getpaseo/paseo",
        cloneUrl: "git@github.com:getpaseo/paseo.git",
      }),
    ]);
    expect(buildManualGithubRepositoryChoices("getpaseo/paseo")).toEqual([
      expect.objectContaining({ cloneProtocol: "https", cloneUrl: "getpaseo/paseo" }),
      expect.objectContaining({ cloneProtocol: "ssh", cloneUrl: "getpaseo/paseo" }),
    ]);
    expect(buildManualGithubRepositoryChoices("paseo")).toEqual([]);
  });

  it("shows final clone paths while retaining parent paths as values", () => {
    expect(
      buildCloneLocationOptions({
        parents: ["~/dev", "~/workspace"],
        repositoryName: "paseo",
        existingPaths: ["~/workspace/paseo"],
      }),
    ).toEqual([
      {
        id: "~/dev",
        path: "~/dev",
        displayPath: "~/dev/paseo",
        secondaryText: "Parent directory: ~/dev",
        disabled: false,
      },
      {
        id: "~/workspace",
        path: "~/workspace",
        displayPath: "~/workspace/paseo",
        secondaryText: "Already exists",
        disabled: true,
      },
    ]);
  });

  it("shows equivalent absolute-home and tilde destinations only once", () => {
    expect(
      buildCloneLocationOptions({
        parents: ["/Users/moboudra/dev", "~/dev"],
        repositoryName: "dotfiles",
        existingPaths: [],
      }),
    ).toEqual([
      {
        id: "/Users/moboudra/dev",
        path: "/Users/moboudra/dev",
        displayPath: "/Users/moboudra/dev/dotfiles",
        secondaryText: "Parent directory: /Users/moboudra/dev",
        disabled: false,
      },
    ]);
  });
});

it("translates add-project choices at call time without translating host names or paths", async () => {
  const host = { ...HOST, label: "Host Alice 的 Mac" };
  await i18n.changeLanguage("zh-TW");
  try {
    expect(buildAddProjectMethods(host)).toEqual([
      {
        id: "directory-search",
        label: "搜尋資料夾",
        description: "在 Host Alice 的 Mac 上尋找資料夾",
      },
      { id: "browse", label: "瀏覽", description: "在 Finder 中選擇或建立資料夾" },
      {
        id: "github",
        label: "從 GitHub 複製專案",
        description: "搜尋你的 GitHub 帳號可存取的專案",
        disabled: false,
      },
      {
        id: "new-directory",
        label: "新增資料夾",
        description: "在 Host Alice 的 Mac 上建立空白資料夾",
        disabled: false,
      },
    ]);
    expect(addProjectMethodEmptyText({ ...host, canAddProject: false })).toBe(
      "請更新主機以使用新增專案功能",
    );
    expect(addProjectMethodEmptyText(host)).toBe("找不到符合的項目");
    expect(
      buildAddProjectMethods({
        ...host,
        canCloneGithubRepositories: false,
        canCreateDirectory: false,
      }).slice(2),
    ).toEqual([
      {
        id: "github",
        label: "從 GitHub 複製專案",
        description: "請更新此主機以複製 GitHub 儲存庫",
        disabled: true,
      },
      {
        id: "new-directory",
        label: "新增資料夾",
        description: "請更新此主機以建立資料夾",
        disabled: true,
      },
    ]);
    expect(
      buildAddProjectMethods({ ...host, canSearchGithubRepositories: false })[2].description,
    ).toBe("輸入 GitHub 網址或 owner/repo");
    expect(
      buildCloneLocationOptions({
        parents: ["/Users/Host/dev", "/Users/Host/src"],
        repositoryName: "Agent",
        existingPaths: ["/Users/Host/src/Agent"],
      }),
    ).toEqual([
      {
        id: "/Users/Host/dev",
        path: "/Users/Host/dev",
        displayPath: "/Users/Host/dev/Agent",
        secondaryText: "上層資料夾：/Users/Host/dev",
        disabled: false,
      },
      {
        id: "/Users/Host/src",
        path: "/Users/Host/src",
        displayPath: "/Users/Host/src/Agent",
        secondaryText: "已存在",
        disabled: true,
      },
    ]);
    expect(buildManualGithubRepositoryChoices("Host/Agent")).toEqual([
      {
        id: "manual:https:Host/Agent",
        nameWithOwner: "Host/Agent",
        cloneUrl: "Host/Agent",
        cloneProtocol: "https",
        description: "透過 HTTPS 複製 owner/repo 的專案",
        updatedAt: null,
      },
      {
        id: "manual:ssh:Host/Agent",
        nameWithOwner: "Host/Agent",
        cloneUrl: "Host/Agent",
        cloneProtocol: "ssh",
        description: "透過 SSH 複製 owner/repo 的專案",
        updatedAt: null,
      },
    ]);
    const url = "https://github.com/Host/Agent.git";
    expect(buildManualGithubRepositoryChoices(url)[0]).toMatchObject({
      cloneUrl: url,
      description: "複製此儲存庫網址的專案",
    });
    await i18n.changeLanguage("en");
    expect(buildAddProjectMethods(host).map(({ label }) => label)).toEqual([
      "Search for directory",
      "Browse",
      "Clone from GitHub",
      "New directory",
    ]);
  } finally {
    await i18n.changeLanguage("en");
  }
});
