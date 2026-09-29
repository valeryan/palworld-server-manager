import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { languagePackSchema } from "@/contracts/localization";
import { PALWORLD_SETTING_FIELDS, PALWORLD_SETTING_TABS } from "@/contracts/palworld-settings";
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
    const fieldKeys = PALWORLD_SETTING_FIELDS.map((field) => field.key).sort();
    expect(PALWORLD_SETTING_FIELDS.every((field) => field.help.length >= 30)).toBe(true);
    expect(fieldKeys.every((key) => `palworld.field.${key}.hint` in translations)).toBe(true);
    const groupIds = PALWORLD_SETTING_TABS.flatMap((tab) => [tab.id, ...tab.sections.map((section) => section.id)]);
    expect(new Set(groupIds).size).toBe(groupIds.length);
    const managerHelpKeys = [
      "managerProperties.displayNameHelp", "managerProperties.locationHelp", "properties.platformHelp",
      "properties.gamePortHelp", "properties.queryPortHelp", "properties.publicPortHelp", "properties.communityHelp",
      "properties.autostartHelp", "properties.crashRecoveryHelp", "properties.performanceHelp", "properties.extraArgsHelp",
      "properties.environmentHelp", "properties.wineBinaryHelp", "properties.winePrefixHelp", "properties.wineFlagsHelp",
      "properties.restApiHelp", "properties.restPortHelp", "properties.rconHelp", "properties.rconPortHelp",
    ];
    expect(managerHelpKeys.filter((key) => !(key in translations))).toEqual([]);
    const applicationHelpKeys = [
      "settings.port.labelHelp", "settings.language.labelHelp",
      ...["operationDays", "operationCount", "operationLines", "activityDays", "activityCount", "logFiles", "configVersions"].map((key) => `settings.retention.${key}Help`),
      ...["binding", "address", "create", "person", "worldAccess", "permissions", "codes"].map((key) => `remoteSettings.${key}Help`),
    ];
    expect(applicationHelpKeys.filter((key) => !(key in translations))).toEqual([]);
  });

  it("covers every dynamic UI key family", () => {
    const keys = [
      ...["stopped", "starting", "running", "stopping", "crashed", "unknown"].map((value) => `status.${value}`),
      ...["overview", "players", "deaths", "console", "settings", "mods", "backups", "schedule"].map((value) => `world.tab.${value}`),
      ...["windows", "linux"].map((value) => `mods.variant.${value}`),
      "platform.linux", "platform.windows", "platform.windowsWine",
      ...["member-layout-missing", "gui-console-visible", "gui-console-unknown"].map((value) => `mods.ue4ss.warning.${value}`),
      ...["mods.ue4ss.installed", "mods.ue4ss.notInstalled", "mods.ue4ss.libraryReady", "mods.ue4ss.libraryMissing", "mods.ue4ss.managedEnabled", "mods.ue4ss.managedDisabled", "mods.ue4ss.unmanaged", "mods.ue4ss.enable", "mods.ue4ss.disable", "mods.ue4ss.enabledNotice", "mods.ue4ss.disabledNotice", "mods.lua.inactiveDisabled", "mods.lua.inactiveMissing", "mods.lua.empty", "mods.lua.needsUe4ss", "mods.state.enabled", "mods.state.disabled", "mods.workshop.globalOn", "mods.workshop.globalOff", "modLibrary.downloaded", "modLibrary.notDownloaded", "modLibrary.downloading", "modLibrary.removeConfirm", "modLibrary.removeConfirmInUse"],
      ...["view", "lifecycle", "players", "messages"].map((value) => `remoteSettings.permission.${value}`),
      ...["start", "stop", "restart", "autostart", "crash-recovery", "install", "update", "check-update", "backup", "restore", "scheduled-backup", "scheduled-restart", "scheduled-stop", "scheduled-update", "scheduled-system-message", "scheduled-onscreen-notice", "scheduled-custom-http", "scheduled-idle-stop", "mod-download", "mod-install", "mod-remove"].flatMap((value) => [`jobs.kind.${value}`, `jobs.starting.${value}`, `jobs.success.${value}`]),
    ];
    expect(keys.filter((key) => !(key in translations))).toEqual([]);
  });

  it("rejects unsafe keys and invalid language identifiers", () => {
    expect(languagePackSchema.safeParse({ meta: { code: "../en", name: "Bad", nativeName: "Bad", direction: "ltr", version: 1 }, translations: { ok: "value" } }).success).toBe(false);
    expect(languagePackSchema.safeParse({ meta: { code: "fr", name: "French", nativeName: "Français", direction: "ltr", version: 1 }, translations: { "bad..key": "value" } }).success).toBe(false);
  });
});
