import path from "node:path";

// woowtech smart: notifications.ts used to resolve ../assets from dist/features, which is
// dist/assets and is never built, so Windows and Linux banners had no icon. Packaged apps
// read the icon.png that electron-builder.yml copies into resources for every platform.
// macOS banners already show the app icon; an explicit icon is drawn again as the banner's content
// image, so macOS gets none and keeps its pre-fix look.
export function notificationIconCandidates(input: {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  resourcesPath: string;
  /** The compiled features folder (`dist/features`), i.e. notifications.ts's `__dirname`. */
  moduleDir: string;
}): string[] {
  if (input.platform === "darwin") {
    return [];
  }
  if (input.isPackaged) {
    return [path.join(input.resourcesPath, "icon.png")];
  }
  const assetsDir = path.resolve(input.moduleDir, "../../assets");
  return ["icon.png", "64x64.png", "128x128.png"].map((name) => path.join(assetsDir, name));
}
