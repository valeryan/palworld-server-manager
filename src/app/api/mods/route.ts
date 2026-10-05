import { route } from "@/server/http";
import { libraryLuaMods, libraryRelays, modLibrary } from "@/server/mods/status";

export const GET = route(async () => { const [library, luaMods, relays] = await Promise.all([modLibrary(), libraryLuaMods(), libraryRelays()]); return { library, luaMods, relays }; });
