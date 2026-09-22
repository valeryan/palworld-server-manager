import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { languagePackSchema } from "@/contracts/localization";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
  });
}

describe("language packs", () => {
  const english = languagePackSchema.parse(JSON.parse(readFileSync(path.join(process.cwd(), "public/locales/en.json"), "utf8")));

  it("ships a valid, protected English fallback", () => {
    expect(english.meta).toMatchObject({ code: "en", direction: "ltr", version: 1 });
    expect(Object.keys(english.translations).length).toBeGreaterThan(50);
  });

  it("contains every literal translation key used by the application", () => {
    const missing = new Set<string>();
    for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\bt\(\s*["']([^"']+)["']/g)) {
        const key = match[1]; if (key && !(key in english.translations)) missing.add(key);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it("rejects unsafe keys and invalid language identifiers", () => {
    expect(languagePackSchema.safeParse({ meta: { code: "../en", name: "Bad", nativeName: "Bad", direction: "ltr", version: 1 }, translations: { ok: "value" } }).success).toBe(false);
    expect(languagePackSchema.safeParse({ meta: { code: "fr", name: "French", nativeName: "Français", direction: "ltr", version: 1 }, translations: { "bad..key": "value" } }).success).toBe(false);
  });
});
