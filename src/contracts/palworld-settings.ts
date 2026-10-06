import { scanTuple } from "@/lib/tuple-scanner";

export type PalworldSettingType = "bool" | "int" | "float" | "text" | "password" | "select" | "multi-select" | "tuple";
export type PalworldSettingEvidence = "official" | "uncertain";
export type PalworldSettingPresentation = "compact" | "standard" | "wide" | "lead";
export type PalworldSettingLayoutItem = { keys: readonly string[]; span: 4 | 6 | 8 | 12; presentation?: PalworldSettingPresentation; grouped?: boolean };
export type PalworldSettingField = {
  key: string; label: string; type: PalworldSettingType; help: string; evidence: PalworldSettingEvidence;
  options?: readonly string[]; min?: number; max?: number; allowEmpty?: boolean; presentation?: PalworldSettingPresentation;
};
export type PalworldSettingSection = { id: string; title: string; description: string; fields: readonly PalworldSettingField[]; managed?: "identity" | "listing" | "network" | "lifecycle" | "performance" | "launch" | "registration"; layout?: readonly PalworldSettingLayoutItem[] };
export type PalworldSettingTab = { id: string; title: string; description: string; sections: readonly PalworldSettingSection[] };
export type PalworldSettingValue = string | number | boolean | string[];
export type DecodedSettingValue =
  | { status: "valid"; value: PalworldSettingValue; raw: string }
  | { status: "missing" }
  | { status: "invalid"; raw: string; reason: string }
  | { status: "unsupported-default"; raw: string; reason: string };

export const PALWORLD_MANAGER_SETTING_KEYS = ["PublicPort", "RESTAPIEnabled", "RESTAPIPort", "RCONEnabled", "RCONPort"] as const;

