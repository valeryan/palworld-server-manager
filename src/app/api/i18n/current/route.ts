import { route } from "@/server/http";
import { languageCatalog, languageResources } from "@/server/services/localization";

// Public: the UI loads its language before the desktop session is authenticated.
export const GET = route(async () => { const catalog = await languageCatalog(); return { pack: languageResources(catalog.active) }; }, { admin: false });
