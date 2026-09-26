import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { languagePackSchema } from "@/contracts/localization";
import { PALWORLD_SETTING_GUIDANCE } from "@/contracts/palworld-setting-guidance";
import { PALWORLD_SETTING_GROUPS } from "@/contracts/palworld-settings";
import { englishGuidedSettingTranslations } from "@/lib/localization-resources";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
  });
}

describe("language packs", () => {
  const english = languagePackSchema.parse(JSON.parse(readFileSync(path.join(process.cwd(), "public/locales/en.json"), "utf8")));
  const translations = { ...english.translations, ...englishGuidedSettingTranslations() };

  it("ships a valid, protected English fallback", () => {
    expect(english.meta).toMatchObject({ code: "en", direction: "ltr", version: 1 });
    expect(Object.keys(translations).length).toBeGreaterThan(300);
  });

  it("contains every literal translation key used by the application", () => {
    const missing = new Set<string>();
    for (const file of sourceFiles(path.join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/\bt\(\s*["']([^"']+)["']/g)) {
        const key = match[1];
        if (key && !(key in translations) && !(`${key}_one` in translations && `${key}_other` in translations)) missing.add(key);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it("provides administrator guidance for every guided Palworld setting", () => {
    const fieldKeys = PALWORLD_SETTING_GROUPS.flatMap((group) => group.fields.map((field) => field.key)).sort();
    expect(Object.keys(PALWORLD_SETTING_GUIDANCE).sort()).toEqual(fieldKeys);
    expect(Object.values(PALWORLD_SETTING_GUIDANCE).every((guidance) => guidance.length >= 30)).toBe(true);
    expect(fieldKeys.every((key) => `palworld.field.${key}.hint` in translations)).toBe(true);
  });

  it("covers every dynamic UI key family", () => {
    const keys = [
      ...["stopped", "starting", "running", "stopping", "crashed", "unknown"].map((value) => `status.${value}`),
      ...["overview", "players", "deaths", "console", "settings", "backups", "schedule", "admin"].map((value) => `world.tab.${value}`),
      ...["view", "lifecycle", "players", "messages"].map((value) => `remoteSettings.permission.${value}`),
      ...["start", "stop", "restart", "autostart", "crash-recovery", "install", "update", "check-update", "backup", "restore", "scheduled-backup", "scheduled-restart", "scheduled-stop", "scheduled-update", "scheduled-system-message", "scheduled-onscreen-notice", "scheduled-custom-http", "scheduled-idle-stop"].flatMap((value) => [`jobs.kind.${value}`, `jobs.starting.${value}`, `jobs.success.${value}`]),
    ];
    expect(keys.filter((key) => !(key in translations))).toEqual([]);
  });

  it("rejects unsafe keys and invalid language identifiers", () => {
    expect(languagePackSchema.safeParse({ meta: { code: "../en", name: "Bad", nativeName: "Bad", direction: "ltr", version: 1 }, translations: { ok: "value" } }).success).toBe(false);
    expect(languagePackSchema.safeParse({ meta: { code: "fr", name: "French", nativeName: "Français", direction: "ltr", version: 1 }, translations: { "bad..key": "value" } }).success).toBe(false);
  });
});
