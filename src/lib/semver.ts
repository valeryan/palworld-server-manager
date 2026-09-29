export type SemanticVersion = { major: number; minor: number; patch: number; prerelease: Array<string | number> };

export function parseSemanticVersion(value: string): SemanticVersion | null {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value.trim());
  if (!match) return null;
  const prerelease = match[4]?.split(".").map((item) => /^\d+$/.test(item) ? Number(item) : item) ?? [];
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease };
}

export function compareSemanticVersions(leftValue: string, rightValue: string): number | null {
  const left = parseSemanticVersion(leftValue); const right = parseSemanticVersion(rightValue); if (!left || !right) return null;
  for (const key of ["major", "minor", "patch"] as const) if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  if (!left.prerelease.length || !right.prerelease.length) return left.prerelease.length === right.prerelease.length ? 0 : left.prerelease.length ? -1 : 1;
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index += 1) {
    const a = left.prerelease[index]; const b = right.prerelease[index];
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1;
    if (a === b) continue;
    if (typeof a === "number" && typeof b === "number") return a > b ? 1 : -1;
    if (typeof a === "number") return -1; if (typeof b === "number") return 1;
    return a > b ? 1 : -1;
  }
  return 0;
}

export function isPrerelease(value: string): boolean { return Boolean(parseSemanticVersion(value)?.prerelease.length); }
