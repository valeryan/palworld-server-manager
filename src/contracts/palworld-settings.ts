export type PalworldSettingType = "bool" | "int" | "float" | "text" | "select" | "tuple";
export type PalworldSettingField = { key: string; label: string; type: PalworldSettingType; default: string | number | boolean; options?: readonly string[]; min?: number; max?: number; hint?: string };
export type PalworldSettingGroup = { title: string; description: string; fields: readonly PalworldSettingField[]; surface?: "guided" | "admin" };

export const PALWORLD_SETTING_GROUPS: readonly PalworldSettingGroup[] = [
  {
    "title": "General",
    "fields": [
      {
        "key": "Difficulty",
        "label": "Difficulty",
        "type": "select",
        "default": "None",
        "options": [
          "None",
          "Casual",
          "Normal",
          "Hard"
        ]
      },
      {
        "key": "DeathPenalty",
        "label": "Death penalty",
        "type": "select",
        "default": "Item",
        "options": [
          "None",
          "Item",
          "ItemAndEquipment",
          "All"
        ]
      },
      {
        "key": "bHardcore",
        "label": "Hardcore",
        "type": "bool",
        "default": false
      },
      {
        "key": "bPalLost",
        "label": "Pals lost on death (hardcore)",
        "type": "bool",
        "default": false
      },
      {
        "key": "bCharacterRecreateInHardcore",
        "label": "Recreate character (hardcore)",
        "type": "bool",
        "default": false
      },
      {
        "key": "RandomizerType",
        "label": "Randomizer type",
        "type": "select",
        "default": "None",
        "options": [
          "None",
          "Region",
          "All"
        ]
      },
      {
        "key": "RandomizerSeed",
        "label": "Randomizer seed",
        "type": "text",
        "default": ""
      },
      {
        "key": "bIsRandomizerPalLevelRandom",
        "label": "Randomize Pal levels",
        "type": "bool",
        "default": false
      }
    ],
    "description": "Core difficulty, death, hardcore, and randomizer behavior."
  },
  {
    "title": "Time & Rates",
    "fields": [
      {
        "key": "DayTimeSpeedRate",
        "label": "Day speed",
        "type": "float",
        "default": 1
      },
      {
        "key": "NightTimeSpeedRate",
        "label": "Night speed",
        "type": "float",
        "default": 1
      },
      {
        "key": "ExpRate",
        "label": "EXP rate",
        "type": "float",
        "default": 1
      },
      {
        "key": "WorkSpeedRate",
        "label": "Work speed",
        "type": "float",
        "default": 1
      },
      {
        "key": "MonsterFarmActionSpeedRate",
        "label": "Ranch Pal work speed",
        "type": "float",
        "default": 1
      },
      {
        "key": "AutoSaveSpan",
        "label": "Auto-save interval (s)",
        "type": "float",
        "default": 30
      }
    ],
    "description": "Day/night timing, progression, work speed, and save cadence."
  },
  {
    "title": "Pals",
    "fields": [
      {
        "key": "PalCaptureRate",
        "label": "Capture rate",
        "type": "float",
        "default": 1
      },
      {
        "key": "PalSpawnNumRate",
        "label": "Pal spawn rate",
        "type": "float",
        "default": 1
      },
      {
        "key": "PalDamageRateAttack",
        "label": "Pal attack damage",
        "type": "float",
        "default": 1
      },
      {
        "key": "PalDamageRateDefense",
        "label": "Pal damage received",
        "type": "float",
        "default": 1
      },
      {
        "key": "PalStomachDecreaceRate",
        "label": "Pal hunger drain",
        "type": "float",
        "default": 1
      },
      {
        "key": "PalStaminaDecreaceRate",
        "label": "Pal stamina drain",
        "type": "float",
        "default": 1
      },
      {
        "key": "PalAutoHPRegeneRate",
        "label": "Pal HP regen",
        "type": "float",
        "default": 1
      },
      {
        "key": "PalAutoHpRegeneRateInSleep",
        "label": "Pal HP regen (sleep)",
        "type": "float",
        "default": 1
      },
      {
        "key": "PalEggDefaultHatchingTime",
        "label": "Egg hatching time (h)",
        "type": "float",
        "default": 1
      },
      {
        "key": "EnablePredatorBossPal",
        "label": "Predator boss Pals",
        "type": "bool",
        "default": true
      }
    ],
    "description": "Pal spawning, capture, combat, hunger, recovery, and egg timing."
  },
  {
    "title": "Players",
    "fields": [
      {
        "key": "PlayerDamageRateAttack",
        "label": "Player attack damage",
        "type": "float",
        "default": 1
      },
      {
        "key": "PlayerDamageRateDefense",
        "label": "Player damage received",
        "type": "float",
        "default": 1
      },
      {
        "key": "PlayerStomachDecreaceRate",
        "label": "Player hunger drain",
        "type": "float",
        "default": 1
      },
      {
        "key": "PlayerStaminaDecreaceRate",
        "label": "Player stamina drain",
        "type": "float",
        "default": 1
      },
      {
        "key": "PlayerAutoHPRegeneRate",
        "label": "Player HP regen",
        "type": "float",
        "default": 1
      },
      {
        "key": "PlayerAutoHpRegeneRateInSleep",
        "label": "Player HP regen (sleep)",
        "type": "float",
        "default": 1
      },
      {
        "key": "ItemWeightRate",
        "label": "Item weight rate",
        "type": "float",
        "default": 1
      },
      {
        "key": "BlockRespawnTime",
        "label": "Respawn block time (s)",
        "type": "float",
        "default": 5
      },
      {
        "key": "RespawnPenaltyDurationThreshold",
        "label": "Respawn penalty threshold",
        "type": "float",
        "default": 0
      },
      {
        "key": "RespawnPenaltyTimeScale",
        "label": "Respawn penalty scale",
        "type": "float",
        "default": 2
      }
    ],
    "description": "Player combat, survival drains, recovery, weight, and respawn penalties."
  },
  {
    "title": "Enhance Stats",
    "fields": [
      {
        "key": "bAllowEnhanceStat_Health",
        "label": "Enhance: Health",
        "type": "bool",
        "default": true
      },
      {
        "key": "bAllowEnhanceStat_Attack",
        "label": "Enhance: Attack",
        "type": "bool",
        "default": true
      },
      {
        "key": "bAllowEnhanceStat_Stamina",
        "label": "Enhance: Stamina",
        "type": "bool",
        "default": true
      },
      {
        "key": "bAllowEnhanceStat_Weight",
        "label": "Enhance: Weight",
        "type": "bool",
        "default": true
      },
      {
        "key": "bAllowEnhanceStat_WorkSpeed",
        "label": "Enhance: Work speed",
        "type": "bool",
        "default": true
      }
    ],
    "description": "Choose which character statistics players may improve."
  },
  {
    "title": "World & Loot",
    "fields": [
      {
        "key": "CollectionDropRate",
        "label": "Gather drop rate",
        "type": "float",
        "default": 1
      },
      {
        "key": "CollectionObjectHpRate",
        "label": "Gatherable HP",
        "type": "float",
        "default": 1
      },
      {
        "key": "CollectionObjectRespawnSpeedRate",
        "label": "Gatherable respawn interval",
        "type": "float",
        "default": 1
      },
      {
        "key": "EnemyDropItemRate",
        "label": "Enemy drop rate",
        "type": "float",
        "default": 1
      },
      {
        "key": "DropItemMaxNum",
        "label": "Max dropped items",
        "type": "int",
        "default": 3000
      },
      {
        "key": "PhysicsActiveDropItemMaxNum",
        "label": "Max physics-simulated drops",
        "type": "int",
        "default": -1,
        "hint": "Maximum dropped items using full physics. -1 means unlimited; a lower cap can reduce server load."
      },
      {
        "key": "DropItemMaxNum_UNKO",
        "label": "Max dropped (UNKO)",
        "type": "int",
        "default": 100
      },
      {
        "key": "DropItemAliveMaxHours",
        "label": "Dropped item lifetime (h)",
        "type": "float",
        "default": 1
      },
      {
        "key": "SupplyDropSpan",
        "label": "Meteor/Supply drop interval (min)",
        "type": "int",
        "default": 180
      },
      {
        "key": "bEnableInvaderEnemy",
        "label": "Raid invaders",
        "type": "bool",
        "default": true
      },
      {
        "key": "bActiveUNKO",
        "label": "Active UNKO",
        "type": "bool",
        "default": false
      },
      {
        "key": "EquipmentDurabilityDamageRate",
        "label": "Equipment durability loss",
        "type": "float",
        "default": 1
      },
      {
        "key": "ItemCorruptionMultiplier",
        "label": "Item corruption rate",
        "type": "float",
        "default": 1
      },
      {
        "key": "FishingDifficultyRate",
        "label": "Fishing difficulty",
        "type": "float",
        "default": 1,
        "min": 0.1,
        "max": 1,
        "hint": "Fishing difficulty multiplier. Lower values make fishing easier; 1 is the most difficult supported value."
      },
      {
        "key": "bAllowEnemyCampSpawnNearBaseCamp",
        "label": "Enemy camps near player bases",
        "type": "bool",
        "default": false,
        "hint": "Allow enemy camps to spawn close to player base camps."
      },
      {
        "key": "DenyTechnologyList",
        "label": "Denied technologies",
        "type": "text",
        "default": ""
      }
    ],
    "description": "Gathering, drops, world events, durability, and item lifetime."
  },
  {
    "title": "Building & Base Camps",
    "fields": [
      {
        "key": "BuildObjectHpRate",
        "label": "Structure HP",
        "type": "float",
        "default": 1
      },
      {
        "key": "BuildObjectDamageRate",
        "label": "Structure damage",
        "type": "float",
        "default": 1
      },
      {
        "key": "BuildObjectDeteriorationDamageRate",
        "label": "Structure deterioration",
        "type": "float",
        "default": 1
      },
      {
        "key": "BaseCampMaxNum",
        "label": "Max base camps",
        "type": "int",
        "default": 128
      },
      {
        "key": "BaseCampWorkerMaxNum",
        "label": "Max workers/base",
        "type": "int",
        "default": 15,
        "max": 50,
        "hint": "Cap is 50. Higher values raise server load."
      },
      {
        "key": "BaseCampMaxNumInGuild",
        "label": "Max bases/guild",
        "type": "int",
        "default": 4,
        "max": 10,
        "hint": "Maximum bases per guild. Higher values increase server load."
      },
      {
        "key": "MaxBuildingLimitNum",
        "label": "Max buildings server-wide (0=unlimited)",
        "type": "int",
        "default": 0
      },
      {
        "key": "MaxBuildingLimitNumPerPlayer",
        "label": "Max buildings/player (0=unlimited)",
        "type": "int",
        "default": 0
      },
      {
        "key": "bBuildAreaLimit",
        "label": "Build area limit",
        "type": "bool",
        "default": false
      },
      {
        "key": "bEnableBuildingPlayerUIdDisplay",
        "label": "Show builder on structures",
        "type": "bool",
        "default": false
      }
    ],
    "description": "Structure durability and per-world or per-guild base limits."
  },
  {
    "title": "Guilds",
    "fields": [
      {
        "key": "GuildPlayerMaxNum",
        "label": "Max guild players",
        "type": "int",
        "default": 20
      },
      {
        "key": "bAutoResetGuildNoOnlinePlayers",
        "label": "Auto-reset empty guilds",
        "type": "bool",
        "default": false
      },
      {
        "key": "AutoResetGuildTimeNoOnlinePlayers",
        "label": "Guild reset time (h)",
        "type": "float",
        "default": 72
      },
      {
        "key": "bEnableDefenseOtherGuildPlayer",
        "label": "Defend vs other guilds",
        "type": "bool",
        "default": false
      },
      {
        "key": "bCanPickupOtherGuildDeathPenaltyDrop",
        "label": "Loot other guild drops",
        "type": "bool",
        "default": false
      },
      {
        "key": "bInvisibleOtherGuildBaseCampAreaFX",
        "label": "Hide other guild base FX",
        "type": "bool",
        "default": false
      },
      {
        "key": "GuildRejoinCooldownMinutes",
        "label": "Guild rejoin cooldown (m)",
        "type": "int",
        "default": 0
      },
      {
        "key": "AutoTransferMasterCheckIntervalSeconds",
        "label": "Guild master transfer check (s)",
        "type": "float",
        "default": 3600,
        "hint": "How often the server checks whether an inactive guild master should be transferred."
      },
      {
        "key": "AutoTransferMasterThresholdDays",
        "label": "Guild master inactivity threshold (days)",
        "type": "int",
        "default": 14,
        "hint": "Days a guild master may remain inactive before automatic transfer is eligible."
      }
    ],
    "description": "Guild membership, reset behavior, defense, looting, and cooldowns."
  },
  {
    "title": "Multiplayer & PvP",
    "fields": [
      {
        "key": "bEnablePlayerToPlayerDamage",
        "label": "PvP damage",
        "type": "bool",
        "default": false
      },
      {
        "key": "bEnableFriendlyFire",
        "label": "Friendly fire",
        "type": "bool",
        "default": false
      },
      {
        "key": "bIsPvP",
        "label": "PvP mode",
        "type": "bool",
        "default": false
      },
      {
        "key": "bIsMultiplay",
        "label": "Multiplay flag",
        "type": "bool",
        "default": false
      },
      {
        "key": "CoopPlayerMaxNum",
        "label": "Co-op max players",
        "type": "int",
        "default": 4
      },
      {
        "key": "ServerPlayerMaxNum",
        "label": "Server max players",
        "type": "int",
        "default": 32
      },
      {
        "key": "bEnableNonLoginPenalty",
        "label": "Non-login penalty",
        "type": "bool",
        "default": true
      },
      {
        "key": "bEnableFastTravel",
        "label": "Fast travel",
        "type": "bool",
        "default": true
      },
      {
        "key": "bEnableFastTravelOnlyBaseCamp",
        "label": "Fast travel: base only",
        "type": "bool",
        "default": false
      },
      {
        "key": "bIsStartLocationSelectByMap",
        "label": "Choose start on map",
        "type": "bool",
        "default": false
      },
      {
        "key": "bExistPlayerAfterLogout",
        "label": "Body persists after logout",
        "type": "bool",
        "default": false
      },
      {
        "key": "bDisplayPvPItemNumOnWorldMap_BaseCamp",
        "label": "Show PvP items on map (base)",
        "type": "bool",
        "default": false
      },
      {
        "key": "bDisplayPvPItemNumOnWorldMap_Player",
        "label": "Show PvP items on map (player)",
        "type": "bool",
        "default": false
      },
      {
        "key": "bAdditionalDropItemWhenPlayerKillingInPvPMode",
        "label": "Enable PvP kill drops",
        "type": "bool",
        "default": false
      },
      {
        "key": "AdditionalDropItemWhenPlayerKillingInPvPMode",
        "label": "PvP kill drop item",
        "type": "text",
        "default": "PlayerDropItem"
      },
      {
        "key": "AdditionalDropItemNumWhenPlayerKillingInPvPMode",
        "label": "PvP kill drop count",
        "type": "int",
        "default": 1
      }
    ],
    "description": "Multiplayer, PvP, travel, logout, map, and PvP reward behavior."
  },
  {
    "title": "Voice Chat (1.0)",
    "fields": [
      {
        "key": "bEnableVoiceChat",
        "label": "Enable proximity voice chat",
        "type": "bool",
        "default": false,
        "hint": "New in Palworld 1.0. In-game voice is off by default; enable it and tune the audible distance below. Restart to apply."
      },
      {
        "key": "VoiceChatMaxVolumeDistance",
        "label": "Full-volume distance",
        "type": "int",
        "default": 3000,
        "hint": "Distance (cm) within which voice plays at full volume before it starts to fade."
      },
      {
        "key": "VoiceChatZeroVolumeDistance",
        "label": "Silence distance",
        "type": "int",
        "default": 15000,
        "hint": "Distance (cm) beyond which voice can no longer be heard."
      }
    ],
    "description": "Proximity voice-chat availability and audible distance."
  },
  {
    "title": "Palbox & Crossplay",
    "fields": [
      {
        "key": "CrossplayPlatforms",
        "label": "Crossplay platforms",
        "type": "tuple",
        "default": "(Steam,Xbox,PS5,Mac)"
      },
      {
        "key": "bAllowGlobalPalboxExport",
        "label": "Global Palbox export",
        "type": "bool",
        "default": true
      },
      {
        "key": "bAllowGlobalPalboxImport",
        "label": "Global Palbox import",
        "type": "bool",
        "default": false
      },
      {
        "key": "bAllowClientMod",
        "label": "Allow client mods",
        "type": "bool",
        "default": true
      }
    ],
    "description": "Cross-platform access, Global Palbox, and client-mod policy."
  },
  {
    "title": "Aim Assist & Backups",
    "fields": [
      {
        "key": "bEnableAimAssistPad",
        "label": "Aim assist (pad)",
        "type": "bool",
        "default": true
      },
      {
        "key": "bEnableAimAssistKeyboard",
        "label": "Aim assist (keyboard)",
        "type": "bool",
        "default": false
      },
      {
        "key": "bIsUseBackupSaveData",
        "label": "Rolling save backups",
        "type": "bool",
        "default": true
      }
    ],
    "description": "Input assistance and Palworld rolling-save backups."
  },
  {
    "title": "Server Listing & Access",
    "surface": "admin",
    "fields": [
      {
        "key": "ServerName",
        "label": "Server name",
        "type": "text",
        "default": "Default Palworld Server"
      },
      {
        "key": "ServerDescription",
        "label": "Description",
        "type": "text",
        "default": ""
      },
      {
        "key": "PublicIP",
        "label": "Public IP (for tunnels)",
        "type": "text",
        "default": "",
        "hint": "Your public / tunnel IP (blank = auto-detect)."
      },
      {
        "key": "PublicPort",
        "label": "Public port (advertised)",
        "type": "int",
        "default": 8211,
        "hint": "Your public / tunnel port (else the game port)."
      },
      {
        "key": "Region",
        "label": "Region",
        "type": "text",
        "default": ""
      }
    ],
    "description": "Palworld public-browser identity and the external address advertised when Community server is enabled."
  },
  {
    "title": "Server Rules & Logging",
    "fields": [
      {
        "key": "bUseAuth",
        "label": "Require auth",
        "type": "bool",
        "default": true
      },
      {
        "key": "BanListURL",
        "label": "Ban list URL",
        "type": "text",
        "default": "https://b.palworldgame.com/api/banlist.txt"
      },
      {
        "key": "bShowPlayerList",
        "label": "Show player list",
        "type": "bool",
        "default": false
      },
      {
        "key": "bIsShowJoinLeftMessage",
        "label": "Show join/leave msgs",
        "type": "bool",
        "default": true
      },
      {
        "key": "ChatPostLimitPerMinute",
        "label": "Chat rate limit/min",
        "type": "int",
        "default": 30
      },
      {
        "key": "LogFormatType",
        "label": "Log format",
        "type": "select",
        "default": "Text",
        "options": [
          "Text",
          "Json"
        ]
      }
    ],
    "description": "Platform authentication, ban-list source, player-list visibility, chat notices, rate limits, and log format."
  },
  {
    "title": "Performance & Synchronization",
    "fields": [
      {
        "key": "ServerReplicatePawnCullDistance",
        "label": "Pal synchronization distance (cm)",
        "type": "float",
        "default": 15000,
        "min": 5000,
        "max": 15000,
        "hint": "Distance from players at which Pals are synchronized. Lower values reduce load but make distant Pals appear later."
      },
      {
        "key": "ItemContainerForceMarkDirtyInterval",
        "label": "Open-container resync interval (s)",
        "type": "float",
        "default": 1,
        "hint": "How often an open container is forcibly re-synchronized. Higher values reduce checks but can make contents feel delayed."
      },
      {
        "key": "PlayerDataPalStorageUpdateCheckTickInterval",
        "label": "Pal storage check interval (s)",
        "type": "float",
        "default": 1,
        "hint": "How often the server rechecks player Pal storage."
      },
      {
        "key": "MaxGuildsPerFrame",
        "label": "Guilds processed per frame",
        "type": "int",
        "default": 10,
        "hint": "Maximum guilds processed during one server frame."
      },
      {
        "key": "BuildingNameDisplayCacheTTLSeconds",
        "label": "Builder-name cache lifetime (s)",
        "type": "int",
        "default": 60,
        "hint": "How long the server caches builder-name lookups shown on structures."
      }
    ],
    "description": "Advanced server processing, replication, and synchronization intervals."
  }
];
export const PALWORLD_SETTING_FIELDS: readonly PalworldSettingField[] = PALWORLD_SETTING_GROUPS.flatMap((group) => group.fields);
export const PALWORLD_GUIDED_SETTING_GROUPS: readonly PalworldSettingGroup[] = PALWORLD_SETTING_GROUPS.filter((group) => group.surface !== "admin");
export const PALWORLD_ADMIN_SETTING_FIELDS: readonly PalworldSettingField[] = PALWORLD_SETTING_GROUPS.filter((group) => group.surface === "admin").flatMap((group) => group.fields);
const fieldMap = new Map(PALWORLD_SETTING_FIELDS.map((field) => [field.key, field]));

