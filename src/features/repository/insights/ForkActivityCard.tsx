import {
  ArrowSquareOutIcon,
  LockSimpleIcon,
  StarIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RelativeTime } from "@/components/relative-time";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { refreshFailed } from "@/features/conversations/remote-section-state";
import { starParts } from "@/features/explore/explore-utils";
import { clipTitleFromText } from "@/lib/clip-title";
import { forgeRepoUrl } from "@/lib/git/api";
import { useForkDivergence } from "@/lib/git/queries";
import {
  type ForgeForkActivity,
  type ForgeForkEntry,
  type ForgeProvider,
  providerLabel,
} from "@/lib/git/types";
import { parseableDate } from "@/lib/time";
import { toastError } from "@/lib/toast";
import { Empty } from "./primitives";

// The provider's own full fork list, which this card summarizes to 10 rows.
// Bitbucket names that page "descendants": `/forks` 404s there (probed
// 2026-08-26).
const ALL_FORKS_SUFFIX: Record<ForgeProvider, string> = {
  github: "/network/members",
  gitlab: "/-/forks",
  bitbucket: "/descendants",
};

/** One row's ahead/behind, fetched only after its Compare is clicked. Owns the
 *  request state so a row's fetch never re-renders its siblings; the query key is
 *  per fork and branch pair, so a re-render (or re-opening Insights) reuses the
 *  cached result. */
function CompareCell({
  repoPath,
  entry,
  baseBranch,
}: {
  repoPath: string;
  entry: ForgeForkEntry;
  baseBranch: string;
}) {
  const { t } = useTranslation("repository");
  const [requested, setRequested] = useState(false);
  // The control the user clicked unmounts as its result arrives, so focus would
  // fall to <body>. react-query's notify batching can land the result after any
  // frame scheduled from the click, so the follow-up rides the commit instead.
  const pendingFocusRef = useRef(false);
  // The parked line took the click's focus. It hands focus on only if it still
  // held it when it unmounted (focus then sits on <body>): the user may have
  // moved on during an outage of any length.
  const offlineHeldRef = useRef(false);
  const resultRef = useRef<HTMLSpanElement | null>(null);
  const retryRef = useRef<HTMLButtonElement | null>(null);
  const offlineRef = useRef<HTMLSpanElement | null>(null);
  const divergence = useForkDivergence(
    repoPath,
    entry.fullName,
    baseBranch,
    entry.defaultBranch,
    requested,
  );

  const failed = refreshFailed(divergence);
  useLayoutEffect(() => {
    if (offlineHeldRef.current && !divergence.isPaused) {
      offlineHeldRef.current = false;
      const active = document.activeElement;
      if (active === null || active === document.body)
        pendingFocusRef.current = true;
    }
    if (!pendingFocusRef.current) return;
    if (divergence.data) {
      pendingFocusRef.current = false;
      resultRef.current?.focus();
    } else if (failed && divergence.errorUpdatedAt) {
      pendingFocusRef.current = false;
      retryRef.current?.focus();
    } else if (divergence.isPaused) {
      pendingFocusRef.current = false;
      offlineHeldRef.current = true;
      offlineRef.current?.focus();
    }
    // errorUpdatedAt: a repeated failure changes neither `data` nor `isError`,
    // and a still-armed flag would let a much-later background success steal focus.
  }, [divergence.data, failed, divergence.isPaused, divergence.errorUpdatedAt]);

  // Resolved counts outrank an in-flight fetch: `refetchOnWindowFocus` re-runs a
  // stale compare on every alt-tab, and dropping back to a skeleton would erase
  // numbers the user is reading.
  if (divergence.data) {
    return (
      <span
        ref={resultRef}
        tabIndex={-1}
        aria-live="polite"
        className="tabular-nums"
      >
        {t("insights.aheadCount", { count: divergence.data.aheadBy })} ·{" "}
        {t("insights.behindCount", { count: divergence.data.behindBy })}
      </span>
    );
  }
  // Parked offline, first ask or retry alike: a Retry would only park again,
  // and reconnecting resumes the compare by itself.
  if (divergence.isPaused) {
    return (
      <span ref={offlineRef} tabIndex={-1} aria-live="polite">
        {t("insights.offlineComparison")}
      </span>
    );
  }
  if (failed) {
    return (
      <span aria-live="polite" className="flex items-center gap-1">
        {t("insights.couldntCompare")}
        <Button
          ref={retryRef}
          type="button"
          size="xs"
          variant="ghost"
          aria-label={t("insights.retryComparingFork", {
            name: entry.fullName,
          })}
          onClick={() => {
            pendingFocusRef.current = true;
            void divergence.refetch();
          }}
        >
          {t("insights.retry")}
        </Button>
      </span>
    );
  }
  if (divergence.isFetching) return <Skeleton className="h-3 w-16" />;
  return (
    <Button
      type="button"
      size="xs"
      variant="ghost"
      aria-label={t("insights.compareFork", { name: entry.fullName })}
      onClick={() => {
        pendingFocusRef.current = true;
        setRequested(true);
      }}
    >
      {t("insights.compare")}
    </Button>
  );
}

