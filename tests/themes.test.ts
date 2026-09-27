import { describe, expect, it } from "vitest";
import { defaultTheme, isThemeId, semanticPalettes, themes, themeStyleSheet } from "@/lib/themes";

const themeOrder = ["pal", "mega", "giga", "hyper", "ultra", "legendary", "ultimate", "exotic", "sol", "ancient"];
const paletteKeys = ["mode", "canvas", "sidebar", "surface", "raised", "inset", "control", "border", "borderStrong", "text", "muted", "subtle", "accent", "accentInk", "codeBackground", "codeText", "shadow", "overlay"];
type Rgb = readonly [number, number, number];
type Color = string | Rgb;

function channels(color: Color): Rgb {
  if (typeof color !== "string") return color;
  return [Number.parseInt(color.slice(1, 3), 16), Number.parseInt(color.slice(3, 5), 16), Number.parseInt(color.slice(5, 7), 16)];
}

function mix(first: string, second: string, firstWeight: number): Rgb {
  const firstChannels = channels(first);
  const secondChannels = channels(second);
  return [
    firstChannels[0] * firstWeight + secondChannels[0] * (1 - firstWeight),
    firstChannels[1] * firstWeight + secondChannels[1] * (1 - firstWeight),
    firstChannels[2] * firstWeight + secondChannels[2] * (1 - firstWeight),
  ];
}

function luminance(color: Color): number {
  const normalized = channels(color).map((value) => value / 255);
  return normalized.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index]!, 0);
}

function contrast(first: Color, second: Color): number {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe("sphere themes", () => {
  it("provides a complete, ordered theme for every non-blank sphere", () => {
    expect(themes).toHaveLength(10);
    expect(themes.map((theme) => theme.id)).toEqual(themeOrder);
    expect(new Set(themes.map((theme) => theme.id)).size).toBe(themes.length);
    expect(new Set(themes.map((theme) => theme.image)).size).toBe(themes.length);
    for (const theme of themes) {
      expect(theme.sphereAccent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(theme.sphereCore).toHaveLength(3);
      expect(Object.keys(theme.palette)).toEqual(paletteKeys);
      for (const [key, value] of Object.entries(theme.palette)) {
        if (key !== "mode") expect(value, `${theme.id}.${key}`).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
      }
    }
  });

  it("uses the intended mixed-brightness modes", () => {
    expect(themes.filter((theme) => theme.palette.mode === "light").map((theme) => theme.id)).toEqual(["giga", "sol"]);
    expect(themes.filter((theme) => theme.palette.mode === "dark").map((theme) => theme.id)).toEqual(["pal", "mega", "hyper", "ultra", "legendary", "ultimate", "exotic", "ancient"]);
  });

  it("meets contrast targets for text, controls, code, and semantic states", () => {
    for (const theme of themes) {
      const palette = theme.palette;
      const semantic = semanticPalettes[palette.mode];
      const backgrounds = { canvas: palette.canvas, sidebar: palette.sidebar, surface: palette.surface, raised: palette.raised, inset: palette.inset, control: palette.control };
      for (const [name, background] of Object.entries(backgrounds)) {
        expect(contrast(palette.text, background), `${theme.id} primary text on ${name}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(palette.muted, background), `${theme.id} muted text on ${name}`).toBeGreaterThanOrEqual(4.5);
        for (const weight of [0.13, 0.16, 0.28]) expect(contrast(palette.text, mix(palette.accent, background, weight)), `${theme.id} primary text on ${weight * 100}% accent over ${name}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const background of [palette.canvas, palette.surface]) expect(contrast(palette.accent, background), `${theme.id} accent text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.accentInk, palette.accent), `${theme.id} primary button`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.accent, palette.surface), `${theme.id} accent boundary`).toBeGreaterThanOrEqual(3);
      expect(contrast(palette.borderStrong, palette.inset), `${theme.id} control boundary`).toBeGreaterThanOrEqual(3);
      expect(contrast(palette.muted, palette.inset), `${theme.id} off toggle indicator`).toBeGreaterThanOrEqual(3);
      expect(contrast(palette.codeText, palette.codeBackground), `${theme.id} console text`).toBeGreaterThanOrEqual(4.5);
      for (const key of ["successText", "warningText", "dangerText"] as const) expect(contrast(semantic[key], palette.surface), `${theme.id} ${key}`).toBeGreaterThanOrEqual(4.5);
      for (const key of ["success", "warning", "danger"] as const) expect(contrast(semantic[key], palette.surface), `${theme.id} ${key}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("generates a complete pre-hydration palette stylesheet", () => {
    const stylesheet = themeStyleSheet();
    for (const theme of themes) {
      expect(stylesheet).toContain(`data-theme="${theme.id}"`);
      expect(stylesheet).toContain(`color-scheme:${theme.palette.mode}`);
      expect(stylesheet).toContain(`--bg:${theme.palette.canvas}`);
      expect(stylesheet).toContain(`--sphere-core-start:${theme.sphereCore[0]}`);
    }
  });

  it("validates persisted theme identifiers", () => {
    expect(isThemeId(defaultTheme)).toBe(true);
    expect(isThemeId("legendary")).toBe(true);
    expect(isThemeId("blank")).toBe(false);
    expect(isThemeId(null)).toBe(false);
  });
});
