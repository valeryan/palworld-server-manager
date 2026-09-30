-- PSM_MOD_VERSION 1
-- PSMBroadcast: on-screen server notices for Palworld Server Manager.
--
-- The manager appends one JSON line per notice to Pal/Saved/psm-broadcast.jsonl:
--   {"b64":"<base64 UTF-8 message>","at":<ms>}
-- This mod reads new lines once a second and shows each message to every player through
-- PalGameStateInGame:BroadcastServerNotice (a red on-screen banner, not a chat line). The game
-- decides how long the banner stays up. Base64 keeps quotes, newlines, and Unicode intact.

-- The manager replaces the placeholder with this world's absolute queue path. The relative
-- fallback covers a hand install: UE4SS runs with the working directory in Pal/Binaries/<platform>.
local CANDIDATES = { [[__PSM_QUEUE_PATH__]], "../../Saved/psm-broadcast.jsonl" }
local QUEUE_PATH = nil
local offset = 0

local function resolve_path()
    if QUEUE_PATH then return QUEUE_PATH end
    for _, candidate in ipairs(CANDIDATES) do
        if candidate:sub(1, 2) ~= "__" then
            local file = io.open(candidate, "a")
            if file then
                file:close(); QUEUE_PATH = candidate
                print(string.format("[PSMBroadcast] watching queue: %s\n", candidate))
                return QUEUE_PATH
            end
        end
    end
    return nil
end

local ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local function base64_decode(data)
    data = tostring(data):gsub("[^" .. ALPHABET .. "=]", "")
    return (data:gsub(".", function(char)
        if char == "=" then return "" end
        local bits, value = "", ALPHABET:find(char) - 1
        for index = 6, 1, -1 do bits = bits .. (value % 2 ^ index - value % 2 ^ (index - 1) > 0 and "1" or "0") end
        return bits
    end):gsub("%d%d%d?%d?%d?%d?%d?%d?", function(byte)
        if #byte ~= 8 then return "" end
        local code = 0
        for index = 1, 8 do code = code + (byte:sub(index, index) == "1" and 2 ^ (8 - index) or 0) end
        return string.char(code)
    end))
end

-- A direct class lookup works on every UE4SS build tested. The utility path is kept as a
-- fallback; on the native Linux port GetPalGameStateInGame(World) returns nothing.
local function game_state()
    local direct = FindFirstOf("PalGameStateInGame")
    if direct and direct:IsValid() then return direct, "direct" end
    local utility = StaticFindObject("/Script/Pal.Default__PalUtility")
    if not utility or not utility:IsValid() then return nil, "PalUtility not found" end
    local world = FindFirstOf("World")
    if not world or not world:IsValid() then return nil, "no live world" end
    local ok, state = pcall(function() return utility:GetPalGameStateInGame(world) end)
    if not ok or not state or not state:IsValid() then return nil, "no game state" end
    return state, "utility"
end

local function show(text)
    local state, route = game_state()
    if not state then print("[PSMBroadcast] notice not shown: " .. tostring(route) .. "\n"); return end
    local ok, err = pcall(function() state:BroadcastServerNotice(text) end)
    print(string.format("[PSMBroadcast] notice via %s: %s\n", route, ok and "sent" or tostring(err)))
end

local function handle_line(line)
    local encoded = line:match('"b64"%s*:%s*"([^"]*)"')
    if not encoded or encoded == "" then return end
    local text = base64_decode(encoded)
    if text and text ~= "" then ExecuteInGameThread(function() show(text) end) end
end

local function poll()
    local path = resolve_path(); if not path then return end
    local file = io.open(path, "rb"); if not file then return end
    local size = file:seek("end") or 0
    if size < offset then offset = 0 end
    if size == offset then file:close(); return end
    file:seek("set", offset)
    local data = file:read("*a") or ""
    offset = size; file:close()
    for line in data:gmatch("[^\r\n]+") do handle_line(line) end
end

-- Start at the end of the queue so a restart never replays old notices.
do
    local path = resolve_path()
    local file = path and io.open(path, "rb")
    if file then offset = file:seek("end") or 0; file:close() end
end

LoopAsync(1000, function()
    local ok, err = pcall(poll)
    if not ok then print("[PSMBroadcast] poll error: " .. tostring(err) .. "\n") end
    return false
end)
print("[PSMBroadcast] loaded\n")
