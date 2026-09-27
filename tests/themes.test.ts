import { describe, expect, it } from "vitest";
import { defaultTheme, isThemeId, themes } from "@/lib/themes";

describe("sphere themes", () => {
  it("provides a unique theme for every non-blank sphere", () => {
    expect(themes).toHaveLength(10);
    expect(themes.map((theme) => theme.id)).toEqual(["pal", "mega", "giga", "hyper", "ultra", "legendary", "ultimate", "exotic", "sol", "ancient"]);
    expect(new Set(themes.map((theme) => theme.id)).size).toBe(themes.length);
    expect(new Set(themes.map((theme) => theme.image)).size).toBe(themes.length);
    expect(themes.every((theme) => /^#[0-9a-f]{6}$/i.test(theme.accent))).toBe(true);
  });

  it("validates persisted theme identifiers", () => {
    expect(isThemeId(defaultTheme)).toBe(true);
    expect(isThemeId("legendary")).toBe(true);
    expect(isThemeId("blank")).toBe(false);
    expect(isThemeId(null)).toBe(false);
  });
});
