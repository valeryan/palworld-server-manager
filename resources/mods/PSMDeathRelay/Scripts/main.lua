-- PSMDeathRelay — Palworld Server Manager player-death relay
--
-- Detects player deaths server-side and appends one JSON line per death to
--   Pal/Saved/psm-deaths.jsonl
-- which the Palworld Server Manager app tails to log the death, name the killer, and
-- route it to Discord (killed-by-a-Pal / killed-by-a-player / environmental templates).
--
-- Two hooks:
--   * /Script/Pal.PalPlayerCharacter:OnDamagePlayer_Server(PalDamageResult)
--       fires whenever a player TAKES damage; .Attacker is who hit them. We remember the
--       most recent attacker per victim so a death can name its killer.
--   * /Script/Pal.PalBattleManager:EventOnPlayerDeadCompletely(victim, PalDyingEndInfo)
--       fires once when a player has died (ALL death types — combat and environmental).
--       victim -> controller -> PlayerState.PlayerNamePrivate gives the name;
--       PalDyingEndInfo.DeadType gives the cause (EPalDeadType enum).
--
-- HISTORY / why the damage hook is back (this matters):
--   v2.6.1 removed the OnDamagePlayer_Server hook believing it caused a native
--   EXCEPTION_ACCESS_VIOLATION that took the dedicated server down on death. That was a
--   MISDIAGNOSIS. The real cause was a UE4SS install missing MemberVariableLayout.ini (the
--   struct-offset table): with wrong offsets, UE4SS crashes marshalling ANY hooked event's
--   params — the death-only build crashed too. With a complete UE4SS (offset table present)
--   this two-hook version runs crash-free, and the app now warns when that file is missing.
--
-- HARDENING: every UObject we touch is checked with is_valid() (UE4SS's UObject:IsValid(),
--   safe to call on a null/stale handle, returns false) BEFORE any property read, so a
--   malformed event can't fault. (A native AV from a bad UE4SS offset table is NOT catchable
--   this way — that's an install problem, not a mod one; see the note above.)
--
-- Requires UE4SS (experimental Palworld build) in Pal/Binaries/Win64.
--
-- Output path: the app's installer rewrites the placeholder below with an absolute path
-- to <install>/Pal/Saved/psm-deaths.jsonl. If installed by hand (placeholder left as-is)
-- we fall back to relative candidates covering both known UE4SS layouts.

local CANDIDATES = {
    [[__PSM_OUT_PATH__]],              -- absolute, rewritten by the app installer
    "../../../Saved/psm-deaths.jsonl", -- UE4SS 3.x layout (cwd = Win64/ue4ss)
    "../../Saved/psm-deaths.jsonl",    -- UE4SS 2.x layout (cwd = Win64)
    "./psm-deaths.jsonl",              -- last resort: next to UE4SS
}
local OUT_PATH = nil

local function resolve_out_path()
    if OUT_PATH then return OUT_PATH end
    for _, p in ipairs(CANDIDATES) do
        if p:sub(1, 2) ~= "__" then
            local f = io.open(p, "a")
            if f then f:close(); OUT_PATH = p
                print(string.format("[PSMDeathRelay] writing deaths to: %s\n", p)); return OUT_PATH end
        end
    end
    return nil
end

local function esc(s)
    s = tostring(s or "")
    s = s:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n"):gsub("\r", "\\r"):gsub("\t", "\\t")
    return s
end

local function now_ms() return math.floor(os.time() * 1000) end

-- Append one death record. killer/killerKind are empty for environmental / unattributed
-- deaths; the app treats an empty killer as an environmental death.
local function append_death(victim, cause, killer, killerKind)
    local path = resolve_out_path()
    if not path then return end
    local ok, f = pcall(io.open, path, "a")
    if not ok or not f then OUT_PATH = nil; return end
    f:write(string.format(
        '{"victim":"%s","cause":"%s","killer":"%s","killerKind":"%s","at":%d}\n',
        esc(victim), esc(cause), esc(killer or ""), esc(killerKind or ""), now_ms()))
    f:close()
end

-- ToString-ish for FString/FName/objects.
local function to_str(v)
    if v == nil then return "" end
    local ok, s = pcall(function() return v:ToString() end)
    if ok and s then return s end
    return tostring(v)
end

local function unwrap(p)
    if type(p) == "userdata" and p.get then
        local ok, v = pcall(function() return p:get() end); if ok then return v end
    end
    return p
end

