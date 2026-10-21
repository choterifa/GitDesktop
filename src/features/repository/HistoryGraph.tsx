import {
  ArrowClockwiseIcon,
  GitBranchIcon,
  GitCommitIcon,
  TagIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { RelativeTime } from "@/components/relative-time";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { clipTitleFromText } from "@/lib/clip-title";
import { useHistoryGraph } from "@/lib/git/queries";
import { repoKeys } from "@/lib/git/queries/core";
import type { HistoryGraphCommit, HistoryGraphRef } from "@/lib/git/types";
import { useCommonText } from "@/lib/i18n/use-common-text";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 42;
const LANE_WIDTH = 16;
const GRAPH_GUTTER = 12;
const LANE_STROKES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

interface GraphRow {
  commit: HistoryGraphCommit;
  lane: number;
}

interface GraphEdge {
  fromRow: number;
  fromLane: number;
  toRow: number | null;
  toLane: number;
}

interface GraphLayout {
  rows: GraphRow[];
  edges: GraphEdge[];
  laneCount: number;
}

function layoutGraph(commits: HistoryGraphCommit[]): GraphLayout {
  const indexByHash = new Map(
    commits.map((commit, index) => [commit.hash, index]),
  );
  const expectedLaneByHash = new Map<string, number>();
  const availableLanes: number[] = [];
  const availableLaneSet = new Set<number>();
  const rows: GraphRow[] = [];
  const edges: GraphEdge[] = [];
  let laneCount = 1;
  let nextLane = 0;

  const releaseLane = (lane: number) => {
    if (availableLaneSet.has(lane)) return;
    availableLaneSet.add(lane);
    availableLanes.push(lane);
  };
  const allocateLane = () => {
    while (
      availableLanes.length > 0 &&
      !availableLaneSet.has(availableLanes[availableLanes.length - 1]!)
    )
      availableLanes.pop();
    const lane = availableLanes.pop();
    if (lane !== undefined) {
      availableLaneSet.delete(lane);
      return lane;
    }
    const freshLane = nextLane;
    nextLane += 1;
    laneCount = Math.max(laneCount, freshLane + 1);
    return freshLane;
  };

  for (let index = 0; index < commits.length; index += 1) {
    const commit = commits[index];
    if (!commit) continue;
    const expectedLane = expectedLaneByHash.get(commit.hash);
    const lane = expectedLane === undefined ? allocateLane() : expectedLane;
    expectedLaneByHash.delete(commit.hash);
    laneCount = Math.max(laneCount, lane + 1);
    releaseLane(lane);
    rows.push({ commit, lane });

    for (
      let parentIndex = 0;
      parentIndex < commit.parents.length;
      parentIndex += 1
    ) {
      const parent = commit.parents[parentIndex];
      if (!parent) continue;
      let parentLane = expectedLaneByHash.get(parent);
      if (parentLane === undefined) {
        if (parentIndex === 0) {
          parentLane = lane;
          availableLaneSet.delete(lane);
        } else {
          parentLane = allocateLane();
        }
        expectedLaneByHash.set(parent, parentLane);
      }
      laneCount = Math.max(laneCount, parentLane + 1);
      const parentRow = indexByHash.get(parent);
      edges.push({
        fromRow: index,
        fromLane: lane,
        toRow: parentRow !== undefined && parentRow > index ? parentRow : null,
        toLane: parentLane,
      });
    }
  }

  return { rows, edges, laneCount };
}

const REF_CLASS: Record<HistoryGraphRef["kind"], string> = {
  head: "border-primary/50 bg-primary/10 text-primary",
  local: "border-border bg-muted/50 text-foreground",
  remote: "border-info/40 bg-info/10 text-info",
  tag: "border-border bg-muted/50 text-foreground",
  other: "border-border bg-muted/50 text-muted-foreground",
};

function GraphRefPill({ refItem }: { refItem: HistoryGraphRef }) {
  const Icon = refItem.kind === "tag" ? TagIcon : GitBranchIcon;
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-48 shrink-0 items-center gap-1 overflow-hidden border px-1.5 text-[10px] leading-none",
        REF_CLASS[refItem.kind],
      )}
      onMouseEnter={clipTitleFromText}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{refItem.name}</span>
    </span>
  );
}

