-- PSM_MOD_VERSION 1
-- PSMDeathRelay: records player deaths for Palworld Server Manager.
--
-- Appends one JSON line per player death to Pal/Saved/psm-deaths.jsonl, which the manager
-- reads into the world's Deaths tab:
--   {"victim":"…","cause":"Attack","killer":"KingSunfish","killerKind":"pal","at":<ms>}
-- killer is a player name, or a Pal/NPC species codename; it is empty for environmental deaths.
--
-- Hooks:
--   PalPlayerCharacter:OnDamagePlayer_Server   remembers each victim's latest attacker
--   PalBattleManager:EventOnPlayerDeadCompletely  fires once per death, for every cause
-- Every UObject is checked with IsValid() before a property read. UE4SS needs a complete
-- MemberVariableLayout.ini; without it, marshalling hooked parameters can crash the server
-- (the manager refuses to start UE4SS without that file).

-- The manager replaces the placeholder with this world's absolute output path. The relative
-- fallback covers a hand install: UE4SS runs with the working directory in Pal/Binaries/<platform>.
local CANDIDATES = { [[__PSM_OUT_PATH__]], "../../Saved/psm-deaths.jsonl" }
local OUT_PATH = nil

local function resolve_out_path()
    if OUT_PATH then return OUT_PATH end
    for _, candidate in ipairs(CANDIDATES) do
        if candidate:sub(1, 2) ~= "__" then
            local file = io.open(candidate, "a")
            if file then
                file:close(); OUT_PATH = candidate
                print(string.format("[PSMDeathRelay] writing deaths to: %s\n", candidate))
                return OUT_PATH
            end
        end
    end
    return nil
end

local function escape(value)
    return (tostring(value or ""):gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n"):gsub("\r", "\\r"):gsub("\t", "\\t"))
end

local function now_ms() return math.floor(os.time() * 1000) end

local function append_death(victim, cause, killer, killer_kind)
    local path = resolve_out_path(); if not path then return end
    local ok, file = pcall(io.open, path, "a")
    if not ok or not file then OUT_PATH = nil; return end
    file:write(string.format('{"victim":"%s","cause":"%s","killer":"%s","killerKind":"%s","at":%d}\n',
        escape(victim), escape(cause), escape(killer), escape(killer_kind), now_ms()))
    file:close()
end

local function to_string(value)
    if value == nil then return "" end
    local ok, text = pcall(function() return value:ToString() end)
    if ok and text then return text end
    return tostring(value)
end

local function unwrap(param)
    if type(param) == "userdata" and param.get then
        local ok, value = pcall(function() return param:get() end); if ok then return value end
    end
    return param
end

-- IsValid() checks the engine's object table without dereferencing game memory, so it is
-- safe on null or stale handles.
local function is_valid(object)
    if type(object) ~= "userdata" then return false end
    local ok, valid = pcall(function() return object:IsValid() end)
    return ok and valid == true
end

local function player_name_of(character)
    if not is_valid(character) then return "" end
    local name = ""
    pcall(function()
        local controller = character:GetController(); if not is_valid(controller) then return end
        local state = controller.PlayerState; if not is_valid(state) then return end
        name = to_string(state.PlayerNamePrivate)
    end)
    return name
end

-- Players report their name; anything else reports its species codename (BP_KingSunfish_C -> KingSunfish).
local function classify_attacker(actor)
    if not is_valid(actor) then return "", "" end
    local full = ""
    pcall(function() full = actor:GetFullName() end)
    local class = full:match("^(%S+)") or ""
    if class:find("^BP_Player") then return player_name_of(actor), "player" end
    local species = class:gsub("^BP_", ""):gsub("_C$", "")
    if class:find("^BP_NPC") then return species, "npc" end
    return species, "pal"
end

local function dead_type_name(value)
    local name = nil
    pcall(function()
        local enum = StaticFindObject("/Script/Pal.EPalDeadType")
        if enum and enum.GetNameByValue then name = to_string(enum:GetNameByValue(value)) end
    end)
    if name and name ~= "" then return (name:gsub("^.*::", "")) end
    return tostring(value)
end

local KILL_WINDOW_MS = 15000
local last_attacker = {}

local function on_player_damaged(self, damage_param)
    pcall(function()
        local victim = unwrap(self); if not is_valid(victim) then return end
        local victim_name = player_name_of(victim); if victim_name == "" then return end
        local attacker = nil
        pcall(function() attacker = unwrap(damage_param).Attacker end)
        if not is_valid(attacker) then return end
        local name, kind = classify_attacker(attacker)
        if name ~= "" then last_attacker[victim_name] = { name = name, kind = kind, at = now_ms() } end
    end)
end

local function on_player_dead(self, victim_param, info_param)
    pcall(function()
        local victim = unwrap(victim_param); if not is_valid(victim) then return end
        local victim_name = player_name_of(victim); if victim_name == "" then return end
        local cause = ""
        pcall(function() local info = unwrap(info_param); if info then cause = dead_type_name(info.DeadType) end end)
        -- Only attack deaths with a recent attacker name a killer; falling, drowning, and the like stay killer-less.
        local killer, kind = "", ""
        local recent = last_attacker[victim_name]
        if recent and cause == "Attack" and (now_ms() - recent.at) <= KILL_WINDOW_MS then killer, kind = recent.name, recent.kind end
        last_attacker[victim_name] = nil
        append_death(victim_name, cause, killer, kind)
        print(string.format("[PSMDeathRelay] death: %s cause=%s killer=%s\n", victim_name, cause, killer))
    end)
end

-- The Pal classes are not loaded when mods start, so registration retries as the game loads.
local HOOKS = {
    { path = "/Script/Pal.PalPlayerCharacter:OnDamagePlayer_Server", fn = on_player_damaged, done = false },
    { path = "/Script/Pal.PalBattleManager:EventOnPlayerDeadCompletely", fn = on_player_dead, done = false },
}

local function try_register()
    local remaining = 0
    for _, hook in ipairs(HOOKS) do
        if not hook.done then
            if pcall(RegisterHook, hook.path, hook.fn) then hook.done = true; print("[PSMDeathRelay] hooked " .. hook.path .. "\n")
            else remaining = remaining + 1 end
        end
    end
    return remaining
end

resolve_out_path()
if try_register() > 0 then
    for _, delay in ipairs({ 8000, 20000, 45000 }) do ExecuteWithDelay(delay, function() pcall(try_register) end) end
end
print("[PSMDeathRelay] loaded\n")
