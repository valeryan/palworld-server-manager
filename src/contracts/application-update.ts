export const updateChannels = ["stable", "prerelease"] as const;
export type UpdateChannel = typeof updateChannels[number];

export type ApplicationUpdateStatus = {
  currentVersion: string;
  channel: UpdateChannel;
  // Development runs (npm run dev, next start, browser tests) never contact GitHub.
  disabledReason?: "development";
  publishedVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  publishedAt: string | null;
  checkedAt: string;
};