export const PALWORLD_SETTING_TABS: readonly PalworldSettingTab[] = [
  { id: "gameplay", title: "Gameplay", description: "Core game rules, progression, travel, and respawn behavior.", sections: [
    { id: "difficulty-death", title: "Difficulty & Death", description: "Overall difficulty, death penalties, and hardcore consequences.", fields: [
      { key: "Difficulty", label: "Difficulty", type: "select", help: "Named difficulty preset. None leaves balance to the individual settings below; do not assume a named preset replaces explicit multipliers.", evidence: "official", options: ["None","Casual","Normal","Hard"] },
      { key: "DeathPenalty", label: "Death penalty", type: "select", help: "Controls death losses. None: nothing; Item: inventory except equipment; ItemAndEquipment: inventory and equipment; All: those items plus party Pals.", evidence: "official", options: ["None","Item","ItemAndEquipment","All"] },
      { key: "bHardcore", label: "Hardcore", type: "bool", help: "Enables hardcore character death and prevents normal respawning. Use with the other hardcore options.", evidence: "official" },
      { key: "bPalLost", label: "Pals lost on death (hardcore)", type: "bool", help: "When on, permanently removes party Pals on player death. This can delete substantial breeding progress.", evidence: "official" },
      { key: "bCharacterRecreateInHardcore", label: "Recreate character (hardcore)", type: "bool", help: "When on, a player may create a replacement character after hardcore death; off can make one death final.", evidence: "official" },
    ] },
    { id: "randomizer", title: "Randomizer", description: "Randomized Pal distribution, seed, and level behavior.", fields: [
      { key: "RandomizerType", label: "Randomizer type", type: "select", help: "None keeps normal Pal spawns; Region randomizes within regions; All randomizes across the world.", evidence: "official", options: ["None","Region","All"] },
      { key: "RandomizerSeed", label: "Randomizer seed", type: "text", help: "Seed for reproducible randomized Pal spawns. Changing it changes the distribution; it is ignored when randomization is off.", evidence: "official" },
      { key: "bIsRandomizerPalLevelRandom", label: "Randomize Pal levels", type: "bool", help: "On fully randomizes wild Pal levels; off keeps randomized levels within each area's intended range.", evidence: "official" },
    ] },
    { id: "time-progression", title: "Time & Progression", description: "Day and night timing, experience gain, and work speed.", fields: [
      { key: "DayTimeSpeedRate", label: "Day speed", type: "float", help: "Daytime clock-speed multiplier. Higher makes daytime pass faster and become shorter; lower makes it pass slower and last longer.", evidence: "official" },
      { key: "NightTimeSpeedRate", label: "Night speed", type: "float", help: "Nighttime clock-speed multiplier. Higher makes night pass faster and become shorter; lower makes it pass slower and last longer.", evidence: "official" },
      { key: "ExpRate", label: "EXP rate", type: "float", help: "Experience gain multiplier. Higher speeds progression; lower slows it.", evidence: "official" },
      { key: "WorkSpeedRate", label: "Work speed", type: "float", help: "General base-Pal work-speed multiplier. Higher completes crafting and base work faster; lower makes work slower.", evidence: "official" },
      { key: "MonsterFarmActionSpeedRate", label: "Ranch Pal work speed", type: "float", help: "Ranch/grazing production-speed multiplier. Higher produces ranch items faster; lower produces them more slowly.", evidence: "official" },
    ] },
    { id: "travel-respawn", title: "Travel & Respawn", description: "Fast travel, starting locations, and respawn penalties.", fields: [
      { key: "bEnableFastTravel", label: "Fast travel", type: "bool", help: "Enables fast travel. Off disables it entirely; on remains subject to the base-only restriction below.", evidence: "official" },
      { key: "bEnableFastTravelOnlyBaseCamp", label: "Fast travel: base only", type: "bool", help: "On restricts fast travel to between bases; off permits normal fast travel. Useful for preventing PvP combat escape.", evidence: "official" },
      { key: "bIsStartLocationSelectByMap", label: "Choose start on map", type: "bool", help: "On lets new players choose their starting location on the map; off uses normal starting behavior.", evidence: "official" },
      { key: "BlockRespawnTime", label: "Respawn block time (s)", type: "float", help: "Base delay before respawn. Higher forces a longer wait after death; lower allows faster respawning.", evidence: "official" },
      { key: "RespawnPenaltyDurationThreshold", label: "Respawn penalty threshold", type: "float", help: "Survival-time threshold used by the repeated-death penalty. A positive value defines how long a player must survive before escalation resets; 0 disables the time window.", evidence: "official" },
      { key: "RespawnPenaltyTimeScale", label: "Respawn penalty scale", type: "float", help: "Multiplier applied to respawn delay when the repeated-death penalty triggers. Higher escalates the wait more strongly; lower softens it.", evidence: "official" },
    ] },
  ] },
  { id: "players-pals", title: "Players & Pals", description: "Player and Pal attributes, survival rates, enhancement, and input assistance.", sections: [
    { id: "player-stats", title: "Player Stats", description: "Player combat, survival, regeneration, and carrying capacity.", fields: [
      { key: "PlayerDamageRateAttack", label: "Player attack damage", type: "float", help: "Player damage-dealt multiplier. Higher strengthens player attacks; lower weakens them.", evidence: "official" },
      { key: "PlayerDamageRateDefense", label: "Player damage received", type: "float", help: "Player damage-received multiplier despite the legacy \u201cdefense\u201d name. Higher makes players take more damage; lower makes them tougher.", evidence: "official" },
      { key: "PlayerStomachDecreaceRate", label: "Player hunger drain", type: "float", help: "Player hunger-depletion multiplier. Higher makes players hungry faster; lower slows hunger.", evidence: "official" },
      { key: "PlayerStaminaDecreaceRate", label: "Player stamina drain", type: "float", help: "Player stamina-depletion multiplier. Higher drains stamina faster; lower makes it last longer.", evidence: "official" },
      { key: "PlayerAutoHPRegeneRate", label: "Player HP regen", type: "float", help: "Natural player HP-regeneration multiplier. Higher restores HP faster; lower restores it more slowly.", evidence: "official" },
      { key: "PlayerAutoHpRegeneRateInSleep", label: "Player HP regen (sleep)", type: "float", help: "Player HP regeneration while sleeping. Higher restores HP faster; lower restores it more slowly.", evidence: "official" },
      { key: "ItemWeightRate", label: "Item weight rate", type: "float", help: "Item-weight multiplier. Higher makes items heavier and reduces effective capacity; lower makes them lighter.", evidence: "official" },
    ] },
    { id: "stat-enhancement", title: "Stat Enhancement", description: "Choose which player attributes may be enhanced.", fields: [
      { key: "bAllowEnhanceStat_Health", label: "Enhance: Health", type: "bool", help: "Allows new enhancement-point allocations to Health. Off blocks new allocations; it does not document removal of points already spent.", evidence: "official" },
      { key: "bAllowEnhanceStat_Attack", label: "Enhance: Attack", type: "bool", help: "Allows new enhancement-point allocations to Attack. Pocketpair recommends disabling Attack and Health in some PvP rule sets.", evidence: "official" },
      { key: "bAllowEnhanceStat_Stamina", label: "Enhance: Stamina", type: "bool", help: "Allows new enhancement-point allocations to Stamina; off blocks them.", evidence: "official" },
      { key: "bAllowEnhanceStat_Weight", label: "Enhance: Weight", type: "bool", help: "Allows new enhancement-point allocations to Carry Weight; off blocks them.", evidence: "official" },
      { key: "bAllowEnhanceStat_WorkSpeed", label: "Enhance: Work speed", type: "bool", help: "Allows new enhancement-point allocations to Work Speed; off blocks them.", evidence: "official" },
    ] },
    { id: "pal-stats", title: "Pal Stats", description: "Pal capture, population, combat, survival, recovery, and breeding rates.", fields: [
      { key: "PalCaptureRate", label: "Capture rate", type: "float", help: "Capture-chance multiplier. Higher makes captures easier; lower makes them harder.", evidence: "official" },
      { key: "PalSpawnNumRate", label: "Pal spawn rate", type: "float", help: "Wild Pal spawn-density multiplier. Higher creates more Pals and raises CPU/memory load; lower creates fewer.", evidence: "official" },
      { key: "PalDamageRateAttack", label: "Pal attack damage", type: "float", help: "Pal damage-dealt multiplier. Higher strengthens Pal attacks; lower weakens them.", evidence: "official" },
      { key: "PalDamageRateDefense", label: "Pal damage received", type: "float", help: "Pal damage-received multiplier despite the legacy \u201cdefense\u201d name. Higher makes Pals take more damage; lower makes them tougher.", evidence: "official" },
      { key: "PalStomachDecreaceRate", label: "Pal hunger drain", type: "float", help: "Pal hunger-depletion multiplier. Higher makes Pals hungry faster; lower slows hunger. The misspelling is part of the real key.", evidence: "official" },
      { key: "PalStaminaDecreaceRate", label: "Pal stamina drain", type: "float", help: "Pal stamina-depletion multiplier. Higher drains stamina faster; lower makes it last longer.", evidence: "official" },
      { key: "PalAutoHPRegeneRate", label: "Pal HP regen", type: "float", help: "Natural Pal HP-regeneration multiplier. Higher restores HP faster; lower restores it more slowly.", evidence: "official" },
      { key: "PalAutoHpRegeneRateInSleep", label: "Pal HP regen (sleep)", type: "float", help: "Pal HP regeneration while sleeping/in the Palbox. Higher restores HP faster; lower restores it more slowly.", evidence: "official" },
      { key: "PalEggDefaultHatchingTime", label: "Egg hatching time (h)", type: "float", help: "Base incubation time for a Huge Egg; other sizes scale from it. Higher lengthens incubation; lower shortens it; 0 is commonly used for instant incubation.", evidence: "official" },
      { key: "EnablePredatorBossPal", label: "Predator boss Pals", type: "bool", help: "Enables roaming Predator boss Pals. Off removes this encounter type.", evidence: "official" },
    ] },
    { id: "input-assistance", title: "Input Assistance", description: "Aim-assist behavior for controller and keyboard players.", fields: [
      { key: "bEnableAimAssistPad", label: "Aim assist (pad)", type: "bool", help: "Enables controller aim assistance; off disables it.", evidence: "official" },
      { key: "bEnableAimAssistKeyboard", label: "Aim assist (keyboard)", type: "bool", help: "Enables mouse/keyboard aim assistance; off leaves it disabled.", evidence: "official" },
    ] },
  ] },
  { id: "world-bases", title: "World & Bases", description: "Resources, drops, world events, construction, and base limits.", sections: [
    { id: "resources-drops", title: "Resources & Drops", description: "Gathering, item drops, object health, durability, and item lifetime.", fields: [
      { key: "CollectionDropRate", label: "Gather drop rate", type: "float", help: "Gatherable-resource yield multiplier. Higher gives more ore, wood, and similar resources per gather; lower gives fewer.", evidence: "official" },
      { key: "CollectionObjectHpRate", label: "Gatherable HP", type: "float", help: "Gatherable-object health multiplier. Higher requires more damage to break a node; lower makes it easier.", evidence: "official" },
      { key: "CollectionObjectRespawnSpeedRate", label: "Gatherable respawn interval", type: "float", help: "Gatherable respawn-interval multiplier despite \u201cspeed\u201d in the name. Higher means slower respawns; lower means faster respawns. 0.5 is roughly twice as fast.", evidence: "official" },
      { key: "EnemyDropItemRate", label: "Enemy drop rate", type: "float", help: "Enemy loot-quantity multiplier. Higher produces more enemy loot; lower produces less.", evidence: "official" },
      { key: "DropItemMaxNum", label: "Max dropped items", type: "int", help: "Maximum dropped items retained in the world. Higher permits more clutter and memory/physics work; lower removes excess drops sooner.", evidence: "official" },
      { key: "PhysicsActiveDropItemMaxNum", label: "Max physics-simulated drops", type: "int", help: "Maximum dropped items allowed to use full physics behavior. A positive cap can reduce physics load; a higher cap permits more simultaneously simulated drops.", evidence: "official" },
      { key: "DropItemMaxNum_UNKO", label: "Max dropped (UNKO)", type: "int", help: "Separate maximum for Pal waste drops. Higher permits more waste objects; lower limits buildup.", evidence: "official" },
      { key: "DropItemAliveMaxHours", label: "Dropped item lifetime (h)", type: "float", help: "Dropped-item lifetime. Higher keeps drops longer and can increase world load; lower cleans them up sooner.", evidence: "official" },
      { key: "EquipmentDurabilityDamageRate", label: "Equipment durability loss", type: "float", help: "Equipment durability-loss multiplier. Higher wears equipment faster; lower makes it last longer.", evidence: "official" },
      { key: "ItemCorruptionMultiplier", label: "Item corruption rate", type: "float", help: "Perishable-item spoilage-speed multiplier. Higher spoils items faster; lower preserves them longer.", evidence: "official" },
    ] },
    { id: "world-events-rules", title: "World Events & Rules", description: "Supply drops, raids, camps, fishing, technologies, and other world rules.", fields: [
      { key: "SupplyDropSpan", label: "Meteor/Supply drop interval (min)", type: "int", help: "Meteorite/supply-drop interval. Higher makes events less frequent; lower makes them more frequent. The official unit is minutes, not seconds.", evidence: "official" },
      { key: "bEnableInvaderEnemy", label: "Raid invaders", type: "bool", help: "Enables base invasion/raid events. Off disables raids; raids add AI activity and server load.", evidence: "official" },
      { key: "bActiveUNKO", label: "Active UNKO", type: "bool", help: "Enables Pal waste-object production. On can add dropped-object clutter; off prevents it.", evidence: "official" },
      { key: "FishingDifficultyRate", label: "Fishing difficulty", type: "float", help: "Fishing-difficulty multiplier. Lower makes fishing easier; higher makes it harder.", evidence: "official", min: 0.1, max: 1 },
      { key: "bAllowEnemyCampSpawnNearBaseCamp", label: "Enemy camps near player bases", type: "bool", help: "On allows enemy camps to spawn close to player bases; off keeps them farther away.", evidence: "official" },
      { key: "DenyTechnologyList", label: "Denied technologies", type: "tuple", help: "Technology IDs players may not unlock. Add IDs to prohibit them; remove IDs to permit them. Exact tuple syntax and valid IDs are required.", evidence: "official", allowEmpty: true },
    ] },
    { id: "building-base-camps", title: "Building & Base Camps", description: "Structure durability, base capacity, workers, building limits, and display rules.", fields: [
      { key: "BuildObjectHpRate", label: "Structure HP", type: "float", help: "Structure-health multiplier. Higher makes structures tougher; lower makes them easier to destroy.", evidence: "official" },
      { key: "BuildObjectDamageRate", label: "Structure damage", type: "float", help: "Structure damage-received multiplier. Higher makes structures take more damage; lower makes them tougher.", evidence: "official" },
      { key: "BuildObjectDeteriorationDamageRate", label: "Structure deterioration", type: "float", help: "Structure-decay multiplier. Higher accelerates decay; lower slows it; 0 disables deterioration.", evidence: "official" },
      { key: "BaseCampMaxNum", label: "Max base camps", type: "int", help: "Total bases across the server. Higher allows more bases but raises processing/save load; lower constrains total growth.", evidence: "official" },
      { key: "BaseCampWorkerMaxNum", label: "Max workers/base", type: "int", help: "Maximum working Pals at one base. Higher allows more workers and raises processing load; lower limits them. Behavior above 15 should be verified in game.", evidence: "official", max: 50 },
      { key: "BaseCampMaxNumInGuild", label: "Max bases/guild", type: "int", help: "Maximum bases per guild. Higher permits more bases and raises load, but progression may still gate slot unlocks; lower caps expansion.", evidence: "official", max: 10 },
      { key: "MaxBuildingLimitNum", label: "Max buildings server-wide (0=unlimited)", type: "int", help: "Server-wide structure-count cap in current releases. A positive value limits total structures; higher allows more building but raises load. Older documentation described this as per-player.", evidence: "uncertain" },
      { key: "MaxBuildingLimitNumPerPlayer", label: "Max buildings/player (0=unlimited)", type: "int", help: "Per-player structure-count cap. A positive value limits each player separately; higher permits more structures per player.", evidence: "uncertain" },
      { key: "bBuildAreaLimit", label: "Build area limit", type: "bool", help: "On prevents building near important locations such as spawn and fast-travel points; off uses the broader normal build rules.", evidence: "official" },
      { key: "bEnableBuildingPlayerUIdDisplay", label: "Show builder on structures", type: "bool", help: "On shows the builder's player ID on structures to help moderation; off hides it.", evidence: "official" },
    ] },
  ] },
  { id: "multiplayer", title: "Multiplayer", description: "PvP, guilds, communication, player access, crossplay, and shared Pal storage.", sections: [
    { id: "pvp-player-presence", title: "PvP & Player Presence", description: "Multiplayer state, PvP damage, logout behavior, map visibility, and kill rewards.", fields: [
      { key: "bEnablePlayerToPlayerDamage", label: "PvP damage", type: "bool", help: "Allows players to damage one another. It is one of three settings required for working PvP.", evidence: "official" },
      { key: "bEnableFriendlyFire", label: "Friendly fire", type: "bool", help: "On permits damage between members of the same guild; off protects guildmates.", evidence: "official" },
      { key: "bIsPvP", label: "PvP mode", type: "bool", help: "Master PvP mode. Working PvP also requires player damage and other-guild defense to be on.", evidence: "official" },
      { key: "bIsMultiplay", label: "Multiplay flag", type: "bool", help: "Legacy multiplayer/co-op-session flag. Pocketpair does not document a useful dedicated-server effect; leave at default unless a tested workflow requires it.", evidence: "uncertain" },
      { key: "bEnableNonLoginPenalty", label: "Non-login penalty", type: "bool", help: "Enables penalties for extended non-login. Pocketpair does not currently explain the exact dedicated-server effect.", evidence: "uncertain" },
      { key: "bExistPlayerAfterLogout", label: "Body persists after logout", type: "bool", help: "On leaves a sleeping player body at the logout location, making logout unsafe as a combat escape; off removes it normally.", evidence: "official" },
      { key: "bDisplayPvPItemNumOnWorldMap_BaseCamp", label: "Show PvP items on map (base)", type: "bool", help: "On shows PvP-exclusive item counts at bases on the map; off hides them.", evidence: "official" },
      { key: "bDisplayPvPItemNumOnWorldMap_Player", label: "Show PvP items on map (player)", type: "bool", help: "On shows player locations and PvP-exclusive item counts on the map; off hides them.", evidence: "official" },
      { key: "bAdditionalDropItemWhenPlayerKillingInPvPMode", label: "Enable PvP kill drops", type: "bool", help: "Enables the configured extra item drop when a player is killed in PvP.", evidence: "official" },
      { key: "AdditionalDropItemWhenPlayerKillingInPvPMode", label: "PvP kill drop item", type: "text", help: "Item ID for the extra PvP-kill reward. Change it to a valid ID; it is ignored while extra drops are off.", evidence: "official" },
      { key: "AdditionalDropItemNumWhenPlayerKillingInPvPMode", label: "PvP kill drop count", type: "int", help: "Extra PvP reward quantity. Higher drops more per kill; lower drops fewer.", evidence: "official" },
    ] },
    { id: "guilds", title: "Guilds", description: "Guild membership, resets, defense, looting, cooldowns, and leadership transfer.", fields: [
      { key: "GuildPlayerMaxNum", label: "Max guild players", type: "int", help: "Maximum guild membership. Higher permits larger guilds; lower creates smaller groups.", evidence: "official" },
      { key: "bAutoResetGuildNoOnlinePlayers", label: "Auto-reset empty guilds", type: "bool", help: "Enables deletion of fully inactive guilds' structures and base Pals after the threshold below. This is destructive.", evidence: "official" },
      { key: "AutoResetGuildTimeNoOnlinePlayers", label: "Guild reset time (h)", type: "float", help: "Inactivity before automatic guild reset. Higher gives guilds more time; lower deletes property sooner. Ignored when auto-reset is off.", evidence: "official" },
      { key: "bEnableDefenseOtherGuildPlayer", label: "Defend vs other guilds", type: "bool", help: "On lets base Pals attack trespassers from other guilds and is part of Pocketpair's required PvP combination.", evidence: "official" },
      { key: "bCanPickupOtherGuildDeathPenaltyDrop", label: "Loot other guild drops", type: "bool", help: "On allows looting another guild's death drops; off preserves normal ownership rules.", evidence: "official" },
      { key: "bInvisibleOtherGuildBaseCampAreaFX", label: "Hide other guild base FX", type: "bool", help: "Controls other guilds' base-boundary effects. The negative key conflicts with Pocketpair's positive description; treat on as \u201chide\u201d but verify visually.", evidence: "uncertain" },
      { key: "GuildRejoinCooldownMinutes", label: "Guild rejoin cooldown (m)", type: "int", help: "Delay before rejoining a guild after leaving. Higher enforces a longer wait; 0 permits immediate rejoining.", evidence: "official" },
      { key: "AutoTransferMasterCheckIntervalSeconds", label: "Guild master transfer check (s)", type: "float", help: "How often the server checks whether an inactive guild master qualifies for automatic transfer. Lower checks more often; higher delays detection.", evidence: "official" },
      { key: "AutoTransferMasterThresholdDays", label: "Guild master inactivity threshold (days)", type: "int", help: "Guild-master inactivity required before automatic transfer. Lower transfers sooner; higher gives the current master more time to return.", evidence: "official" },
    ] },
    { id: "voice-chat", title: "Voice Chat", description: "Proximity voice-chat availability and audible distance.", fields: [
      { key: "bEnableVoiceChat", label: "Enable proximity voice chat", type: "bool", help: "Enables dedicated-server proximity voice chat. Off requires another voice service.", evidence: "official" },
      { key: "VoiceChatMaxVolumeDistance", label: "Full-volume distance", type: "float", help: "Distance within which voice remains at full volume. Higher keeps it loud farther away; lower starts attenuation sooner. Keep below the silence distance.", evidence: "official" },
      { key: "VoiceChatZeroVolumeDistance", label: "Silence distance", type: "float", help: "Distance at which voice becomes inaudible. Higher lets voices carry farther; lower makes them fade sooner.", evidence: "official" },
    ] },
    { id: "access-crossplay", title: "Access & Crossplay", description: "Player capacity, supported platforms, mods, and community visibility.", fields: [
      { key: "CoopPlayerMaxNum", label: "Co-op max players", type: "int", help: "Intended co-op party-size cap. It is widely reported not to control dedicated-server capacity; use ServerPlayerMaxNum for that.", evidence: "uncertain" },
      { key: "ServerPlayerMaxNum", label: "Server max players", type: "int", help: "Maximum concurrent dedicated-server players. Higher admits more players and raises load; lower provides fewer slots. The supported/default ceiling is 32.", evidence: "official" },
      { key: "CrossplayPlatforms", label: "Crossplay platforms", type: "multi-select", help: "Platforms allowed to connect. Select one or more supported platforms; PSM writes the required tuple syntax to the INI. Console/Game Pass users rely on the community browser.", evidence: "official", options: ["Steam", "Xbox", "PS5", "Mac"], presentation: "wide" },
      { key: "bAllowClientMod", label: "Allow client mods", type: "bool", help: "Allows mod-enabled clients to connect. Off rejects them; on does not install or validate their mods.", evidence: "official" },
      { key: "bShowPlayerList", label: "Show player list", type: "bool", help: "On shows the online player list in the ESC menu; off hides it.", evidence: "official" },
      { key: "bIsShowJoinLeftMessage", label: "Show join/leave msgs", type: "bool", help: "On announces joins/leaves in game; off suppresses those messages.", evidence: "official" },
      { key: "ChatPostLimitPerMinute", label: "Chat rate limit/min", type: "int", help: "Per-player chat rate limit. Higher permits faster posting; lower reduces spam but may impede conversation.", evidence: "official" },
    ] },
    { id: "global-palbox", title: "Global Palbox", description: "Global Palbox export and import policy.", fields: [
      { key: "bAllowGlobalPalboxExport", label: "Global Palbox export", type: "bool", help: "Allows exporting this world's Pals to the account-wide Global Palbox. Off keeps them local.", evidence: "official" },
      { key: "bAllowGlobalPalboxImport", label: "Global Palbox import", type: "bool", help: "Allows importing outside Pals. On lets players bring advanced Pals into the server; off protects local progression.", evidence: "official" },
    ] },
  ] },
  { id: "server-admin", title: "Server Admin", description: "Server identity, connectivity, access, lifecycle, performance, and installation.", sections: [
    { id: "server-identity", title: "Server Identity", description: "The local PSM name and the identity Palworld presents to players.", managed: "identity", fields: [
      { key: "ServerName", label: "Server name", type: "text", help: "Name shown to players in the community-server browser. Display Name also follows this value unless a separate Display Name override is set.", evidence: "official" },
      { key: "ServerDescription", label: "Description", type: "text", help: "Description shown with the listing. Empty shows no custom description.", evidence: "official", presentation: "wide" },
      { key: "Region", label: "Region", type: "text", help: "Region label for listing/filtering. It does not change hosting location or latency.", evidence: "official" },
    ], layout: [
      { keys: ["ServerName"], span: 6 }, { keys: ["displayName"], span: 6 },
      { keys: ["Region"], span: 4, presentation: "compact" }, { keys: ["ServerDescription"], span: 8, presentation: "wide" },
    ] },
    { id: "community-listing", title: "Community Listing", description: "Community-browser visibility and the public address advertised through NAT or tunnels.", managed: "listing", fields: [
      { key: "PublicIP", label: "Public IP (for tunnels)", type: "text", help: "External IP advertised by a community server. Set only when detection is wrong or a tunnel requires it; it does not bind the listener.", evidence: "official" },
    ], layout: [
      { keys: ["communityServer"], span: 12, presentation: "lead" },
      { keys: ["PublicIP"], span: 8, presentation: "wide" }, { keys: ["publicPort"], span: 4, presentation: "compact" },
    ] },
    { id: "network-ports", title: "Network & Ports", description: "Local game, query, REST API, and RCON listeners.", managed: "network", fields: [], layout: [
      { keys: ["gamePort"], span: 6 }, { keys: ["queryPort"], span: 6 },
      { keys: ["restApiEnabled", "restApiPort"], span: 6, grouped: true }, { keys: ["rconEnabled", "rconPort"], span: 6, grouped: true },
    ] },
    { id: "access-security", title: "Access & Security", description: "Player and administrator credentials, platform authentication, and moderation feeds.", fields: [
      { key: "ServerPassword", label: "Server password", type: "password", help: "Password players must enter to join. Palworld stores this value in plaintext in PalWorldSettings.ini and server backups.", evidence: "official" },
      { key: "AdminPassword", label: "Administrator password", type: "password", help: "Credential used by Palworld REST and RCON administration. Palworld stores it in plaintext in PalWorldSettings.ini and server backups.", evidence: "official" },
      { key: "bUseAuth", label: "Require auth", type: "bool", help: "Platform identity authentication. Turning it off weakens access security and is not normally useful.", evidence: "official" },
      { key: "BanListURL", label: "Ban list URL", type: "text", help: "Remote global ban-list feed. It is not the server's local player-ban file; do not use an untrusted URL.", evidence: "official", presentation: "wide" },
    ], layout: [
      { keys: ["ServerPassword"], span: 6 }, { keys: ["AdminPassword"], span: 6 },
      { keys: ["bUseAuth"], span: 4, presentation: "compact" }, { keys: ["BanListURL"], span: 8, presentation: "wide" },
    ] },
    { id: "lifecycle-recovery", title: "Lifecycle & Recovery", description: "Automatic startup and process recovery behavior.", managed: "lifecycle", fields: [], layout: [
      { keys: ["autostart"], span: 6 }, { keys: ["crashGuard"], span: 6 },
    ] },
    { id: "saving-logs", title: "Saving & Logs", description: "World saving, rolling backup protection, and log format.", fields: [
      { key: "AutoSaveSpan", label: "Auto-save interval (s)", type: "float", help: "Time between automatic world saves. Lower saves more often but increases disk work; higher reduces disk work but increases possible crash-related progress loss.", evidence: "official" },
      { key: "bIsUseBackupSaveData", label: "Rolling save backups", type: "bool", help: "Enables Palworld's own rolling backups inside save data. On increases disk activity and is separate from manager-created backup archives.", evidence: "official" },
      { key: "LogFormatType", label: "Log format", type: "select", help: "Text is human-readable; Json is structured for log-processing tools.", evidence: "official", options: ["Text","Json"] },
    ], layout: [
      { keys: ["AutoSaveSpan"], span: 4 }, { keys: ["bIsUseBackupSaveData"], span: 4 }, { keys: ["LogFormatType"], span: 4 },
    ] },
    { id: "performance-synchronization", title: "Performance & Synchronization", description: "Process performance, replication, synchronization intervals, and caches.", managed: "performance", fields: [
      { key: "ServerReplicatePawnCullDistance", label: "Pal synchronization distance (cm)", type: "float", help: "Pal synchronization distance. Higher shows distant Pals but costs bandwidth/processing; lower reduces load but causes later pop-in.", evidence: "official", min: 5000, max: 15000 },
      { key: "ItemContainerForceMarkDirtyInterval", label: "Open-container resync interval (s)", type: "float", help: "Forced re-sync interval while a container UI is open. Higher syncs less often and may feel laggy; lower syncs more often and increases work.", evidence: "official" },
      { key: "PlayerDataPalStorageUpdateCheckTickInterval", label: "Pal storage check interval (s)", type: "float", help: "Interval between player Pal-storage update checks. Higher checks less often; lower checks more frequently. Pocketpair does not currently publish a safe range.", evidence: "uncertain" },
      { key: "MaxGuildsPerFrame", label: "Guilds processed per frame", type: "int", help: "Maximum guilds processed in one server frame. Higher processes more work per frame; lower spreads work over more frames. Pocketpair does not currently document tuning guidance.", evidence: "uncertain" },
      { key: "BuildingNameDisplayCacheTTLSeconds", label: "Builder-name cache lifetime (s)", type: "int", help: "Lifetime of cached builder-name lookups for structures. Higher retains cached names longer; lower refreshes them more often.", evidence: "uncertain" },
    ], layout: [
      { keys: ["legacyPerfFlags"], span: 12, presentation: "lead" },
      { keys: ["ServerReplicatePawnCullDistance"], span: 6 }, { keys: ["ItemContainerForceMarkDirtyInterval"], span: 6 },
      { keys: ["PlayerDataPalStorageUpdateCheckTickInterval"], span: 4 }, { keys: ["MaxGuildsPerFrame"], span: 4 }, { keys: ["BuildingNameDisplayCacheTTLSeconds"], span: 4 },
    ] },
    { id: "installation-launch", title: "Installation & Launch", description: "Server location, platform, launch arguments, Wine, and environment configuration.", managed: "launch", fields: [], layout: [
      { keys: ["platform"], span: 4 }, { keys: ["installDir"], span: 8, presentation: "wide" },
      { keys: ["extraArgs"], span: 12, presentation: "wide" }, { keys: ["environment"], span: 12, presentation: "wide" },
      { keys: ["wineBinary"], span: 6 }, { keys: ["winePrefix"], span: 6 }, { keys: ["wineLaunchFlags"], span: 12, presentation: "wide" },
    ] },
    { id: "registration-removal", title: "Registration & Removal", description: "Export this PSM registration or remove it without deleting server files.", managed: "registration", fields: [], layout: [
      { keys: ["registrationActions"], span: 12, presentation: "wide" },
    ] },
  ] },
];

