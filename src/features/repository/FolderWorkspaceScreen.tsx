import {
  ArrowBendUpLeftIcon,
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  CheckIcon,
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  FolderOpenIcon,
  GitBranchIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { HistoryGraph } from "@/features/repository/HistoryGraph";
import { useBranches, useCheckoutBranch } from "@/lib/git/queries/branches";
import { useRemotes } from "@/lib/git/queries/remotes";
import { useRepoStatus } from "@/lib/git/queries/status";
import { useFetchRemote, usePull, usePush } from "@/lib/git/queries/sync";
import {
  useCommit,
  useOpState,
  useStage,
  useUnstage,
} from "@/lib/git/queries/workingtree";
import type { FileEntry, RepoInfo } from "@/lib/git/types";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";

function relativePath(folder: string, repo: string): string {
  const normalizedFolder = folder.replace(/[\\/]+$/, "");
  const normalizedRepo = repo.replace(/[\\/]+$/, "");
  const folderKey = normalizedFolder.replace(/\\/g, "/");
  const repoKey = normalizedRepo.replace(/\\/g, "/");
  const comparisonFolder = folderKey.toLocaleLowerCase();
  const comparisonRepo = repoKey.toLocaleLowerCase();
  if (!comparisonRepo.startsWith(`${comparisonFolder}/`)) return repo;
  return normalizedRepo.slice(normalizedFolder.length + 1).replace(/\\/g, "/");
}

function FileChangeRow({
  entry,
  action,
  label,
  disabled,
  onActivate,
}: {
  entry: FileEntry;
  action: "stage" | "unstage";
  label: string;
  disabled: boolean;
  onActivate: () => void;
}) {
  const ActionIcon = action === "stage" ? PlusIcon : ArrowBendUpLeftIcon;
  const conflicted =
    entry.staged === "conflicted" || entry.unstaged === "conflicted";
  return (
    <div className="flex min-w-0 items-center gap-2 px-2 py-1.5 hover:bg-muted/40">
      <span
        aria-hidden
        className="shrink-0 font-mono text-[10px] text-muted-foreground"
      >
        {action === "stage" ? (entry.unstaged ?? "") : (entry.staged ?? "")}
      </span>
      <span
        className="min-w-0 flex-1 truncate font-mono text-[11px]"
        title={entry.path}
      >
        {entry.path}
      </span>
      {conflicted ? (
        <span className="shrink-0 text-[10px] text-warning">!</span>
      ) : null}
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        disabled={disabled || conflicted}
        aria-label={label}
        title={conflicted ? undefined : label}
        onClick={onActivate}
      >
        <ActionIcon aria-hidden />
      </Button>
    </div>
  );
}

function RepoPanel({ folder, repo }: { folder: string; repo: RepoInfo }) {
  const { t } = useTranslation("repository");
  const openRepo = useUiStore((s) => s.openRepo);
  const status = useRepoStatus(repo.root);
  const branches = useBranches(repo.root);
  const remotes = useRemotes(repo.root);
  const opState = useOpState(repo.root);
  const stage = useStage(repo.root);
  const unstage = useUnstage(repo.root);
  const commit = useCommit(repo.root);
  const checkout = useCheckoutBranch(repo.root);
  const fetchRemote = useFetchRemote(repo.root);
  const pull = usePull(repo.root);
  const push = usePush(repo.root);
  const [message, setMessage] = useState("");
  const [panelView, setPanelView] = useState<"history" | "changes">("history");

  const entries = status.data?.entries ?? [];
  const staged = entries.filter((entry) => entry.staged !== null);
  const unstaged = entries.filter((entry) => entry.unstaged !== null);
  const stageablePaths = unstaged
    .filter(
      (entry) =>
        entry.unstaged !== "conflicted" && entry.staged !== "conflicted",
    )
    .map((entry) => entry.path);
  const unstagedPaths = staged
    .filter(
      (entry) =>
        entry.staged !== "conflicted" && entry.unstaged !== "conflicted",
    )
    .map((entry) => entry.path);
  const branch = status.data?.branch;
  const hasChanges = entries.length > 0;
  const statusReady = status.isSuccess;
  const branchReady = statusReady && branches.isSuccess;
  const operationReady = opState.isSuccess;
  const operationActive = Boolean(
    opState.data &&
      (opState.data.merging ||
        opState.data.rebasing ||
        opState.data.cherryPicking ||
        opState.data.reverting ||
        opState.data.editPaused),
  );
  const hasRemote = Boolean(remotes.data?.length);
  const remotesReady = remotes.isSuccess;
  const syncBusy =
    fetchRemote.isPending ||
    pull.isPending ||
    push.isPending ||
    checkout.isPending;
  const worktreeBusy = stage.isPending || unstage.isPending || commit.isPending;
  const diverged = Boolean(branch?.ahead && branch.behind);
  const canPush = Boolean(
    branch?.name &&
      !branch.detached &&
      branch.oid &&
      !operationActive &&
      !branch.pushNameMismatch &&
      !diverged &&
      hasRemote &&
      (!branch.upstream || branch.upstreamGone || branch.ahead > 0),
  );
  const canPull = Boolean(
    statusReady &&
      operationReady &&
      remotesReady &&
      branch?.upstream &&
      branch.behind > 0 &&
      !diverged &&
      !hasChanges &&
      !operationActive &&
      hasRemote,
  );
  const cannotSwitchBranch =
    hasChanges ||
    operationActive ||
    worktreeBusy ||
    checkout.isPending ||
    pull.isPending ||
    push.isPending;
  const retryPanelReads = () =>
    void Promise.all([
      status.refetch(),
      branches.refetch(),
      remotes.refetch(),
      opState.refetch(),
    ]);
  const relative = relativePath(folder, repo.root);

  async function perform(action: () => Promise<unknown>, success: string) {
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toastError(error);
    }
  }

  async function commitStaged() {
    if (!branch || !message.trim() || staged.length === 0) return;
    try {
      const result = await commit.mutateAsync({
        title: message.trim(),
        expectedHead: branch.oid,
        expectedBranch: branch.name,
      });
      setMessage("");
      toast.success(
        t("folderWorkspace.committed", { hash: result.hash.slice(0, 7) }),
      );
    } catch (error) {
      toastError(error);
    }
  }

  async function selectBranch(name: string) {
    if (!name || name === branch?.name || cannotSwitchBranch) return;
    await perform(
      () => checkout.mutateAsync(name),
      t("folderWorkspace.branchChanged", { name }),
    );
  }

  return (
    <section className="flex min-h-[34rem] min-w-0 flex-col border border-border bg-background">
      <header className="flex min-w-0 items-start justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold" title={repo.name}>
            {repo.name}
          </h2>
          <p
            className="truncate font-mono text-[10px] text-muted-foreground"
            title={repo.root}
          >
            {relative}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="shrink-0"
          onClick={() => openRepo(repo)}
        >
          <ArrowSquareOutIcon data-icon="inline-start" aria-hidden />
          {t("folderWorkspace.openFull")}
        </Button>
      </header>

      <div className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2">
        <GitBranchIcon
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        {branches.isPending ? (
          <Spinner className="size-3.5" />
        ) : branches.data?.length ? (
          <select
            aria-label={t("folderWorkspace.branch")}
            value={branch?.name ?? ""}
            onChange={(event) => void selectBranch(event.currentTarget.value)}
            disabled={
              !branchReady ||
              !operationReady ||
              cannotSwitchBranch ||
              checkout.isPending ||
              !branch?.name
            }
            className="h-7 min-w-0 flex-1 border border-input bg-background px-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
          >
            {branch?.detached ? (
              <option value="" disabled>
                {t("folderWorkspace.detached")}
              </option>
            ) : null}
            {branches.data.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {branch?.detached
              ? t("folderWorkspace.detached")
              : t("folderWorkspace.noBranch")}
          </span>
        )}
        {checkout.isPending ? <Spinner className="size-3.5" /> : null}
      </div>

      {status.isPending ? (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
          <Spinner className="size-3" />
          {t("folderWorkspace.loadingStatus")}
        </div>
      ) : null}
      {status.isError ||
      branches.isError ||
      remotes.isError ||
      opState.isError ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-[11px] text-destructive"
        >
          <span>{t("folderWorkspace.readError")}</span>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={retryPanelReads}
          >
            {t("folderWorkspace.retry")}
          </Button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={!remotesReady || !hasRemote || syncBusy}
            onClick={() =>
              void perform(
                () => fetchRemote.mutateAsync(),
                t("folderWorkspace.fetched", { name: repo.name }),
              )
            }
          >
            {fetchRemote.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <CloudArrowDownIcon data-icon="inline-start" aria-hidden />
            )}
            {t("folderWorkspace.fetch")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={!canPull || syncBusy}
            title={
              hasChanges
                ? t("folderWorkspace.commitBeforePull")
                : diverged
                  ? t("folderWorkspace.diverged")
                  : undefined
            }
            onClick={() =>
              void perform(
                () => pull.mutateAsync("ffOnly"),
                t("folderWorkspace.pulled", { name: repo.name }),
              )
            }
          >
            {pull.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <ArrowClockwiseIcon data-icon="inline-start" aria-hidden />
            )}
            {t("folderWorkspace.pull")}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={
              !statusReady ||
              !operationReady ||
              !remotesReady ||
              !canPush ||
              syncBusy
            }
            title={
              branch?.pushNameMismatch
                ? t("folderWorkspace.pushMismatch")
                : diverged
                  ? t("folderWorkspace.diverged")
                  : undefined
            }
            onClick={() =>
              void perform(
                () =>
                  push.mutateAsync({
                    setUpstream: Boolean(
                      !branch?.upstream || branch.upstreamGone,
                    ),
                  }),
                t("folderWorkspace.pushed", { name: repo.name }),
              )
            }
          >
            {push.isPending ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <CloudArrowUpIcon data-icon="inline-start" aria-hidden />
            )}
            {branch?.upstream
              ? t("folderWorkspace.push")
              : t("folderWorkspace.publish")}
          </Button>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {branch?.upstream
            ? t("folderWorkspace.aheadBehind", {
                ahead: branch.ahead,
                behind: branch.behind,
              })
            : t("folderWorkspace.noUpstream")}
        </span>
      </div>

      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        <Button
          type="button"
          size="xs"
          variant="ghost"
          aria-pressed={panelView === "history"}
          className={panelView === "history" ? "bg-muted font-medium" : ""}
          onClick={() => setPanelView("history")}
        >
          {t("folderWorkspace.history")}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          aria-pressed={panelView === "changes"}
          className={panelView === "changes" ? "bg-muted font-medium" : ""}
          onClick={() => setPanelView("changes")}
        >
          {t("folderWorkspace.changes")}
          {hasChanges ? (
            <span className="ml-1 font-mono text-[10px] text-muted-foreground">
              {entries.length}
            </span>
          ) : null}
        </Button>
      </div>

      {panelView === "history" ? (
        <div className="min-h-0 flex-1">
          <HistoryGraph
            repoPath={repo.root}
            active
            onSelectCommit={(hash) => openRepo(repo, hash)}
          />
        </div>
      ) : (
        <>
          <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            <ChangeList
              action="stage"
              entries={unstaged}
              paths={stageablePaths}
              busy={!statusReady || !operationReady || worktreeBusy}
              onRun={(paths) => void stage.mutateAsync(paths).catch(toastError)}
              label={t("folderWorkspace.unstaged")}
              empty={
                status.isPending
                  ? t("folderWorkspace.loadingStatus")
                  : status.isError
                    ? t("folderWorkspace.statusUnavailable")
                    : t("folderWorkspace.noUnstaged")
              }
              allLabel={t("folderWorkspace.stageAll")}
              t={t}
            />
            <ChangeList
              action="unstage"
              entries={staged}
              paths={unstagedPaths}
              busy={!statusReady || !operationReady || worktreeBusy}
              onRun={(paths) =>
                void unstage.mutateAsync(paths).catch(toastError)
              }
              label={t("folderWorkspace.staged")}
              empty={
                status.isPending
                  ? t("folderWorkspace.loadingStatus")
                  : status.isError
                    ? t("folderWorkspace.statusUnavailable")
                    : t("folderWorkspace.noStaged")
              }
              allLabel={t("folderWorkspace.unstageAll")}
              t={t}
            />
          </div>

          <footer className="border-t border-border p-3">
            <label className="mb-1.5 block text-[10px] font-medium text-muted-foreground">
              {t("folderWorkspace.commitMessage")}
            </label>
            <div className="flex items-center gap-2">
              <input
                value={message}
                onChange={(event) => setMessage(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.ctrlKey || event.metaKey)
                  ) {
                    event.preventDefault();
                    void commitStaged();
                  }
                }}
                placeholder={t("folderWorkspace.commitPlaceholder")}
                aria-label={t("folderWorkspace.commitMessage")}
                className="h-8 min-w-0 flex-1 border border-input bg-background px-2 text-xs outline-none placeholder:text-muted-foreground/80 focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
                disabled={
                  !statusReady ||
                  !operationReady ||
                  staged.length === 0 ||
                  commit.isPending
                }
              />
              <Button
                type="button"
                size="sm"
                disabled={
                  !statusReady ||
                  !operationReady ||
                  !message.trim() ||
                  staged.length === 0 ||
                  commit.isPending ||
                  !branch
                }
                onClick={() => void commitStaged()}
              >
                {commit.isPending ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <CheckIcon data-icon="inline-start" aria-hidden />
                )}
                {t("folderWorkspace.commit")}
              </Button>
            </div>
            {hasChanges ? (
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                {t("folderWorkspace.commitBeforeSwitch")}
              </p>
            ) : null}
            {operationActive ? (
              <p className="mt-1.5 text-[10px] text-warning">
                {t("folderWorkspace.finishOperationInFullView")}
              </p>
            ) : null}
            {remotes.isSuccess && !hasRemote ? (
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                {t("folderWorkspace.noRemote")}
              </p>
            ) : null}
          </footer>
        </>
      )}
    </section>
  );
}

