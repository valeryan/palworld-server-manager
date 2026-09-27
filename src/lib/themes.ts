export const themes = [
  { id: "pal", name: "Pal", accent: "#31c4fe", trim: "#f4c542", image: "/spheres/psm-spheres-pal.png" },
  { id: "mega", name: "Mega", accent: "#62e978", trim: "#f4c542", image: "/spheres/psm-spheres-mega.png" },
  { id: "giga", name: "Giga", accent: "#fded59", trim: "#f4c542", image: "/spheres/psm-spheres-giga.png" },
  { id: "hyper", name: "Hyper", accent: "#ff5464", trim: "#f4c542", image: "/spheres/psm-spheres-hyper.png" },
  { id: "ultra", name: "Ultra", accent: "#ff96d3", trim: "#f4c542", image: "/spheres/psm-spheres-ultra.png" },
  { id: "legendary", name: "Legendary", accent: "#cd70ec", trim: "#f4c542", image: "/spheres/psm-spheres-legendary.png" },
  { id: "ultimate", name: "Ultimate", accent: "#8c4aff", trim: "#f4c542", image: "/spheres/psm-spheres-ultimate.png" },
  { id: "exotic", name: "Exotic", accent: "#43d3b5", trim: "#ede94b", image: "/spheres/psm-spheres-exotic.png" },
  { id: "sol", name: "Sol", accent: "#dceff7", trim: "#f4c542", image: "/spheres/psm-spheres-sol.png" },
  { id: "ancient", name: "Ancient", accent: "#95a1ae", trim: "#f4c542", image: "/spheres/psm-spheres-ancient.png" },
] as const;

export type ThemeId = (typeof themes)[number]["id"];
export const defaultTheme: ThemeId = "pal";
export const themeStorageKey = "psm-theme";
const themeIds = new Set<string>(themes.map((theme) => theme.id));

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && themeIds.has(value);
}