export const PALWORLD_SETTING_FIELDS: readonly PalworldSettingField[] = PALWORLD_SETTING_TABS.flatMap((tab) => tab.sections.flatMap((section) => section.fields));
export const PALWORLD_SETTING_FIELD_MAP = new Map(PALWORLD_SETTING_FIELDS.map((field) => [field.key, field]));

export function settingPresentation(field: PalworldSettingField): PalworldSettingPresentation {
  return field.presentation ?? (field.type === "tuple" || field.type === "multi-select" ? "wide" : field.type === "text" || field.type === "password" ? "standard" : "compact");
}

export function settingLayoutSpan(presentation: PalworldSettingPresentation): 4 | 6 | 12 {
  return presentation === "compact" ? 4 : presentation === "standard" ? 6 : 12;
}

function quotedString(raw: string): string | undefined {
  if (!raw.startsWith('"') || !raw.endsWith('"')) return undefined;
  try { const value: unknown = JSON.parse(raw); return typeof value === "string" ? value : undefined; } catch { return undefined; }
}

export function validTuple(raw: string, allowEmpty = false): boolean {
  if (allowEmpty && raw === "") return true;
  if (!raw.startsWith("(") || !raw.endsWith(")") || /[\r\n\0]/.test(raw) || raw.length > 8_192) return false;
  const scan = scanTuple(raw);
  return !scan.quoted && !scan.escaped && scan.depth === 0 && !scan.negative && scan.closedAt === raw.length - 1;
}

