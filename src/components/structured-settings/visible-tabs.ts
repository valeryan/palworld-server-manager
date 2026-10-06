import type { TFunction } from "i18next";
import { PALWORLD_SETTING_TABS, type PalworldSettingField } from "@/contracts/palworld-settings";
import { settingFieldKey } from "@/lib/localization-resources";
import { managerSectionKeys, type ManagedSection, type ManagerKey, type SettingSection, type SettingTab } from "./types";

// Which tabs, sections and fields the page shows for the current tab, search term or "review changes" mode.

export type VisibleSection = Omit<SettingSection, "fields"> & { fields: readonly PalworldSettingField[]; showManaged: boolean };
export type VisibleTab = Omit<SettingTab, "sections"> & { sections: VisibleSection[] };
export type ChangeSets = { changedKeys: Set<string>; managerChangedKeys: Set<ManagerKey> };

const managedSearchText = (t: TFunction): Record<ManagedSection, string> => ({
  identity: ["identity name", t("managerProperties.displayName")].join(" ").toLowerCase(),
  listing: ["listing community public ip public port advertised", t("properties.community"), t("properties.publicPort")].join(" ").toLowerCase(),
  network: ["game query port network rest api rcon", t("properties.gamePort"), t("properties.queryPort"), t("properties.restApi"), t("properties.rcon")].join(" ").toLowerCase(),
  lifecycle: ["lifecycle autostart crash recovery save logs", t("properties.autostart"), t("properties.crashRecovery")].join(" ").toLowerCase(),
  performance: ["performance flags synchronization", t("properties.performance")].join(" ").toLowerCase(),
  launch: ["installation path platform launch wine environment", t("properties.installDirectory"), t("properties.environment")].join(" ").toLowerCase(),
  registration: ["registration export unregister removal"].join(" ").toLowerCase(),
});

export const managedCount = (kind: ManagedSection, changes: ChangeSets) => managerSectionKeys[kind].filter((key) => changes.managerChangedKeys.has(key)).length;
export const sectionChangeCount = (section: SettingSection, changes: ChangeSets) => section.fields.filter((field) => changes.changedKeys.has(field.key)).length + (section.managed ? managedCount(section.managed, changes) : 0);
export const tabChangeCount = (tab: SettingTab, changes: ChangeSets) => tab.sections.reduce((count, section) => count + sectionChangeCount(section, changes), 0);

export function visibleTabs(t: TFunction, view: { searchTerm: string; reviewChanges: boolean; activeTab: number }, changes: ChangeSets): VisibleTab[] {
  const { searchTerm, reviewChanges } = view;
  const searchText = managedSearchText(t);
  const sourceTabs = searchTerm || reviewChanges ? PALWORLD_SETTING_TABS : [PALWORLD_SETTING_TABS[view.activeTab]!];
  return sourceTabs.map((tab) => ({ ...tab, sections: tab.sections.map((section): VisibleSection => {
    const fields = section.fields.filter((field) => reviewChanges ? changes.changedKeys.has(field.key) : searchTerm ? `${t(settingFieldKey(field.key, "label"))} ${field.key} ${t(settingFieldKey(field.key, "hint"))}`.toLowerCase().includes(searchTerm) : true);
    const showManaged = Boolean(section.managed && (reviewChanges ? managedCount(section.managed, changes) : searchTerm ? searchText[section.managed].includes(searchTerm) : true));
    return { ...section, fields, showManaged };
  }).filter((section) => section.fields.length || section.showManaged) })).filter((tab) => tab.sections.length);
}
