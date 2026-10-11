import "server-only";

// The manager's lifecycle phase, kept on globalThis so a dev-server module reload cannot fork it.
// The phase gates admission and selects which startup steps the boot sequence runs; service
// methods do not branch on it internally.
export type RuntimePhase = "booting" | "ready" | "draining";
declare global { var __psmRuntimePhase: RuntimePhase | undefined; }

/** Undefined until the runtime begins booting. */
export const runtimePhase = (): RuntimePhase | undefined => globalThis.__psmRuntimePhase;
export function setRuntimePhase(phase: RuntimePhase): void { globalThis.__psmRuntimePhase = phase; }
/** The desktop shell is quitting: no new admissions, timers, or recovery. */
export const isDraining = (): boolean => globalThis.__psmRuntimePhase === "draining";
