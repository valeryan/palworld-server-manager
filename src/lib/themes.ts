export type ThemeMode = "dark" | "light";

export type ThemePalette = {
  mode: ThemeMode;
  canvas: string;
  sidebar: string;
  surface: string;
  raised: string;
  inset: string;
  control: string;
  border: string;
  borderStrong: string;
  text: string;
  muted: string;
  subtle: string;
  accent: string;
  accentInk: string;
  codeBackground: string;
  codeText: string;
  shadow: string;
  overlay: string;
};

export type ThemeDefinition = {
  id: string;
  name: string;
  sphereAccent: string;
  sphereCore: readonly [string, string, string];
  trim: string;
  image: string;
  palette: ThemePalette;
};

export const themes = [
  { id: "pal", name: "Pal", sphereAccent: "#31c4fe", sphereCore: ["#31c4fe", "#31c4fe", "#31c4fe"], trim: "#f4c542", image: "/spheres/psm-spheres-pal.png", palette: { mode: "dark", canvas: "#050a17", sidebar: "#07101e", surface: "#0c1625", raised: "#122136", inset: "#07111d", control: "#162842", border: "#223a53", borderStrong: "#52799c", text: "#eaf8ff", muted: "#8da9bc", subtle: "#6f899c", accent: "#31c4fe", accentInk: "#06121b", codeBackground: "#020711", codeText: "#cceeff", shadow: "#000814a8", overlay: "#02050bcc" } },
  { id: "mega", name: "Mega", sphereAccent: "#62e978", sphereCore: ["#62e978", "#62e978", "#62e978"], trim: "#f4c542", image: "/spheres/psm-spheres-mega.png", palette: { mode: "dark", canvas: "#06110d", sidebar: "#091812", surface: "#0e2119", raised: "#153026", inset: "#081710", control: "#18352b", border: "#294a3b", borderStrong: "#527966", text: "#edfff2", muted: "#91b5a0", subtle: "#6f927f", accent: "#62e978", accentInk: "#06130b", codeBackground: "#030b08", codeText: "#cef8da", shadow: "#001008a8", overlay: "#020905cc" } },
  { id: "giga", name: "Giga", sphereAccent: "#fded59", sphereCore: ["#fded59", "#fded59", "#fded59"], trim: "#f4c542", image: "/spheres/psm-spheres-giga.png", palette: { mode: "light", canvas: "#f5f1d8", sidebar: "#e9e2bc", surface: "#fffbe8", raised: "#f2ebc8", inset: "#fffef5", control: "#ece3b2", border: "#c9be7d", borderStrong: "#897c32", text: "#292713", muted: "#706b40", subtle: "#888158", accent: "#806b00", accentInk: "#fffce5", codeBackground: "#272512", codeText: "#fffbdc", shadow: "#50481133", overlay: "#302d1766" } },
  { id: "hyper", name: "Hyper", sphereAccent: "#ff5464", sphereCore: ["#ff5464", "#ff5464", "#ff5464"], trim: "#f4c542", image: "/spheres/psm-spheres-hyper.png", palette: { mode: "dark", canvas: "#15070b", sidebar: "#1c0b11", surface: "#241018", raised: "#321620", inset: "#12070b", control: "#391a25", border: "#542431", borderStrong: "#985064", text: "#ffecef", muted: "#c49aa3", subtle: "#9b737c", accent: "#ff6675", accentInk: "#1a0508", codeBackground: "#0d0407", codeText: "#ffd9df", shadow: "#160006b3", overlay: "#100307d1" } },
  { id: "ultra", name: "Ultra", sphereAccent: "#ff96d3", sphereCore: ["#ff96d3", "#ff96d3", "#ff96d3"], trim: "#f4c542", image: "/spheres/psm-spheres-ultra.png", palette: { mode: "dark", canvas: "#160a14", sidebar: "#1f0d1c", surface: "#291226", raised: "#391832", inset: "#140812", control: "#401c39", border: "#572449", borderStrong: "#984779", text: "#ffeffa", muted: "#c5a0ba", subtle: "#9d7892", accent: "#ff96d3", accentInk: "#210a19", codeBackground: "#0e060d", codeText: "#ffe0f3", shadow: "#160012b3", overlay: "#10020ed1" } },
  { id: "legendary", name: "Legendary", sphereAccent: "#cd70ec", sphereCore: ["#cd70ec", "#cd70ec", "#cd70ec"], trim: "#f4c542", image: "/spheres/psm-spheres-legendary.png", palette: { mode: "dark", canvas: "#100a19", sidebar: "#160e22", surface: "#1d142b", raised: "#291c3a", inset: "#0f0918", control: "#302044", border: "#423159", borderStrong: "#765d92", text: "#f7edff", muted: "#b7a1c9", subtle: "#8e78a1", accent: "#cd70ec", accentInk: "#1b0922", codeBackground: "#09050f", codeText: "#ead8f8", shadow: "#090011b3", overlay: "#08030ed1" } },
  { id: "ultimate", name: "Ultimate", sphereAccent: "#8c4aff", sphereCore: ["#8c4aff", "#8c4aff", "#8c4aff"], trim: "#f4c542", image: "/spheres/psm-spheres-ultimate.png", palette: { mode: "dark", canvas: "#09091a", sidebar: "#0d0d25", surface: "#13132f", raised: "#1d1d43", inset: "#080817", control: "#242450", border: "#30305c", borderStrong: "#6464a2", text: "#f0f0ff", muted: "#a3a3cc", subtle: "#7d7daa", accent: "#9b63ff", accentInk: "#100822", codeBackground: "#050510", codeText: "#ddddff", shadow: "#000015b8", overlay: "#050510d6" } },
  { id: "exotic", name: "Exotic", sphereAccent: "#43d3b5", sphereCore: ["#42f35e", "#43d3b5", "#57b0f8"], trim: "#ede94b", image: "/spheres/psm-spheres-exotic.png", palette: { mode: "dark", canvas: "#061312", sidebar: "#081b19", surface: "#0d2522", raised: "#12352f", inset: "#061714", control: "#163d36", border: "#245249", borderStrong: "#347266", text: "#edfffa", muted: "#93bdb4", subtle: "#6f978f", accent: "#43d3b5", accentInk: "#061512", codeBackground: "#020c0a", codeText: "#d6fff5", shadow: "#00110db3", overlay: "#020b09d1" } },
  { id: "sol", name: "Sol", sphereAccent: "#dceff7", sphereCore: ["#dceff7", "#dceff7", "#dceff7"], trim: "#f4c542", image: "/spheres/psm-spheres-sol.png", palette: { mode: "light", canvas: "#edf5f8", sidebar: "#dfebf0", surface: "#fafdfe", raised: "#e8f2f6", inset: "#ffffff", control: "#dbe9ef", border: "#b7cdd6", borderStrong: "#698995", text: "#14232c", muted: "#5e7682", subtle: "#758b95", accent: "#24738e", accentInk: "#f6fcfe", codeBackground: "#15232b", codeText: "#e7f5fa", shadow: "#23404d2e", overlay: "#152a3461" } },
  { id: "ancient", name: "Ancient", sphereAccent: "#95a1ae", sphereCore: ["#95a1ae", "#95a1ae", "#95a1ae"], trim: "#f4c542", image: "/spheres/psm-spheres-ancient.png", palette: { mode: "dark", canvas: "#303840", sidebar: "#2a3138", surface: "#3b454e", raised: "#46525d", inset: "#252c32", control: "#4b5762", border: "#5b6873", borderStrong: "#8c99a4", text: "#f1f4f6", muted: "#c2cbd2", subtle: "#a2adb6", accent: "#b5c3cf", accentInk: "#182027", codeBackground: "#171c21", codeText: "#e3e9ed", shadow: "#10161c8f", overlay: "#11171db8" } },
] as const satisfies readonly ThemeDefinition[];

