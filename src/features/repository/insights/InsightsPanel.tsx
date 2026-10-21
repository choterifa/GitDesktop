import { useTranslation } from "react-i18next";
import { DiffStat } from "@/components/diff-stat";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useBranchStats,
  useDefaultBranch,
  useRepoStats,
  useRepoStatus,
} from "@/lib/git/queries";
import {
  DateValue,
  fmt,
  formatBytes,
  LanguageMakeup,
  SectionTitle,
  Stat,
} from "./primitives";

/**
 * The Insights sidebar: the repository's at-a-glance numbers (formerly the
 * "Repository statistics…" dialog) — overview, language makeup, top
 * contributors, and the current branch vs the default branch. The richer
 * charts live in the wide `InsightsBoard` on the right.
 */
export function InsightsPanel({
  repoPath,
  active,
}: {
  repoPath: string;
  active: boolean;
}) {
  const { t } = useTranslation("repository");
  // useRepoStats/useBranchStats are heavy scans; gate them on the Insights tab
  // being visible (<Activity> keeps this mounted but doesn't defer fetches).
  const stats = useRepoStats(repoPath, active);
  const status = useRepoStatus(repoPath);
  const defaultBranch = useDefaultBranch(repoPath);
  const currentBranch = status.data?.branch?.name ?? null;
  const base = defaultBranch.data ?? null;
  const branchStats = useBranchStats(repoPath, currentBranch, base, active);
  const showBranch =
    currentBranch !== null && base !== null && currentBranch !== base;
  const data = stats.data;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center border-b p-2">
        <h2 className="px-1 text-xs font-medium text-muted-foreground">
          {t("insights.overview")}
        </h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {stats.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : stats.isError ? (
          <div className="py-4 text-center text-xs">
            <p className="font-medium text-destructive">
              {t("insights.couldntGatherStatistics")}
            </p>
            <p className="mt-1 text-muted-foreground">
              {stats.error instanceof Error
                ? stats.error.message
                : t("insights.reopenToTryAgain")}
            </p>
          </div>
        ) : data ? (
          <div className="space-y-5">
            <section>
              <SectionTitle>{t("insights.overview")}</SectionTitle>
              <dl className="grid grid-cols-1 gap-x-8">
                <Stat label={t("insights.commits")}>
                  {fmt(data.commitCount)}
                </Stat>
                <Stat label={t("insights.contributors")}>
                  <span
                    title={data.topContributors
                      .map(
                        (c) =>
                          `${c.name} — ${t("insights.commitCount", { count: c.commits })}`,
                      )
                      .join("\n")}
                  >
                    {fmt(data.contributorCount)}
                  </span>
                </Stat>
                <Stat label={t("insights.branches")}>
                  {fmt(data.branchCount)}
                </Stat>
                <Stat label={t("insights.tags")}>{fmt(data.tagCount)}</Stat>
                <Stat label={t("insights.trackedFiles")}>
                  {fmt(data.trackedFiles)}
                </Stat>
                <Stat label={t("insights.linesOfText")}>
                  {fmt(data.totalLines)}
                </Stat>
                <Stat label={t("insights.workingTreeSize")}>
                  {formatBytes(data.trackedBytes)}
                </Stat>
                <Stat label={t("insights.gitData")}>
                  {formatBytes(data.gitDirBytes)}
                </Stat>
                <Stat label={t("insights.firstCommit")}>
                  <DateValue date={data.firstCommitDate} />
                </Stat>
                <Stat label={t("insights.lastCommit")}>
                  <DateValue date={data.lastCommitDate} />
                </Stat>
              </dl>
            </section>

            <section>
              <SectionTitle>{t("insights.codeMakeup")}</SectionTitle>
              <LanguageMakeup languages={data.languages} />
            </section>

            {data.topContributors.length > 0 && (
              <section>
                <SectionTitle>{t("insights.topContributors")}</SectionTitle>
                <ul className="space-y-0.5">
                  {data.topContributors.map((c) => (
                    <li
                      key={c.name}
                      className="flex items-baseline justify-between gap-3 text-xs"
                    >
                      <span className="truncate">{c.name}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {t("insights.commitCount", { count: c.commits })}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {showBranch && (
              <section>
                <SectionTitle>
                  <span className="font-mono">{currentBranch}</span>{" "}
                  <span className="font-normal text-muted-foreground">
                    {t("insights.versus")} {base}
                  </span>
                </SectionTitle>
                {branchStats.isPending ? (
                  <Skeleton className="h-16 w-full" />
                ) : branchStats.data ? (
                  <dl className="grid grid-cols-1 gap-x-8">
                    <Stat label={t("insights.commitsAhead")}>
                      {fmt(branchStats.data.commitCount)}
                    </Stat>
                    <Stat label={t("insights.contributors")}>
                      {fmt(branchStats.data.contributorCount)}
                    </Stat>
                    <Stat label={t("insights.filesChanged")}>
                      {fmt(branchStats.data.filesChanged)}
                    </Stat>
                    <Stat label={t("insights.linesChanged")}>
                      <DiffStat
                        added={branchStats.data.additions}
                        deleted={branchStats.data.deletions}
                        format={fmt}
                      />
                    </Stat>
                    <Stat label={t("insights.firstBranchCommit")}>
                      <DateValue date={branchStats.data.firstCommitDate} />
                    </Stat>
                    <Stat label={t("insights.latestBranchCommit")}>
                      <DateValue date={branchStats.data.lastCommitDate} />
                    </Stat>
                  </dl>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t("insights.couldntCompareAgainst", { base })}
                  </p>
                )}
              </section>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
