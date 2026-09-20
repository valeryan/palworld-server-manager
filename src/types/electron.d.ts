import type { DesktopApi } from "../../electron/preload";
declare global { interface Window { psmDesktop?: DesktopApi; } }
export {};
