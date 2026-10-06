import "server-only";
import { createHash } from "node:crypto";
import { open, rm } from "node:fs/promises";

export interface DownloadOptions {
  signal: AbortSignal;
  /** Hard cap on the body; the download fails closed as soon as it is exceeded. */
  maxBytes: number;
  /** Names the download in error messages, e.g. "SteamCMD". */
  label: string;
  /** Overall timeout, combined with `signal`. */
  timeoutMs?: number;
  onProgress?(received: number): Promise<void> | void;
}

const mebibytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(bytes % 1_048_576 ? 1 : 0)} MiB`;

/**
 * Streams `url` into a new file (created exclusively) with a byte cap, cancellation and no partial
 * result: the file is removed on any failure. Returns the size and SHA-256 of what was written.
 */
export async function downloadToFile(url: string, destination: string, options: DownloadOptions): Promise<{ bytes: number; sha256: string }> {
  const signal = options.timeoutMs ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)]) : options.signal;
  const hash = createHash("sha256");
  let received = 0;
  const file = await open(destination, "wx");
  try {
    const response = await fetch(url, { signal, redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`${options.label} download failed: HTTP ${response.status}`);
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      options.signal.throwIfAborted();
      received += chunk.byteLength;
      if (received > options.maxBytes) throw new Error(`${options.label} download exceeds the ${mebibytes(options.maxBytes)} limit; refusing it.`);
      hash.update(chunk);
      await file.write(chunk);
      await options.onProgress?.(received);
    }
    await file.close();
    return { bytes: received, sha256: hash.digest("hex") };
  } catch (error) {
    await file.close().catch(() => undefined);
    await rm(destination, { force: true });
    throw error;
  }
}
