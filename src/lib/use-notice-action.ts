"use client";
import { useState } from "react";
import { errorMessage } from "@/lib/errors";

export type NoticeActionOptions = { onError?: "notice" | "rethrow" };

/** One pending flag for a group of actions; failures are reported through the page's notice unless rethrown. */
export function useNoticeAction(onNotice: (message: string) => void) {
  const [pending, setPending] = useState(false);
  async function run<T>(action: () => Promise<T>, options?: NoticeActionOptions): Promise<T | undefined> {
    setPending(true);
    try { return await action(); }
    catch (error) { if (options?.onError === "rethrow") throw error; onNotice(errorMessage(error)); return undefined; }
    finally { setPending(false); }
  }
  return { pending, run };
}