function GraphSkeleton() {
  const { t } = useTranslation("history");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <span role="status" className="sr-only">
        {t("graph.loading")}
      </span>
      <div aria-busy className="flex-1 overflow-hidden">
        {Array.from({ length: 7 }, (_, index) => (
          <div
            key={index}
            className="flex h-[42px] items-center gap-3 border-b px-4"
          >
            <Skeleton className="size-2.5 rounded-full" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="ml-auto h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

function GraphMessage({
  title,
  description,
  icon: Icon,
  action,
}: {
  title: string;
  description: string;
  icon: typeof GitCommitIcon;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        {action ? <EmptyContent>{action}</EmptyContent> : null}
      </Empty>
    </div>
  );
}

function VirtualGraphRows({
  layout,
  graphWidth,
  onSelect,
}: {
  layout: GraphLayout;
  graphWidth: number;
  onSelect: (hash: string) => void;
}) {
  const { t } = useTranslation("history");
  const tx = useCommonText();
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [focusedHash, setFocusedHash] = useState<string | null>(null);
  const pendingFocus = useRef(false);
  const rowCount = layout.rows.length;
  const graphHeight = rowCount * ROW_HEIGHT;
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => layout.rows[index]!.commit.hash,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const focusedIndex = layout.rows.findIndex(
    (row) => row.commit.hash === focusedHash,
  );
  const firstVisibleIndex = virtualRows[0]?.index ?? 0;
  const lastVisibleIndex = virtualRows.at(-1)?.index ?? firstVisibleIndex;
  const tabStopHash =
    focusedIndex >= firstVisibleIndex && focusedIndex <= lastVisibleIndex
      ? focusedHash
      : layout.rows[firstVisibleIndex]?.commit.hash;

  useEffect(() => {
    if (!pendingFocus.current || !focusedHash || !scrollEl) return;
    const raf = requestAnimationFrame(() => {
      scrollEl
        .querySelector<HTMLElement>(
          `[data-graph-hash="${CSS.escape(focusedHash)}"]`,
        )
        ?.focus();
      pendingFocus.current = false;
    });
    return () => cancelAnimationFrame(raf);
  }, [focusedHash, scrollEl]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    if (rowCount === 0) return;
    event.preventDefault();
    const currentIndex = layout.rows.findIndex(
      (row) => row.commit.hash === focusedHash,
    );
    const nextIndex =
      event.key === "ArrowDown"
        ? Math.min(currentIndex + 1, rowCount - 1)
        : currentIndex === -1
          ? rowCount - 1
          : Math.max(currentIndex - 1, 0);
    const nextRow = layout.rows[nextIndex];
    if (!nextRow) return;
    pendingFocus.current = true;
    setFocusedHash(nextRow.commit.hash);
    virtualizer.scrollToIndex(nextIndex, { align: "auto" });
  };

  const visibleEdges = layout.edges.filter((edge) => {
    const edgeEnd = edge.toRow ?? rowCount - 1;
    return edge.fromRow <= lastVisibleIndex && edgeEnd >= firstVisibleIndex;
  });

  return (
    <div ref={setScrollEl} className="min-h-0 flex-1 overflow-auto">
      <div
        role="group"
        aria-label={tx("Repository commit graph")}
        onKeyDown={onKeyDown}
        className="relative"
        style={{
          minWidth: `${graphWidth + 420}px`,
          height: `${virtualizer.getTotalSize()}px`,
        }}
      >
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0"
          width={graphWidth}
          height={virtualizer.getTotalSize()}
        >
          {visibleEdges.map((edge) => {
            const x1 = GRAPH_GUTTER + edge.fromLane * LANE_WIDTH;
            const x2 = GRAPH_GUTTER + edge.toLane * LANE_WIDTH;
            const y1 = edge.fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;
            const y2 =
              edge.toRow === null
                ? graphHeight
                : edge.toRow * ROW_HEIGHT + ROW_HEIGHT / 2;
            const middle = y1 + (y2 - y1) / 2;
            return (
              <path
                key={`${edge.fromRow}:${edge.toLane}:${edge.toRow ?? "end"}`}
                d={`M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`}
                fill="none"
                stroke={LANE_STROKES[edge.fromLane % LANE_STROKES.length]}
                strokeWidth="1.5"
                opacity="0.85"
              />
            );
          })}
          {virtualRows.map(({ index }) => {
            const row = layout.rows[index];
            if (!row) return null;
            const { commit, lane } = row;
            const cx = GRAPH_GUTTER + lane * LANE_WIDTH;
            const cy = index * ROW_HEIGHT + ROW_HEIGHT / 2;
            const stroke = LANE_STROKES[lane % LANE_STROKES.length];
            return (
              <g key={commit.hash}>
                {commit.parents.length > 1 ? (
                  <circle
                    cx={cx}
                    cy={cy}
                    r="5.5"
                    fill="var(--background)"
                    stroke={stroke}
                    strokeWidth="1"
                  />
                ) : null}
                <circle
                  cx={cx}
                  cy={cy}
                  r="3.5"
                  fill={
                    commit.refs.some((ref) => ref.kind === "head")
                      ? "var(--primary)"
                      : "var(--background)"
                  }
                  stroke={stroke}
                  strokeWidth="1.5"
                />
              </g>
            );
          })}
        </svg>
        <div
          className="relative w-full"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualRows.map((virtualRow) => {
            const row = layout.rows[virtualRow.index];
            if (!row) return null;
            const { commit } = row;
            const parentDescription =
              commit.parents.length === 0
                ? t("graph.rootDescription")
                : t(
                    commit.parents.length > 1
                      ? "graph.mergeParents"
                      : "graph.parents",
                    { parents: commit.parents.join(", ") },
                  );
            const refDescription = commit.refs
              .map((ref) => `${t(`graph.refKind.${ref.kind}`)} ${ref.name}`)
              .join(", ");
            return (
              <button
                key={virtualRow.key}
                type="button"
                data-graph-hash={commit.hash}
                tabIndex={commit.hash === tabStopHash ? 0 : -1}
                className="absolute top-0 flex h-[42px] w-full items-center gap-2 border-b px-3 text-left outline-none hover:bg-muted/50 focus-visible:z-10 focus-visible:bg-accent/50 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                  minWidth: `${graphWidth + 420}px`,
                  paddingLeft: `${graphWidth + 12}px`,
                }}
                onFocus={() => setFocusedHash(commit.hash)}
                onClick={() => onSelect(commit.hash)}
                aria-label={t("graph.commitAria", {
                  subject: commit.subject,
                  hash: commit.hash,
                  parents: parentDescription,
                  refs: refDescription ? `, ${refDescription}` : "",
                })}
              >
                <span
                  className="min-w-0 flex-1 truncate text-xs"
                  onMouseEnter={clipTitleFromText}
                >
                  {commit.subject}
                </span>
                <span className="flex min-w-0 max-w-[50%] items-center gap-1 overflow-hidden">
                  {commit.refs.map((ref) => (
                    <GraphRefPill
                      key={`${ref.kind}:${ref.name}`}
                      refItem={ref}
                    />
                  ))}
                </span>
                <code className="shrink-0 text-[10px] text-muted-foreground">
                  {commit.hash.slice(0, 7)}
                </code>
                <span className="hidden shrink-0 text-[10px] text-muted-foreground xl:block">
                  <RelativeTime date={commit.date} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function HistoryGraph({
  repoPath,
  active,
  onSelectCommit,
}: {
  repoPath: string;
  active: boolean;
  onSelectCommit?: (hash: string) => void;
}) {
  const { t } = useTranslation("history");
  const graph = useHistoryGraph(repoPath, active);
  const queryClient = useQueryClient();
  const selectCommit = useUiStore((s) => s.selectCommit);
  const commits = useMemo(() => graph.data?.pages.flat() ?? [], [graph.data]);
  const layout = useMemo(() => layoutGraph(commits), [commits]);
  const graphWidth = GRAPH_GUTTER * 2 + layout.laneCount * LANE_WIDTH;

  if (graph.isPending) return <GraphSkeleton />;
  if (graph.isError && commits.length === 0) {
    return (
      <GraphMessage
        title={t("graph.loadErrorTitle")}
        description={t("graph.loadErrorDescription")}
        icon={WarningCircleIcon}
        action={
          <Button variant="outline" onClick={() => void graph.refetch()}>
            <ArrowClockwiseIcon data-icon="inline-start" />
            {t("graph.retry")}
          </Button>
        }
      />
    );
  }
  if (commits.length === 0) {
    return (
      <GraphMessage
        title={t("graph.emptyTitle")}
        description={t("graph.emptyDescription")}
        icon={GitCommitIcon}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-9 shrink-0 items-center justify-between border-b px-3 text-[11px]">
        <span className="font-medium">{t("graph.title")}</span>
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>{t("graph.loaded", { count: commits.length })}</span>
          <Button
            variant="ghost"
            size="xs"
            aria-label={t("graph.refresh")}
            title={t("graph.refreshTitle")}
            onClick={() =>
              void queryClient.resetQueries({
                queryKey: repoKeys.historyGraph(repoPath),
                exact: true,
              })
            }
          >
            <ArrowClockwiseIcon data-icon="inline-start" />
            {t("graph.refresh")}
          </Button>
        </div>
      </header>
      {graph.isError ? (
        <div
          role="status"
          className="flex items-center justify-between border-b px-3 py-1.5 text-xs text-destructive"
        >
          <span>{t("graph.refreshError")}</span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void graph.refetch()}
          >
            {t("graph.retry")}
          </Button>
        </div>
      ) : null}
      <VirtualGraphRows
        layout={layout}
        graphWidth={graphWidth}
        onSelect={onSelectCommit ?? selectCommit}
      />
      {graph.isFetchNextPageError ? (
        <div
          role="status"
          className="flex shrink-0 items-center justify-center gap-2 border-t px-3 py-2 text-xs text-destructive"
        >
          <span>{t("graph.olderError")}</span>
          <Button
            variant="outline"
            size="xs"
            onClick={() => void graph.fetchNextPage()}
          >
            {t("graph.retry")}
          </Button>
        </div>
      ) : graph.hasNextPage ? (
        <div className="flex shrink-0 justify-center border-t px-3 py-2">
          <Button
            variant="ghost"
            size="xs"
            disabled={graph.isFetchingNextPage}
            onClick={() => void graph.fetchNextPage()}
          >
            {graph.isFetchingNextPage
              ? t("graph.loadingOlder")
              : t("graph.loadOlder")}
          </Button>
        </div>
      ) : (
        <div className="shrink-0 border-t px-3 py-2 text-center text-[10px] text-muted-foreground">
          {t("graph.end")}
        </div>
      )}
    </div>
  );
}
