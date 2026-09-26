import path from "node:path";

export type DesktopIconOptions = {
  isDevelopment: boolean;
  platform: NodeJS.Platform;
  developmentRoot: string;
  resourcesPath: string;
};

export function desktopIconPath(options: DesktopIconOptions): string {
  const variant = options.isDevelopment ? "dev" : "normal";
  const extension = options.platform === "win32" ? "ico" : "png";
  const publicRoot = options.isDevelopment
    ? path.join(options.developmentRoot, "public")
    : path.join(options.resourcesPath, "app", "public");

  return path.join(publicRoot, "spheres", `pal-server-${variant}.${extension}`);
}
