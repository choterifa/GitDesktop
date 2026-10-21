import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DiffStat } from "@/components/diff-stat";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  forgeFeatureReady,
  useCodeFrequency,
  useCommitActivity,
  useCommunityInsights,
  useContributorActivity,
  useForgeStatus,
  useForkActivity,
  usePunchCard,
  useRepoDependencies,
  useRepoTraffic,
} from "@/lib/git/queries";
import type { ContributorChurn } from "@/lib/git/types";
import { useWorkflowRuns } from "@/lib/github/actions";
import { CommunityCard } from "./CommunityCard";
import {
  ActionsDurationChart,
  CodeFrequencyChart,
  CommitActivityChart,
  type RunDurationPoint,
} from "./charts";
import { DependenciesCard } from "./DependenciesCard";
import { ForkActivityCard } from "./ForkActivityCard";
import {
  BitbucketLinkOutsCard,
  GitLabLinkOutsCard,
  LinkOutsCard,
  LinkOutsSkeleton,
} from "./LinkOutsCard";
import { PunchCard, PunchCardSkeleton } from "./PunchCard";
import { Empty, fmt, InsightCard } from "./primitives";
import { TrafficCard } from "./TrafficCard";

const WINDOW_WEEKS = 52;

/** Body heights: each at least the loaded arm (a chart card counts a 2-line
 *  caption and the table toggle), so loading, empty and loaded paint one
 *  height. A min, not a fixed height: an expanded data table, or a list longer
 *  than its reservation, still grows the card. `contributors` is exactly the
 *  six-row skeleton (6 x 26px rows + 5 x 6px gaps). `traffic` is sized for
 *  4-digit counts at the 640 px window floor. */
const CARD_BODY = {
  chart: "min-h-57",
  community: "min-h-48",
  dependencies: "min-h-74",
  contributors: "min-h-46.5",
  traffic: "min-h-72.5",
} as const;

/** Rows the contributors skeleton reserves: a typical list. Shorter lists keep
 *  the space ({@link CARD_BODY}); longer ones grow downward to the 12-row cap. */
const CONTRIBUTOR_SKELETON_ROWS = ["a", "b", "c", "d", "e", "f"];

/** Fills a {@link CARD_BODY} slot. */
function ChartSkeleton() {
  return <Skeleton className="w-full flex-1" />;
}

/** {@link ContributorsList}'s row boxes (name line + bar), so loaded rows land
 *  where the skeleton's were. */
function ContributorsSkeleton() {
  return (
    <ul aria-hidden className="space-y-1.5">
      {CONTRIBUTOR_SKELETON_ROWS.map((key) => (
        <li key={key} className="space-y-1">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-1.5 w-full rounded-full" />
        </li>
      ))}
    </ul>
  );
}

/** TrafficCard's usual top: the stat row and the 14-day chart figure. The
 *  referrer and path lists below it may still grow the card. */
function TrafficSkeleton() {
  return (
    <div aria-hidden className="flex flex-1 flex-col gap-3">
      <Skeleton className="h-6 w-full" />
      <Skeleton className="min-h-48 w-full flex-1" />
    </div>
  );
}