export function validateAndEncodeSettingChanges(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Configuration changes must be an object.");
  const entries = Object.entries(raw as Record<string, unknown>);
  if (!entries.length || entries.length > PALWORLD_SETTING_FIELDS.length) throw new Error("Select between 1 and " + PALWORLD_SETTING_FIELDS.length + " settings to change.");
  return Object.fromEntries(entries.map(([key, value]) => {
    const field = fieldMap.get(key);
    if (!field) throw new Error(`Unknown structured setting: ${key}`);
    if (field.type === "bool") { if (typeof value !== "boolean") throw new Error(`${field.label} must be on or off.`); return [key, value ? "True" : "False"]; }
    if (field.type === "int" || field.type === "float") {
      if (typeof value !== "number" || !Number.isFinite(value) || (field.type === "int" && !Number.isInteger(value))) throw new Error(`${field.label} must be a valid ${field.type === "int" ? "whole number" : "number"}.`);
      if (field.min != null && value < field.min) throw new Error(`${field.label} cannot be lower than ${field.min}.`);
      if (field.max != null && value > field.max) throw new Error(`${field.label} cannot be higher than ${field.max}.`);
      return [key, String(value)];
    }
    if (typeof value !== "string" || value.length > 8_192 || /[\r\n\0]/.test(value)) throw new Error(`${field.label} contains an invalid value.`);
    if (field.type === "select" && !field.options?.includes(value)) throw new Error(`${field.label} must be one of: ${field.options?.join(", ")}.`);
    if (field.type === "tuple") { if (!/^\([^\r\n]*\)$/.test(value)) throw new Error(`${field.label} must use tuple syntax such as (Value1,Value2).`); return [key, value]; }
    return [key, JSON.stringify(value)];
  }));
}