function tupleOptions(raw: string, options: readonly string[]): string[] | undefined {
  if (!/^\([^()]*\)$/.test(raw)) return undefined;
  const values = raw.slice(1, -1).split(",").map((value) => value.trim()).filter(Boolean);
  if (!values.length || new Set(values).size !== values.length || values.some((value) => !options.includes(value))) return undefined;
  return options.filter((option) => values.includes(option));
}

export function decodeSettingValue(field: PalworldSettingField, raw: string | undefined): DecodedSettingValue {
  if (raw == null) return { status: "missing" };
  if (raw.length > 8_192 || /[\r\n\0]/.test(raw)) return { status: "invalid", raw, reason: "Value contains unsupported characters or exceeds the size limit." };
  if (field.type === "bool") {
    return raw === "True" || raw === "False" ? { status: "valid", value: raw === "True", raw } : { status: "invalid", raw, reason: "Expected True or False." };
  }
  if (field.type === "int" || field.type === "float") {
    const numericSyntax = field.type === "int" ? /^-?\d+$/ : /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
    if (!numericSyntax.test(raw)) return { status: "invalid", raw, reason: `Expected a valid ${field.type === "int" ? "whole number" : "number"}.` };
    const value = Number(raw);
    if (!Number.isFinite(value) || (field.type === "int" && !Number.isInteger(value))) return { status: "invalid", raw, reason: `Expected a valid ${field.type === "int" ? "whole number" : "number"}.` };
    if (field.min != null && value < field.min) return { status: "invalid", raw, reason: `Value is lower than ${field.min}.` };
    if (field.max != null && value > field.max) return { status: "invalid", raw, reason: `Value is higher than ${field.max}.` };
    return { status: "valid", value, raw };
  }
  if (field.type === "text" || field.type === "password") {
    const value = quotedString(raw);
    return value == null ? { status: "invalid", raw, reason: "Expected a quoted string." } : { status: "valid", value, raw };
  }
  if (field.type === "select") {
    const value = quotedString(raw) ?? raw;
    return field.options?.includes(value) ? { status: "valid", value, raw } : { status: "invalid", raw, reason: `Expected one of: ${field.options?.join(", ")}.` };
  }
  if (field.type === "multi-select") {
    const value = tupleOptions(raw, field.options ?? []);
    return value ? { status: "valid", value, raw } : { status: "invalid", raw, reason: `Expected one or more of: ${field.options?.join(", ")}.` };
  }
  if (validTuple(raw, field.allowEmpty)) return { status: "valid", value: raw, raw };
  return { status: "invalid", raw, reason: field.allowEmpty ? "Expected an empty value or balanced tuple." : "Expected a balanced tuple." };
}

