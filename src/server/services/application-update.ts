import type { ApplicationUpdateStatus } from "@/contracts/application-update";
import { compareSemanticVersions, isPrerelease, parseSemanticVersion } from "@/lib/semver";

const RELEASES_URL = "https://api.github.com/repos/valeryan/palworld-server-manager/releases?per_page=20";
const LATEST_STABLE_URL = "https://api.github.com/repos/valeryan/palworld-server-manager/releases/latest";
const CACHE_MS = 6 * 60 * 60 * 1_000;
type GitHubRelease = { tag_name?: unknown; html_url?: unknown; published_at?: unknown; draft?: unknown; prerelease?: unknown };
type CacheEntry = { expiresAt: number; status: ApplicationUpdateStatus };
declare global { var __psmApplicationUpdateCache: Map<string, CacheEntry> | undefined; }
const cache = () => (globalThis.__psmApplicationUpdateCache ??= new Map<string, CacheEntry>());

export async function applicationUpdateStatus(currentVersion: string, options: { fetcher?: typeof fetch; now?: number; force?: boolean } = {}): Promise<ApplicationUpdateStatus> {
  const now = options.now ?? Date.now(); const key = `${currentVersion}:${isPrerelease(currentVersion) ? "prerelease" : "stable"}`; const saved = cache().get(key);
  if (!options.force && saved && saved.expiresAt > now) return saved.status;
  const empty = (): ApplicationUpdateStatus => ({ currentVersion, publishedVersion: null, updateAvailable: false, releaseUrl: null, publishedAt: null, checkedAt: new Date(now).toISOString() });
  if (!parseSemanticVersion(currentVersion)) return empty();
  try {
    const allowPrerelease = isPrerelease(currentVersion);
    const response = await (options.fetcher ?? fetch)(allowPrerelease ? RELEASES_URL : LATEST_STABLE_URL, { headers: { accept: "application/vnd.github+json", "user-agent": "palworld-server-manager-next", "x-github-api-version": "2022-11-28" }, signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`GitHub returned ${response.status}.`);
    const payload = await response.json() as GitHubRelease | GitHubRelease[]; const releases = Array.isArray(payload) ? payload : [payload];
    const candidates = releases.flatMap((release) => {
      if (release.draft === true || (!allowPrerelease && release.prerelease === true) || typeof release.tag_name !== "string" || typeof release.html_url !== "string") return [];
      const version = release.tag_name.replace(/^v/, ""); return parseSemanticVersion(version) && (allowPrerelease || !isPrerelease(version)) ? [{ version, url: release.html_url, publishedAt: typeof release.published_at === "string" ? release.published_at : null }] : [];
    });
    candidates.sort((a, b) => compareSemanticVersions(b.version, a.version) ?? 0); const latest = candidates[0];
    const status = latest && (compareSemanticVersions(latest.version, currentVersion) ?? 0) > 0 ? { currentVersion, publishedVersion: latest.version, updateAvailable: true, releaseUrl: latest.url, publishedAt: latest.publishedAt, checkedAt: new Date(now).toISOString() } : empty();
    cache().set(key, { expiresAt: now + CACHE_MS, status }); return status;
  } catch { const status = empty(); cache().set(key, { expiresAt: now + CACHE_MS, status }); return status; }
}

export function clearApplicationUpdateCache(): void { cache().clear(); }
