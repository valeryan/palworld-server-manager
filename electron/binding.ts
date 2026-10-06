import { developmentUrl } from "./environment";
import { validateManagerPort } from "./launch-options";
import { preferences, remoteAccessEnabled, type ManagerHost } from "./preferences";

// Where the bundled web server listens for this launch. Preferences only take effect at the next start.
export const port = developmentUrl ? validateManagerPort(developmentUrl.port || "80") : process.env.PSM_PORT ? validateManagerPort(process.env.PSM_PORT) : preferences().managerPort;
export const host: ManagerHost = process.env.PSM_HOST === "0.0.0.0" ? "0.0.0.0" : remoteAccessEnabled() ? preferences().managerHost : "127.0.0.1";
