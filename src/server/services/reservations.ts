import "server-only";
import { serialize } from "@/server/serialize";

/** Serialises every port and install-directory reservation check across all worlds. */
export function withReservationLock<T>(work: () => Promise<T>): Promise<T> { return serialize("reservations", work); }