export type ThemeId = (typeof themes)[number]["id"];
export const defaultTheme: ThemeId = "pal";
const themeIds = new Set<string>(themes.map((theme) => theme.id));

export const semanticPalettes = {
  dark: { success: "#46d38a", successText: "#8df0ba", warning: "#f4c542", warningText: "#ffc477", danger: "#ff6677", dangerText: "#ff9aa5" },
  light: { success: "#197047", successText: "#15633e", warning: "#826c00", warningText: "#6d5800", danger: "#b63548", dangerText: "#9f2638" },
} as const;

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && themeIds.has(value);
}

export function themeStyleSheet(): string {
  return themes.map((theme) => {
    const palette = theme.palette;
    const semantic = semanticPalettes[palette.mode];
    return `:root:root[data-theme="${theme.id}"]{color-scheme:${palette.mode};--bg:${palette.canvas};--sidebar:${palette.sidebar};--panel:${palette.surface};--panel2:${palette.raised};--inset:${palette.inset};--control:${palette.control};--line:${palette.border};--line-strong:${palette.borderStrong};--text:${palette.text};--muted:${palette.muted};--subtle:${palette.subtle};--brand:${palette.accent};--brand-ink:${palette.accentInk};--code-bg:${palette.codeBackground};--code-text:${palette.codeText};--shadow:${palette.shadow};--overlay:${palette.overlay};--green:${semantic.success};--success-text:${semantic.successText};--warning:${semantic.warning};--warning-text:${semantic.warningText};--red:${semantic.danger};--danger-text:${semantic.dangerText};--sphere-trim:${theme.trim};--sphere-core-start:${theme.sphereCore[0]};--sphere-core-middle:${theme.sphereCore[1]};--sphere-core-end:${theme.sphereCore[2]}}`;
  }).join("");
}
