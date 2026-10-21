import { i18n } from "@/lib/i18n";

/** Copy for shared sync controls and their disabled-item labels. */
export const syncControlCopy = (
  key: "offlineItemReason" | "busyReason" | "pullOptionsUnpublishedReason",
): string => i18n.t(`syncControls.${key}`, { ns: "repositoryOperations" });

/** Shared translated push copy; the source helper stays import-free for Node. */
export const pushWriteCopy = (
  key: string,
  options?: Record<string, string>,
): string =>
  i18n.t(`pushWrites.${key}`, {
    ns: "repositoryOperations",
    ...options,
  });
