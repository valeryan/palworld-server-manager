import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { downloadToFile } from "@/server/services/download";

let root: string; let counter = 0;
const target = () => path.join(root, `file-${counter++}.bin`);
const absent = async (file: string) => (await stat(file).catch(() => null)) === null;
beforeAll(async () => { root = await mkdtemp(path.join(tmpdir(), "psm-download-")); });
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("downloadToFile", () => {
  it("writes the body and reports its size and digest", async () => {
    const body = Buffer.from("pinned artifact bytes");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array(body)));
    const file = target(); const seen: number[] = [];
    const result = await downloadToFile("https://example.invalid/a", file, { signal: new AbortController().signal, maxBytes: 1024, label: "Test", onProgress: (received) => { seen.push(received); } });
    expect(result).toEqual({ bytes: body.byteLength, sha256: createHash("sha256").update(body).digest("hex") });
    expect(await readFile(file)).toEqual(body);
    expect(seen.at(-1)).toBe(body.byteLength);
  });
  it("stops at the byte cap and leaves nothing behind", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array(2048)));
    const file = target();
    await expect(downloadToFile("https://example.invalid/big", file, { signal: new AbortController().signal, maxBytes: 1024, label: "Test" })).rejects.toThrow("Test download exceeds the 0.0 MiB limit");
    expect(await absent(file)).toBe(true);
  });
  it("fails closed on an HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("missing", { status: 404 }));
    const file = target();
    await expect(downloadToFile("https://example.invalid/missing", file, { signal: new AbortController().signal, maxBytes: 1024, label: "Test" })).rejects.toThrow("Test download failed: HTTP 404");
    expect(await absent(file)).toBe(true);
  });
  it("refuses to overwrite an existing destination", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("x"));
    const file = target();
    await downloadToFile("https://example.invalid/first", file, { signal: new AbortController().signal, maxBytes: 1024, label: "Test" });
    await expect(downloadToFile("https://example.invalid/second", file, { signal: new AbortController().signal, maxBytes: 1024, label: "Test" })).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(file, "utf8")).toBe("x");
  });
});
