/** The message of a thrown value, for notices and logs. Safe on the client and the server. */
export function errorMessage(error: unknown, fallback = "Unknown error"): string {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === "string" && error) return error;
  return fallback;
}
