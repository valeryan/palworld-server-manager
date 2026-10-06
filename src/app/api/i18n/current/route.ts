import { route } from "@/server/http";
import { languageCatalog, languageResources } from "@/server/services/localization";

// Public: the remote page loads its language before anyone signs in.
export const GET = route(async () => { const catalog = await languageCatalog(); return { pack: languageResources(catalog.active) }; }, { admin: false });
