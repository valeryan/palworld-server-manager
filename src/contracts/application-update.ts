export type ApplicationUpdateStatus = {
  currentVersion: string;
  publishedVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  publishedAt: string | null;
  checkedAt: string;
};
