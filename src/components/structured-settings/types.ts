import type { PALWORLD_SETTING_TABS, PalworldSettingValue } from "@/contracts/palworld-settings";
import type { AdvertisedPortState, Platform, WorldStatus } from "@/contracts/world";

export type Value = PalworldSettingValue;
/** The game configuration as the administration endpoint reports it. */
export type Structured = {
  options: Record<string, string>; exists: boolean; running: boolean; restartRequired: boolean; path: string;
  appliedOptions: Record<string, string>; desiredRevision: number; appliedRevision: number; pendingApply: boolean; drift: boolean; driftReason: string | null; applyError: string | null;
  shippedDefaults: { available: boolean; options: Record<string, string> };
  schemaWarnings: { unknownActiveKeys: string[]; unknownDefaultKeys: string[]; missingDefaultKeys: string[] };
};
/** PSM-owned settings as the page shows them. */
export type AdminConfiguration = {
  restApiEnabled: boolean; restApiPort: number; rconEnabled: boolean; rconPort: number;
  displayName: string; installDir: string; platform: Platform; gamePort: number; queryPort: number; advertisedPort: AdvertisedPortState;
  status: WorldStatus;
  communityServer: boolean; autostart: boolean; crashGuard: boolean; legacyPerfFlags: boolean; extraArgs: string; environment: Record<string, string>;
  wineBinary: string; winePrefix: string | null; wineLaunchFlags: string;
};
export type StructuredResponse = { configuration: Structured; admin: AdminConfiguration; appliedAdmin: AdminConfiguration };
/** The editable form of the PSM-owned settings; numbers are kept as text until save. */
export type ManagerDraft = {
  displayName: string; installDir: string; platform: Platform; gamePort: string; queryPort: string; publicPort: string;
  communityServer: boolean; autostart: boolean; crashGuard: boolean; legacyPerfFlags: boolean; extraArgs: string; environment: string;
  wineBinary: string; winePrefix: string; wineLaunchFlags: string; restApiEnabled: boolean; restApiPort: string; rconEnabled: boolean; rconPort: string;
};
export type ManagerKey = keyof ManagerDraft;

export const presets: Record<string, { labelKey: string; values: Record<string, Value> }> = {
  casual: { labelKey: "structured.preset.casual", values: { EnemyDropItemRate: 1.25, CollectionDropRate: 1.15, DeathPenalty: "Item", SupplyDropSpan: 50, PalSpawnNumRate: 1, ServerPlayerMaxNum: 20 } },
  balanced: { labelKey: "structured.preset.balanced", values: { EnemyDropItemRate: 1.05, CollectionDropRate: 1, DeathPenalty: "ItemAndEquipment", SupplyDropSpan: 60, PalSpawnNumRate: 1, ServerPlayerMaxNum: 40 } },
  smallGroup: { labelKey: "structured.preset.smallGroup", values: { EnemyDropItemRate: 1.1, CollectionDropRate: 1.05, DeathPenalty: "Item", SupplyDropSpan: 55, PalSpawnNumRate: 1, ServerPlayerMaxNum: 24 } },
};

export type SettingTab = (typeof PALWORLD_SETTING_TABS)[number];
export type SettingSection = SettingTab["sections"][number];
export type ManagedSection = NonNullable<SettingSection["managed"]>;
/** Which PSM-owned fields each managed section of the settings layout shows. */
export const managerSectionKeys: Record<ManagedSection, readonly ManagerKey[]> = {
  identity: ["displayName"],
  listing: ["communityServer", "publicPort"],
  network: ["gamePort", "queryPort", "restApiEnabled", "restApiPort", "rconEnabled", "rconPort"],
  lifecycle: ["autostart", "crashGuard"],
  performance: ["legacyPerfFlags"],
  launch: ["installDir", "platform", "extraArgs", "environment", "wineBinary", "winePrefix", "wineLaunchFlags"],
  registration: [],
};

export function valuesEqual(left: Value | undefined, right: Value | undefined) { return Array.isArray(left) && Array.isArray(right) ? left.length === right.length && left.every((value, index) => value === right[index]) : left === right; }
