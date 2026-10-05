import type { ApplicationUpdateStatus, UpdateChannel } from "@/contracts/application-update";
import { compareSemanticVersions, isPrerelease, parseSemanticVersion } from "@/lib/semver";

const RELEASES_URL = "https://api.github.com/repos/valeryan/palworld-server-manager/releases?per_page=20";
const LATEST_STABLE_URL = "https://api.github.com/repos/valeryan/palworld-server-manager/releases/latest";
const CACHE_MS = 6 * 60 * 60 * 1_000;
type GitHubRelease = { tag_name?: unknown; html_url?: unknown; published_at?: unknown; draft?: unknown; prerelease?: unknown };
type CacheEntry = { expiresAt: number; status: ApplicationUpdateStatus };
declare global { var __psmApplicationUpdateCache: Map<string, CacheEntry> | undefined; }
const cache = () => (globalThis.__psmApplicationUpdateCache ??= new Map<string, CacheEntry>());

// Without a saved choice, an installed prerelease follows prereleases and a stable build follows stable releases.
export function defaultUpdateChannel(currentVersion: string): UpdateChannel { return isPrerelease(currentVersion) ? "prerelease" : "stable"; }

// The prerelease channel also receives stable releases; the stable channel never offers a prerelease.
export async function applicationUpdateStatus(currentVersion: string, options: { channel?: UpdateChannel; disabled?: "development"; fetcher?: typeof fetch; now?: number; force?: boolean } = {}): Promise<ApplicationUpdateStatus> {
  const now = options.now ?? Date.now(); const channel = options.channel ?? defaultUpdateChannel(currentVersion);
  const empty = (): ApplicationUpdateStatus => ({ currentVersion, channel, publishedVersion: null, updateAvailable: false, releaseUrl: null, publishedAt: null, checkedAt: new Date(now).toISOString() });
  if (options.disabled) return { ...empty(), disabledReason: options.disabled };
  const key = `${currentVersion}:${channel}`; const saved = cache().get(key);
  if (!options.force && saved && saved.expiresAt > now) return saved.status;
  if (!parseSemanticVersion(currentVersion)) return empty();
  try {
    const allowPrerelease = channel === "prerelease";
    const response = await (options.fetcher ?? fetch)(allowPrerelease ? RELEASES_URL : LATEST_STABLE_URL, { headers: { accept: "application/vnd.github+json", "user-agent": "palworld-server-manager-next", "x-github-api-version": "2022-11-28" }, signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);
    const payload = await response.json() as GitHubRelease | GitHubRelease[]; const releases = Array.isArray(payload) ? payload : [payload];
    const candidates = releases.flatMap((release) => {
      if (release.draft === true || (!allowPrerelease && release.prerelease === true) || typeof release.tag_name !== "string" || typeof release.html_url !== "string") return [];
      const version = release.tag_name.replace(/^v/, ""); return parseSemanticVersion(version) && (allowPrerelease || !isPrerelease(version)) ? [{ version, url: release.html_url, publishedAt: typeof release.published_at === "string" ? release.published_at : null }] : [];
    });
    candidates.sort((a, b) => compareSemanticVersions(b.version, a.version) ?? 0); const latest = candidates[0];
    const status = latest && (compareSemanticVersions(latest.version, currentVersion) ?? 0) > 0 ? { currentVersion, channel, publishedVersion: latest.version, updateAvailable: true, releaseUrl: latest.url, publishedAt: latest.publishedAt, checkedAt: new Date(now).toISOString() } : empty();
    cache().set(key, { expiresAt: now + CACHE_MS, status }); return status;
  } catch (error) { const status = { ...empty(), error: error instanceof Error ? error.message : "Update check failed." }; cache().set(key, { expiresAt: now + 60_000, status }); return status; }
}

export function clearApplicationUpdateCache(): void { cache().clear(); }