function ChangeList({
  action,
  entries,
  paths,
  busy,
  onRun,
  label,
  empty,
  allLabel,
  t,
}: {
  action: "stage" | "unstage";
  entries: FileEntry[];
  paths: string[];
  busy: boolean;
  onRun: (paths: string[]) => void;
  label: string;
  empty: string;
  allLabel: string;
  t: TFunction<"repository">;
}) {
  return (
    <section className="flex min-h-40 min-w-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
        <h3 className="text-[11px] font-medium">{label}</h3>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-muted-foreground">
            {entries.length}
          </span>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={paths.length === 0 || busy}
            onClick={() => onRun(paths)}
          >
            {action === "stage" ? (
              <PlusIcon data-icon="inline-start" />
            ) : (
              <ArrowBendUpLeftIcon data-icon="inline-start" />
            )}
            {allLabel}
          </Button>
        </div>
      </div>
      <div className="max-h-44 min-h-0 flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <p className="px-2.5 py-3 text-[10px] text-muted-foreground">
            {empty}
          </p>
        ) : (
          entries.map((entry) => (
            <FileChangeRow
              key={entry.path}
              entry={entry}
              action={action}
              label={t(
                action === "stage"
                  ? "folderWorkspace.stageFile"
                  : "folderWorkspace.unstageFile",
                { file: entry.path },
              )}
              disabled={busy}
              onActivate={() => {
                if (
                  entry.staged === "conflicted" ||
                  entry.unstaged === "conflicted"
                )
                  return;
                onRun([entry.path]);
              }}
            />
          ))
        )}
      </div>
    </section>
  );
}

export function FolderWorkspaceScreen() {
  const { t } = useTranslation("repository");
  const workspace = useUiStore((s) => s.folderWorkspace);
  const closeWorkspace = useUiStore((s) => s.closeFolderWorkspace);

  if (!workspace) return null;

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-border bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <FolderOpenIcon
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">
              {t("folderWorkspace.title", {
                count: workspace.repositories.length,
              })}
            </h1>
            <p
              className="truncate font-mono text-[10px] text-muted-foreground"
              title={workspace.root}
            >
              {workspace.root}
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={closeWorkspace}
        >
          {t("folderWorkspace.close")}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="mx-auto grid max-w-[1800px] grid-cols-1 gap-3 xl:grid-cols-2">
          {workspace.repositories.map((repo) => (
            <RepoPanel key={repo.root} folder={workspace.root} repo={repo} />
          ))}
        </div>
      </div>
    </main>
  );
}
