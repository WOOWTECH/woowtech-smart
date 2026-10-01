import path from "node:path";

// woowtech smart: notifications.ts used to resolve ../assets from dist/features, which is
// dist/assets and is never built, so Windows and Linux banners had no icon. Packaged apps
// read the icon.png that electron-builder.yml copies into resources for every platform.
export function notificationIconCandidates(input: {
  isPackaged: boolean;
  resourcesPath: string;
  /** The compiled features folder (`dist/features`), i.e. notifications.ts's `__dirname`. */
  moduleDir: string;
}): string[] {
  if (input.isPackaged) {
    return [path.join(input.resourcesPath, "icon.png")];
  }
  const assetsDir = path.resolve(input.moduleDir, "../../assets");
  return ["icon.png", "64x64.png", "128x128.png"].map((name) => path.join(assetsDir, name));
}