export function decodeDefaultSettingValue(field: PalworldSettingField, raw: string | undefined): DecodedSettingValue {
  const decoded = decodeSettingValue(field, raw);
  return decoded.status === "invalid" ? { ...decoded, status: "unsupported-default" } : decoded;
}

export function encodeSettingValue(field: PalworldSettingField, value: unknown): string {
  if (field.type === "bool") { if (typeof value !== "boolean") throw new Error(`${field.label} must be on or off.`); return value ? "True" : "False"; }
  if (field.type === "int" || field.type === "float") {
    if (typeof value !== "number" || !Number.isFinite(value) || (field.type === "int" && !Number.isInteger(value))) throw new Error(`${field.label} must be a valid ${field.type === "int" ? "whole number" : "number"}.`);
    if (field.min != null && value < field.min) throw new Error(`${field.label} cannot be lower than ${field.min}.`);
    if (field.max != null && value > field.max) throw new Error(`${field.label} cannot be higher than ${field.max}.`);
    return String(value);
  }
  if (field.type === "multi-select") {
    const options = field.options ?? [];
    if (!Array.isArray(value) || !value.length || value.some((entry) => typeof entry !== "string" || !options.includes(entry)) || new Set(value).size !== value.length) throw new Error(`${field.label} must include one or more of: ${options.join(", ")}.`);
    return `(${options.filter((option) => value.includes(option)).join(",")})`;
  }
  if (typeof value !== "string" || value.length > 8_192 || /[\r\n\0]/.test(value)) throw new Error(`${field.label} contains an invalid value.`);
  if (field.type === "select") { if (!field.options?.includes(value)) throw new Error(`${field.label} must be one of: ${field.options?.join(", ")}.`); return value; }
  if (field.type === "tuple") { if (!validTuple(value, field.allowEmpty)) throw new Error(`${field.label} must be ${field.allowEmpty ? "empty or " : ""}a balanced tuple.`); return value; }
  return JSON.stringify(value);
}

export function validateAndEncodeSettingChanges(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Configuration changes must be an object.");
  const entries = Object.entries(raw as Record<string, unknown>);
  if (!entries.length || entries.length > PALWORLD_SETTING_FIELDS.length) throw new Error("Select between 1 and " + PALWORLD_SETTING_FIELDS.length + " settings to change.");
  return Object.fromEntries(entries.map(([key, value]) => {
    const field = PALWORLD_SETTING_FIELD_MAP.get(key);
    if (!field) throw new Error(`Unknown structured setting: ${key}`);
    return [key, encodeSettingValue(field, value)];
  }));
}
