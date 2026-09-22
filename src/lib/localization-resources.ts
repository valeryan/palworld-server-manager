import { PALWORLD_SETTING_GROUPS } from "@/contracts/palworld-settings";

export function settingGroupId(title: string): string { return title.toLocaleLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, ""); }
export function settingGroupKey(title: string, part: "title" | "description"): string { return `palworld.group.${settingGroupId(title)}.${part}`; }
export function settingFieldKey(key: string, part: "label" | "hint"): string { return `palworld.field.${key}.${part}`; }

export function englishGuidedSettingTranslations(): Record<string, string> {
  return Object.fromEntries(PALWORLD_SETTING_GROUPS.flatMap((group) => [
    [settingGroupKey(group.title, "title"), group.title],
    [settingGroupKey(group.title, "description"), group.description],
    ...group.fields.flatMap((field) => [
      [settingFieldKey(field.key, "label"), field.label],
      ...(field.hint ? [[settingFieldKey(field.key, "hint"), field.hint]] : []),
    ]),
  ]));
}