/** Top contributors as an accessible bar-list (name + commits + line churn). */
function ContributorsList({ data }: { data: ContributorChurn[] }) {
  const { t } = useTranslation("repository");
  const top = data.slice(0, 12);
  const max = Math.max(1, ...top.map((c) => c.commits));
  return (
    <ul className="space-y-1.5">
      {top.map((c) => (
        <li key={c.name} className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate font-medium" title={c.name}>
              {c.name}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {t("insights.commitCount", { count: c.commits })} ·{" "}
              <DiffStat
                added={c.additions}
                deleted={c.deletions}
                format={fmt}
              />
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${(c.commits / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function durationMinutes(start: string, end: string): number {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0;
  // ms → minutes (÷60_000), rounded to 2 decimals (×100 / round / ÷100).
  return Math.round(((e - s) / 60_000) * 100) / 100;
}

/**
 * The wide Insights board: the local-git graphs (commit activity, code
 * frequency, contributors, punch card) over a trailing window, plus a GitHub
 * Actions duration/success trend and a community-health card. All local data is
 * computed from the clone (works offline, on private repos, with no token).
 */
export function InsightsBoard({
  repoPath,
  active,
}: {
  repoPath: string;
  active: boolean;
}) {
  const { t } = useTranslation("repository");
  const [allTime, setAllTime] = useState(false);
  const weeks = allTime ? 0 : WINDOW_WEEKS;

  const gh = useForgeStatus(repoPath);
  // The hosted cards gate on the insights flag; the CI card is forge-backed
  // (GitLab pipelines work), while community / traffic / dependencies are
  // GitHub-only APIs with no GitLab analogue and hide per provider.
  const canGh = active && forgeFeatureReady(gh.data, "insights");
  const isGitLab = gh.data?.provider === "gitlab";
  const isBitbucket = gh.data?.provider === "bitbucket";
  // Positive gate: the community / traffic / dependencies cards are GitHub-only
  // APIs, so fire them ONLY for GitHub. A `!isGitLab` shape would (with insights
  // now enabled for Bitbucket) light them up on Bitbucket repos too.
  const canGhOnly = canGh && gh.data?.provider === "github";
  // Fork activity is hosted-but-all-forge (like CI), so it rides its own flag
  // rather than the GitHub-only gate; ahead/behind is a separate flag because
  // only GitHub can compare across forks.
  const canForks = active && forgeFeatureReady(gh.data, "forkActivity");
  const canCompare = forgeFeatureReady(gh.data, "forkCompare");
  const forkProvider = gh.data?.provider ?? null;
  // While the forge probe is unanswered, the GitHub cards draw as skeletons in
  // their slots (their queries are disabled, so each reads pending) instead of
  // mounting late and pushing the grid down; any other answer drops them once.
  const forgeDetecting = active && gh.isPending;

  // These are heavy (full-history git scans + gh calls); gate them on the
  // Insights tab being visible. <Activity> keeps this mounted while hidden but
  // does NOT defer React Query fetches, so without this gate they'd run on
  // every repo open even if the user never opens Insights.
  const commitActivity = useCommitActivity(repoPath, weeks, active);
  const codeFreq = useCodeFrequency(repoPath, weeks, active);
  const punchCard = usePunchCard(repoPath, weeks, active);
  const contributors = useContributorActivity(repoPath, weeks, active);
  const community = useCommunityInsights(repoPath, canGhOnly);
  const traffic = useRepoTraffic(repoPath, canGhOnly);
  const dependencies = useRepoDependencies(repoPath, canGhOnly);
  const forkActivity = useForkActivity(repoPath, canForks);
  const runs = useWorkflowRuns(repoPath, canGh, active);

  const completed = (runs.data ?? []).filter((r) => r.status === "completed");
  const successRate = completed.length
    ? Math.round(
        (100 * completed.filter((r) => r.conclusion === "success").length) /
          completed.length,
      )
    : null;
  const durationPoints: RunDurationPoint[] = completed
    .filter((r) => r.startedAt)
    .slice(0, 30)
    .reverse()
    .map((r) => ({
      run: `#${r.number}`,
      minutes: durationMinutes(r.startedAt, r.updatedAt),
      conclusion: r.conclusion || "—",
    }));

  return (
    // `h-full`, not `flex-1`: the tab host this mounts in is a block element, so
    // a flex-item sizing hint is inert there and the grid's natural height would
    // leak into the document instead of scrolling inside the board.
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between border-b p-2">
        <h2 className="px-1 text-xs font-medium text-muted-foreground">
          {t("insights.title")}
        </h2>
        <div
          className="flex items-center gap-0.5"
          role="group"
          aria-label={t("insights.timeWindow")}
        >
          <Button
            type="button"
            size="xs"
            variant={allTime ? "ghost" : "secondary"}
            aria-pressed={!allTime}
            onClick={() => setAllTime(false)}
          >
            {t("insights.weeks", { count: WINDOW_WEEKS })}
          </Button>
          <Button
            type="button"
            size="xs"
            variant={allTime ? "secondary" : "ghost"}
            aria-pressed={allTime}
            onClick={() => setAllTime(true)}
          >
            {t("insights.allTime")}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <InsightCard
            title={t("insights.commitActivity")}
            bodyClassName={CARD_BODY.chart}
            stale={commitActivity.isPlaceholderData}
          >
            {commitActivity.isPending ? (
              <ChartSkeleton />
            ) : commitActivity.data?.length ? (
              <CommitActivityChart data={commitActivity.data} />
            ) : (
              <Empty>{t("insights.noCommitsInWindow")}</Empty>
            )}
          </InsightCard>

          <InsightCard
            title={t("insights.codeFrequency")}
            bodyClassName={CARD_BODY.chart}
            stale={codeFreq.isPlaceholderData}
          >
            {codeFreq.isPending ? (
              <ChartSkeleton />
            ) : codeFreq.data?.length ? (
              <CodeFrequencyChart data={codeFreq.data} />
            ) : (
              <Empty>{t("insights.noCodeChangesInWindow")}</Empty>
            )}
          </InsightCard>

          <InsightCard
            title={t("insights.contributors")}
            className="xl:col-span-2"
            bodyClassName={CARD_BODY.contributors}
            stale={contributors.isPlaceholderData}
          >
            {contributors.isPending ? (
              <ContributorsSkeleton />
            ) : contributors.data?.length ? (
              <ContributorsList data={contributors.data} />
            ) : (
              <Empty>{t("insights.noContributorsInWindow")}</Empty>
            )}
          </InsightCard>

          <InsightCard
            title={t("insights.commitsByDayHour")}
            className="xl:col-span-2"
            stale={punchCard.isPlaceholderData}
          >
            {punchCard.isPending ? (
              <PunchCardSkeleton />
            ) : punchCard.data ? (
              <PunchCard grid={punchCard.data} />
            ) : (
              <Empty>{t("insights.noCommitTimesToChart")}</Empty>
            )}
          </InsightCard>

          {(canGh || forgeDetecting) && (
            <InsightCard
              title={
                isGitLab || isBitbucket
                  ? t("insights.pipelines")
                  : t("insights.actions")
              }
              bodyClassName={CARD_BODY.chart}
              action={
                successRate !== null && (
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {t("insights.successRate", {
                      rate: successRate,
                      count: completed.length,
                    })}
                  </span>
                )
              }
            >
              {runs.isPending ? (
                <ChartSkeleton />
              ) : durationPoints.length ? (
                <ActionsDurationChart data={durationPoints} />
              ) : (
                <Empty>
                  {t("insights.noCompletedYet", {
                    kind:
                      isGitLab || isBitbucket
                        ? t("insights.pipelineRuns")
                        : t("insights.workflowRuns"),
                  })}
                </Empty>
              )}
            </InsightCard>
          )}

          {((canForks && forkProvider) || forgeDetecting) && (
            <InsightCard
              title={t("insights.forkActivity")}
              bodyClassName={CARD_BODY.chart}
              action={
                forkActivity.data?.totalCount != null && (
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {t("insights.forkCount", {
                      count: forkActivity.data.totalCount,
                    })}
                  </span>
                )
              }
            >
              {forkActivity.isPending ? (
                <ChartSkeleton />
              ) : forkActivity.data && forkProvider ? (
                <ForkActivityCard
                  repoPath={repoPath}
                  data={forkActivity.data}
                  provider={forkProvider}
                  canCompare={canCompare}
                />
              ) : (
                <Empty>{t("insights.forkActivityUnavailable")}</Empty>
              )}
            </InsightCard>
          )}

          {(canGhOnly || forgeDetecting) && (
            <InsightCard
              title={t("insights.community")}
              bodyClassName={CARD_BODY.community}
            >
              {community.isPending ? (
                <ChartSkeleton />
              ) : community.data ? (
                <CommunityCard data={community.data} />
              ) : (
                <Empty>{t("insights.communityUnavailable")}</Empty>
              )}
            </InsightCard>
          )}

          {(canGhOnly || forgeDetecting) && (
            <InsightCard
              title={t("insights.traffic")}
              className="xl:col-span-2"
              bodyClassName={CARD_BODY.traffic}
            >
              {traffic.isPending ? (
                <TrafficSkeleton />
              ) : traffic.data ? (
                <TrafficCard data={traffic.data} />
              ) : (
                <Empty>{t("insights.trafficUnavailable")}</Empty>
              )}
            </InsightCard>
          )}

          {(canGhOnly || forgeDetecting) && (
            <InsightCard
              title={t("insights.dependencies")}
              bodyClassName={CARD_BODY.dependencies}
            >
              {dependencies.isPending ? (
                <ChartSkeleton />
              ) : dependencies.data ? (
                <DependenciesCard data={dependencies.data} />
              ) : (
                <Empty>{t("insights.dependenciesUnavailable")}</Empty>
              )}
            </InsightCard>
          )}

          {(canGhOnly || forgeDetecting) && (
            <InsightCard title={t("insights.moreOnGithub")}>
              {forgeDetecting ? (
                <LinkOutsSkeleton />
              ) : (
                <LinkOutsCard
                  repoPath={repoPath}
                  // Undefined while community loads, which holds the
                  // public-only link's cell; a failed read hides it, and so
                  // does one parked offline, which could hold it for the
                  // whole outage.
                  isPublic={
                    community.isPending && community.fetchStatus !== "paused"
                      ? undefined
                      : community.data
                        ? !community.data.private
                        : false
                  }
                />
              )}
            </InsightCard>
          )}

          {canGh && isGitLab && (
            // GitLab analytics that only render on the web (no usable API) —
            // link out rather than pretend they don't exist.
            <InsightCard title={t("insights.moreOnGitlab")}>
              <GitLabLinkOutsCard repoPath={repoPath} />
            </InsightCard>
          )}

          {canGh && isBitbucket && (
            // Bitbucket views that only render on the web (no usable API) —
            // link out rather than pretend they don't exist.
            <InsightCard title={t("insights.moreOnBitbucket")}>
              <BitbucketLinkOutsCard repoPath={repoPath} />
            </InsightCard>
          )}
        </div>
      </div>
    </div>
  );
}