-- Safe validity gate for a UE4SS UObject handle. UObject:IsValid() is safe to call on a
-- null/stale handle (it checks the engine's object table, it does NOT dereference game
-- memory) and returns false — so this guards the property reads below.
local function is_valid(o)
    if type(o) ~= "userdata" then return false end
    local ok, v = pcall(function() return o:IsValid() end)
    return ok and v == true
end

-- A character's player name via its controller's PlayerState (engine APlayerState).
-- Every hop is validity-gated before the next dereference.
local function player_name_of(char)
    if not is_valid(char) then return "" end
    local nm = ""
    pcall(function()
        local ctrl = char:GetController()
        if not is_valid(ctrl) then return end
        local ps = ctrl.PlayerState
        if not is_valid(ps) then return end
        nm = to_str(ps.PlayerNamePrivate)
    end)
    return nm
end

-- Classify a damage Attacker actor -> name + kind. Players report their player name;
-- everything else reports its internal species codename (BP_NegativeKoala_C -> NegativeKoala),
-- which the app maps to a friendly name (Depresso).
local function classify_attacker(actor)
    if not is_valid(actor) then return "", "" end
    local full = ""
    pcall(function() full = actor:GetFullName() end)   -- "<ClassName> <Path>"
    local cls = full:match("^(%S+)") or ""
    if cls:find("^BP_Player") then
        return player_name_of(actor), "player"
    end
    local species = cls:gsub("^BP_", ""):gsub("_C$", "")
    if cls:find("^BP_NPC") then return species, "npc" end
    return species, "pal"
end

-- Resolve an EPalDeadType value to its short name (e.g. 1 -> "Attack").
local function dead_type_name(v)
    local nm = nil
    pcall(function()
        local e = StaticFindObject("/Script/Pal.EPalDeadType")
        if e and e.GetNameByValue then nm = to_str(e:GetNameByValue(v)) end
    end)
    if nm and nm ~= "" then return (nm:gsub("^.*::", "")) end -- strip "EPalDeadType::"
    return tostring(v)
end

-- Most-recent attacker per victim name, so a death can name its killer.
local KILL_WINDOW_MS = 15000
local last_attacker = {}   -- victimName -> { name, kind, at }

local function on_player_damaged(self, dmg_param)
    pcall(function()
        local victim = unwrap(self)
        if not is_valid(victim) then return end
        local vname = player_name_of(victim)
        if vname == "" then return end
        local res = unwrap(dmg_param)
        local attacker = nil
        pcall(function() attacker = res.Attacker end)
        if not is_valid(attacker) then return end
        local name, kind = classify_attacker(attacker)
        if name ~= "" then last_attacker[vname] = { name = name, kind = kind, at = now_ms() } end
    end)
end

local function on_player_dead(self, victim_param, info_param)
    pcall(function()
        local victim = unwrap(victim_param)
        if not is_valid(victim) then return end
        local vname = player_name_of(victim)
        if vname == "" then return end

        local cause = ""
        pcall(function()
            local info = unwrap(info_param)
            if info then cause = dead_type_name(info.DeadType) end
        end)

        -- Attach the killer only for attack deaths with a fresh attacker; environmental
        -- deaths (Falling/Drown/Burn/...) stay killer-less.
        local killer, kind = "", ""
        local la = last_attacker[vname]
        if la and cause == "Attack" and (now_ms() - la.at) <= KILL_WINDOW_MS then
            killer, kind = la.name, la.kind
        end
        last_attacker[vname] = nil

        append_death(vname, cause, killer, kind)
        print(string.format("[PSMDeathRelay] death: %s cause=%s killer=%s\n", vname, cause, killer))
    end)
end

-- The Pal classes these live on aren't in memory at mod-load, so register with retries.
local HOOKS = {
    { path = "/Script/Pal.PalPlayerCharacter:OnDamagePlayer_Server", fn = on_player_damaged, done = false },
    { path = "/Script/Pal.PalBattleManager:EventOnPlayerDeadCompletely", fn = on_player_dead, done = false },
}

local function try_register()
    local remaining = 0
    for _, h in ipairs(HOOKS) do
        if not h.done then
            local ok = pcall(RegisterHook, h.path, h.fn)
            if ok then h.done = true; print("[PSMDeathRelay] hooked " .. h.path .. "\n")
            else remaining = remaining + 1 end
        end
    end
    return remaining
end

-- Attempt now and again as the game finishes loading, until both hooks are registered.
resolve_out_path()
if try_register() > 0 then
    for _, delay in ipairs({ 8000, 20000, 45000 }) do
        ExecuteWithDelay(delay, function() pcall(try_register) end)
    end
end
print("[PSMDeathRelay] loaded (killer attribution enabled)\n")
