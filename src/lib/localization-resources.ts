import { PALWORLD_SETTING_FIELDS, PALWORLD_SETTING_TABS } from "@/contracts/palworld-settings";
import { settingGuidance } from "@/contracts/palworld-setting-guidance";

export function settingGroupId(title: string): string { return title.toLocaleLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, ""); }
export function settingGroupKey(title: string, part: "title" | "description"): string { return `palworld.group.${settingGroupId(title)}.${part}`; }
export function settingFieldKey(key: string, part: "label" | "hint"): string { return `palworld.field.${key}.${part}`; }

export function englishGuidedSettingTranslations(): Record<string, string> {
  return Object.fromEntries([
    ...PALWORLD_SETTING_TABS.flatMap((tab) => [
      [settingGroupKey(tab.title, "title"), tab.title],
      [settingGroupKey(tab.title, "description"), tab.description],
      ...tab.sections.flatMap((section) => [
        [settingGroupKey(section.title, "title"), section.title],
        [settingGroupKey(section.title, "description"), section.description],
      ]),
    ]),
    ...PALWORLD_SETTING_FIELDS.flatMap((field) => {
      const guidance = settingGuidance(field.key) ?? field.hint;
      return [
        [settingFieldKey(field.key, "label"), field.label],
        ...(guidance ? [[settingFieldKey(field.key, "hint"), guidance]] : []),
      ];
    }),
  ]);
}
