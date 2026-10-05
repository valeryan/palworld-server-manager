import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchBlob, fetchJson, requestJson } from "@/lib/http-client";

afterEach(() => vi.restoreAllMocks());

describe("manager JSON requests", () => {
  it("returns the response envelope without adding headers to a plain request", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true, worlds: [] }));
    expect(await fetchJson("/api/worlds")).toEqual({ ok: true, worlds: [] });
    expect(fetcher).toHaveBeenCalledWith("/api/worlds", undefined);
  });

  it("preserves serialized bodies, cancellation and caller headers", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true }));
    const signal = new AbortController().signal;
    const body = JSON.stringify({ action: "backup" });
    await requestJson("/api/worlds/fixture/actions", { method: "POST", signal, body, headers: { "x-fixture": "yes" } });
    expect(fetcher).toHaveBeenCalledWith("/api/worlds/fixture/actions", {
      method: "POST", signal, body, headers: { "content-type": "application/json", "x-fixture": "yes" },
    });
  });

  it.each([fetchJson, requestJson])("surfaces server errors and falls back to the HTTP status", async (request) => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ error: "Settings changed; refresh first." }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({}, { status: 503 }));
    await expect(request("/api/settings")).rejects.toThrow("Settings changed; refresh first.");
    await expect(request("/api/settings")).rejects.toThrow("Request failed (503)");
  });

  it("propagates network, cancellation and malformed JSON failures", async () => {
    const cancelled = new DOMException("Cancelled", "AbortError");
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new TypeError("Network unavailable"))
      .mockRejectedValueOnce(cancelled)
      .mockResolvedValueOnce(new Response("invalid JSON"));
    await expect(fetchJson("/api/jobs")).rejects.toThrow("Network unavailable");
    await expect(requestJson("/api/jobs")).rejects.toBe(cancelled);
    await expect(fetchJson("/api/jobs")).rejects.toBeInstanceOf(SyntaxError);
  });

  it("downloads binary responses and surfaces JSON failure messages", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(new Blob(["zip-bytes"], { type: "application/zip" })))
      .mockResolvedValueOnce(Response.json({ error: "World not found." }, { status: 404 }))
      .mockResolvedValueOnce(new Response("gateway down", { status: 502 }));
    const blob = await fetchBlob("/api/worlds/fixture/configuration/export");
    expect(await blob.text()).toBe("zip-bytes");
    expect(blob.type).toBe("application/zip");
    expect(fetcher).toHaveBeenCalledWith("/api/worlds/fixture/configuration/export", undefined);
    await expect(fetchBlob("/api/worlds/missing/configuration/export")).rejects.toThrow("World not found.");
    await expect(fetchBlob("/api/worlds/fixture/configuration/export")).rejects.toThrow("Request failed (502)");
  });
});