function ForkRow({
  repoPath,
  entry,
  provider,
  baseBranch,
  canCompare,
}: {
  repoPath: string;
  entry: ForgeForkEntry;
  provider: ForgeProvider;
  baseBranch: string | null;
  canCompare: boolean;
}) {
  const { t } = useTranslation("repository");
  // Zero stars says nothing a reader needs, and at ten-row density the repeated
  // "0" reads as noise — so the segment drops entirely rather than showing it.
  const star = (entry.stars ?? 0) > 0 ? starParts(entry.stars) : null;
  // Without both branch names there is nothing to compare, so the affordance
  // doesn't render at all rather than sitting disabled.
  const comparable = canCompare && baseBranch && entry.defaultBranch;

  // The right side is one sentence, not a pile of chips: whichever segments this
  // fork has, joined by decorative separators.
  const segments: { key: string; node: React.ReactNode }[] = [];
  if (entry.activeAt && parseableDate(entry.activeAt)) {
    segments.push({
      key: "active",
      node: (
        <span>
          {t(`insights.forkActivityVerb.${provider}`)}{" "}
          <RelativeTime date={entry.activeAt} />
        </span>
      ),
    });
  }
  if (star) {
    segments.push({
      key: "stars",
      node: (
        // role="img" prunes the icon AND the number, so the label carries both
        // the count and its unit.
        <span
          role="img"
          aria-label={star.label}
          title={star.label}
          className="flex items-center gap-0.5"
        >
          <StarIcon className="size-3" aria-hidden />
          {star.text}
        </span>
      ),
    });
  }
  if (comparable) {
    segments.push({
      key: "compare",
      node: (
        <CompareCell
          repoPath={repoPath}
          entry={entry}
          baseBranch={baseBranch}
        />
      ),
    });
  }

  return (
    <li className="flex items-baseline justify-between gap-3 text-xs">
      <span className="flex min-w-0 items-baseline gap-1">
        {entry.isPrivate && (
          // Same lock glyph and labelling as Explore's repo rows; every row here
          // is a fork, so the glyph only has to distinguish private ones.
          <span
            role="img"
            aria-label={t("insights.privateFork")}
            title={t("insights.privateFork")}
            className="flex shrink-0 self-center text-muted-foreground"
          >
            <LockSimpleIcon className="size-3" aria-hidden />
          </span>
        )}
        {/* A fork with no web URL stays plain text — a link that can only fail
            is worse than none. */}
        {entry.webUrl ? (
          <button
            type="button"
            className="min-w-0 cursor-pointer truncate text-left hover:underline focus-visible:underline focus-visible:outline-none"
            onMouseEnter={clipTitleFromText}
            onClick={() => openUrl(entry.webUrl).catch(toastError)}
          >
            {entry.fullName}
          </button>
        ) : (
          <span className="min-w-0 truncate" onMouseEnter={clipTitleFromText}>
            {entry.fullName}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-baseline gap-1 tabular-nums text-muted-foreground">
        {segments.map((segment, i) => (
          <Fragment key={segment.key}>
            {i > 0 && <span aria-hidden="true">·</span>}
            {segment.node}
          </Fragment>
        ))}
      </span>
    </li>
  );
}

/** The repo's most-recently-active direct forks, with an on-demand ahead/behind
 *  per row where the provider can compare. */
export function ForkActivityCard({
  repoPath,
  data,
  provider,
  canCompare,
}: {
  repoPath: string;
  data: ForgeForkActivity;
  provider: ForgeProvider;
  canCompare: boolean;
}) {
  const { t } = useTranslation("repository");
  async function openAllForks() {
    try {
      const url = await forgeRepoUrl(repoPath);
      if (!url) return;
      await openUrl(`${url}${ALL_FORKS_SUFFIX[provider]}`);
    } catch (e) {
      toastError(e);
    }
  }

  // A counted-but-unlisted fork is the private-fork case: the provider reports it
  // in the total and withholds the row.
  if (data.forks.length === 0 && (data.totalCount ?? 0) > 0) {
    return <Empty>{t("insights.noVisibleForks")}</Empty>;
  }
  if (data.forks.length === 0) return <Empty>{t("insights.noForksYet")}</Empty>;

  return (
    <div className="space-y-3">
      <ul className="space-y-0.5">
        {data.forks.map((entry) => (
          <ForkRow
            key={entry.fullName}
            repoPath={repoPath}
            entry={entry}
            provider={provider}
            baseBranch={data.defaultBranch}
            canCompare={canCompare}
          />
        ))}
      </ul>
      <div>
        <Button
          variant="outline"
          size="sm"
          className="cursor-pointer justify-start"
          onClick={openAllForks}
        >
          <ArrowSquareOutIcon data-icon="inline-start" />
          {t("insights.allForksOn", { provider: providerLabel(provider) })}
        </Button>
      </div>
    </div>
  );
}
