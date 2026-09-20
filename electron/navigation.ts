type ElectronNavigationError = Error & {
  code?: string;
  errno?: number;
};

/**
 * Electron rejects loadURL with ERR_ABORTED when a second main-frame
 * navigation supersedes the first. The replacement navigation is still valid
 * and must not be mistaken for a renderer startup failure.
 */
export function isSupersededNavigation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const navigationError = error as ElectronNavigationError;
  return navigationError.code === "ERR_ABORTED"
    || navigationError.errno === -3
    || /\bERR_ABORTED\s*\(-3\)/.test(error.message);
}
