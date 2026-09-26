import { PALWORLD_SETTING_FIELDS, PALWORLD_SETTING_TABS } from "@/contracts/palworld-settings";

export function settingGroupKey(id: string, part: "title" | "description"): string { return `palworld.group.${id}.${part}`; }
export function settingFieldKey(key: string, part: "label" | "hint"): string { return `palworld.field.${key}.${part}`; }

export function englishGuidedSettingTranslations(): Record<string, string> {
  return Object.fromEntries([
    ...PALWORLD_SETTING_TABS.flatMap((tab) => [
      [settingGroupKey(tab.id, "title"), tab.title],
      [settingGroupKey(tab.id, "description"), tab.description],
      ...tab.sections.flatMap((section) => [
        [settingGroupKey(section.id, "title"), section.title],
        [settingGroupKey(section.id, "description"), section.description],
      ]),
    ]),
    ...PALWORLD_SETTING_FIELDS.flatMap((field) => {
      return [
        [settingFieldKey(field.key, "label"), field.label],
        [settingFieldKey(field.key, "hint"), field.help],
      ];
    }),
  ]);
}
