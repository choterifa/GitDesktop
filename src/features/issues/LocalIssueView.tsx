import { Popover } from "@base-ui/react/popover";
import {
  ArchiveIcon,
  ArrowCounterClockwiseIcon,
  DotsThreeIcon,
  GithubLogoIcon,
  GitlabLogoIcon,
  KanbanIcon,
  PencilSimpleIcon,
  TagIcon,
  TrashIcon,
  UploadSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DisabledReasonButton } from "@/components/disabled-reason-button";
import { Markdown } from "@/components/markdown/markdown";
import { usePanelPortalContainer } from "@/components/panel-portal";
import { RelativeTime } from "@/components/relative-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { CommentComposer } from "@/features/conversations/CommentComposer";
import { ConversationScrollArea } from "@/features/conversations/ConversationScrollArea";
import { DeleteCommentDialog } from "@/features/conversations/DeleteCommentDialog";
import {
  EditTitleBodyDialog,
  useEditTitleBody,
} from "@/features/conversations/EditTitleBodyDialog";
import { LocalComment } from "@/features/conversations/LocalComment";
import { useLocalConversation } from "@/features/conversations/useLocalConversation";
import { useMentionCandidates } from "@/features/conversations/useMentionCandidates";
import { useThreadJumpHotkeys } from "@/features/conversations/useThreadJumpHotkeys";
import { DiffPlaceholder } from "@/features/diff/DiffPlaceholder";
import { copyText } from "@/lib/clipboard";
import {
  forgeFeatureReady,
  pendingWriteMatching,
  useForgeStatus,
  usePendingRepoWrites,
} from "@/lib/git/queries";
import { useHotkeyAction } from "@/lib/hotkeys/hotkeys";
import {
  LOCAL_ISSUE_WRITES_FAMILY,
  useDeleteLocalIssue,
  useLocalIssues,
  useUpdateLocalIssue,
} from "@/lib/issues/queries";
import { useJiraLink, useJiraPermissions } from "@/lib/jira/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { PlanIssueButton } from "../plan/PlanIssueButton";
import { SolveIssueButton } from "../sessions/SolveIssueButton";
import { PromoteLocalIssueDialog } from "./PromoteLocalIssueDialog";

export function LocalIssueView({
  repoPath,
  id,
}: {
  repoPath: string;
  id: string;
}) {
  const { t } = useTranslation("issues");
  const issues = useLocalIssues(repoPath);
  const issue = issues.data?.find((i) => i.id === id);
  const update = useUpdateLocalIssue(repoPath);
  const del = useDeleteLocalIssue(repoPath);
  // Every local-issue write in flight, read per issue below: this view outlives an
  // issue switch, and its observers would hold whichever issue is shown next.
  const localWrites = usePendingRepoWrites(LOCAL_ISSUE_WRITES_FAMILY, repoPath);
  const selectIssue = useUiStore((s) => s.selectIssue);
  const selectedIssue = useUiStore((s) => s.selectedIssue);
  const ghStatus = useForgeStatus(repoPath);
  const provider = ghStatus.data?.provider;
  // A local issue's body and comments autolink the forge's references like any
  // other body, and its editors complete them. Local issues have no lens, so
  // the candidate lists come off "origin".
  const mentions = useMentionCandidates({ repoPath, lens: "origin", provider });
  // Two independent publish gates: the forge's static issue-create capability
  // and a live per-user Jira permission probe. The Publish affordance shows when
  // EITHER is available; the dialog itself parameterizes / offers a choice.
  const canPublishForge = forgeFeatureReady(ghStatus.data, "issueCreate");
  const jiraLink = useJiraLink(repoPath).data;
  const jiraPerms = useJiraPermissions(repoPath, jiraLink);
  const canPublishJira = !!jiraLink && (jiraPerms.data?.createIssues ?? false);
  const canPublish = canPublishForge || canPublishJira;
  const {
    comment,
    setComment,
    labelInput,
    setLabelInput,
    deletingCommentId,
    setDeletingCommentId,
    composerRef,
    quoteReply,
    addComment,
    editComment,
    deleteComment,
    setCommentHidden,
    addLabel,
    removeLabel,
  } = useLocalConversation(id, issue, async (mutate) => {
    if (issue) await update.mutateAsync({ id: issue.id, mutate });
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  // Close/Reopen's click-time hold, before the cache notification that feeds
  // `updateHold` lands: the write appends the typed note, so a second press in
  // that window would post it twice. `updateHold` carries the hold across an
  // issue switch; the object token compare-and-clears, so a settle never
  // releases another press's slot.
  const [statusSavingFor, setStatusSavingFor] = useState<{
    repo: string;
    id: string;
  } | null>(null);
  const portalContainer = usePanelPortalContainer();
  const edit = useEditTitleBody({
    onSave: async ({ title, body }) => {
      if (!issue) return;
      await update.mutateAsync({
        id: issue.id,
        mutate: (cur) => ({ ...cur, title, body }),
      });
    },
  });
  // A different issue must never inherit this one's half-typed label or open
  // confirm/promote/edit dialogs — a render-time state adjustment, not an effect.
  const [lastId, setLastId] = useState(id);
  if (id !== lastId) {
    setLastId(id);
    setLabelInput("");
    setDeletingCommentId(null);
    setConfirmDelete(false);
    setPromoteOpen(false);
    edit.setOpen(false);
  }

  const threadActive =
    selectedIssue?.kind === "local" && selectedIssue.id === id && !!issue;
  const jumpRef = useThreadJumpHotkeys(threadActive);
  // The palette's route to the comment box. Only the view that owns the
  // selection answers — the mounted one lags it through a switch.
  useHotkeyAction(
    "focus-comment",
    () => composerRef.current?.focus(),
    threadActive,
  );

  if (!issue) {
    return <DiffPlaceholder message={t("local.issueGone")} />;
  }

  const isOpen = issue.status === "open";
  const updateHold = pendingWriteMatching(
    localWrites,
    "update",
    (v: { id: string }) => v.id === issue.id,
  );
  const deleteHold = pendingWriteMatching(
    localWrites,
    "delete",
    (v: string) => v === issue.id,
  );
  const savingStatus =
    statusSavingFor?.repo === repoPath && statusSavingFor.id === issue.id;
  const statusHeld = updateHold !== undefined || savingStatus;
  // A typed note rides Close/Reopen rather than being discarded by them.
  const draftRidesStateChange = !!comment.trim();

  function openEdit() {
    if (!issue) return;
    edit.openEdit({ title: issue.title, body: issue.body });
  }

  /** Close/Reopen, carrying any typed note. The note is appended in the SAME
   *  record mutation as the status flip, so the store can never persist one
   *  without the other; the draft clears only once that write lands. */
  async function setStatus(next: "open" | "closed") {
    // Appending the note makes this non-idempotent, and the mutate callback
    // re-reads the record from disk — so a second click lands after the first
    // note is already stored and would post it twice.
    if (!issue || statusHeld) return;
    const note = comment.trim();
    const mine = { repo: repoPath, id: issue.id };
    setStatusSavingFor(mine);
    try {
      await update.mutateAsync({
        id: issue.id,
        mutate: (cur) => ({
          ...cur,
          comments: note
            ? [
                ...cur.comments,
                {
                  id: crypto.randomUUID(),
                  body: note,
                  createdAt: new Date().toISOString(),
                },
              ]
            : cur.comments,
          status: next,
          closedAt: next === "closed" ? new Date().toISOString() : undefined,
        }),
      });
    } catch (e) {
      // Nothing was written, the note included — say so rather than leave a
      // silent no-op behind a button that promised to post it.
      toastError(e);
      return;
    } finally {
      setStatusSavingFor((cur) => (cur === mine ? null : cur));
    }
    setComment("");
  }

  /** Whether the live UI still shows this issue in THIS repo. A write can settle
   *  after the user has moved on, and its follow-up (closing the confirm,
   *  deselecting) must not land on whatever they moved to. */
  function stillShowing(issueId: string) {
    const { selectedIssue: sel, repoPath: liveRepo } = useUiStore.getState();
    return liveRepo === repoPath && sel?.kind === "local" && sel.id === issueId;
  }

  async function deleteIssue(issueId: string) {
    try {
      await del.mutateAsync(issueId);
    } catch (e) {
      toastError(e);
      return;
    }
    if (!stillShowing(issueId)) return;
    setConfirmDelete(false);
    selectIssue(null);
  }

  async function setArchived(issueId: string, archived: boolean) {
    try {
      await update.mutateAsync({
        id: issueId,
        mutate: (cur) => ({ ...cur, archived }),
      });
    } catch (e) {
      // The issue stays selected: nothing was archived.
      toastError(e);
      return;
    }
    if (archived && stillShowing(issueId)) selectIssue(null);
  }

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-2 border-b px-4 py-3">
        {/* `flex-auto`, not `flex-1`: a basis-0 title never triggers the wrap, so
            the actions would stay put and the title collapse instead. Growing also
            replaces the spacer that used to right-align them. */}
        <div className="flex flex-wrap items-start gap-2">
          <h2 className="min-w-0 flex-auto text-sm font-medium break-words">
            {issue.title}
          </h2>
          <PlanIssueButton title={issue.title} body={issue.body} />
          {isOpen && (
            <SolveIssueButton
              repoPath={repoPath}
              title={issue.title}
              body={issue.body}
            />
          )}
          {isOpen && (
            <Button
              variant="outline"
              size="xs"
              onClick={openEdit}
              title={t("local.editTitleDescription")}
            >
              <PencilSimpleIcon data-icon="inline-start" />
              {t("shared.edit")}
            </Button>
          )}
          <Badge
            variant={isOpen ? "default" : "secondary"}
            className="capitalize"
          >
            {t(`local.status.${issue.status}`)}
          </Badge>
          {issue.archived && (
            <Badge variant="secondary">{t("local.archived")}</Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            {t("panel.localLabel")} · {t("local.opened")} <RelativeTime date={issue.createdAt} />
          </span>
        </div>
        {(issue.labels.length > 0 || isOpen) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Trigger first, so it never shifts as chips come and go. */}
            {isOpen && (
              <Popover.Root>
                <Popover.Trigger
                  render={
                    <Button
                      variant="ghost"
                      size="xs"
                      aria-label={t("local.addLabel")}
                    />
                  }
                >
                  <TagIcon data-icon="inline-start" />
                  {t("local.labels")}
                </Popover.Trigger>
                <Popover.Portal container={portalContainer}>
                  <Popover.Positioner
                    align="start"
                    sideOffset={4}
                    className="isolate z-50"
                  >
                    <Popover.Popup className="w-60 rounded-none bg-popover p-2 text-popover-foreground shadow-md ring-1 ring-foreground/10">
                      <p className="px-1 pb-1.5 text-xs font-medium">
                        {t("local.addLabel")}
                      </p>
                      <div className="flex gap-2 px-1">
                        <Input
                          value={labelInput}
                          onChange={(e) => setLabelInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addLabel();
                            }
                          }}
                          placeholder={t("local.labelPlaceholder")}
                          className="h-7 flex-1"
                          autoComplete="off"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!labelInput.trim()}
                          onClick={addLabel}
                        >
                          {t("shared.add")}
                        </Button>
                      </div>
                    </Popover.Popup>
                  </Popover.Positioner>
                </Popover.Portal>
              </Popover.Root>
            )}
            {issue.labels.map((label) => (
              <span
                key={label}
                className="flex items-center gap-1 border px-1.5 py-0.5 text-[11px]"
              >
                {label}
                {isOpen && (
                  <button
                    type="button"
                    aria-label={t("local.removeLabel", { label })}
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => removeLabel(label)}
                  >
                    <XIcon className="size-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </header>

      <ConversationScrollArea ref={jumpRef} className="flex-1">
        <div className="space-y-4 p-4">
          <div className="group flex items-start justify-between gap-2 border-b pb-3">
            <div className="min-w-0 flex-1">
              {issue.body.trim() ? (
                <Markdown refs={mentions.refs}>{issue.body}</Markdown>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("shared.noDescription")}
                </p>
              )}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("shared.descriptionActions")}
                    className="shrink-0 text-muted-foreground hover:text-foreground data-popup-open:text-foreground"
                  />
                }
              >
                <DotsThreeIcon className="size-4" weight="bold" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuItem onClick={() => quoteReply(issue.body)}>
                  {t("shared.quoteReply")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => copyText(issue.body, t("shared.markdownCopied"))}
                >
                  {t("shared.copyMarkdown")}
                </DropdownMenuItem>
                {isOpen && (
                  <DropdownMenuItem onClick={openEdit}>
                    {t("shared.edit")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {issue.comments.map((c) => (
            <LocalComment
              key={c.id}
              comment={c}
              onQuote={() => quoteReply(c.body)}
              onSaveEdit={(body) => editComment(c.id, body)}
              onDelete={() => setDeletingCommentId(c.id)}
              onHide={() => setCommentHidden(c.id, true)}
              onUnhide={() => setCommentHidden(c.id, false)}
              mentions={mentions}
            />
          ))}
          {issue.comments.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t("shared.noComments")}
            </p>
          )}
        </div>
      </ConversationScrollArea>

      <CommentComposer
        ref={composerRef}
        ariaLabel={t("local.leaveNote")}
        placeholder={t("local.leaveNotePlaceholder")}
        value={comment}
        onChange={setComment}
        onSubmit={addComment}
        onClear={() => setComment("")}
        submitLabel={t("shared.comment")}
        mentions={mentions}
      />

      <div className="flex flex-wrap items-center gap-2 border-t p-3">
        <Button
          variant="outline"
          size="sm"
          className="text-destructive"
          onClick={() => setConfirmDelete(true)}
        >
          <TrashIcon data-icon="inline-start" />
          {t("shared.delete")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void setArchived(issue.id, !issue.archived)}
        >
          <ArchiveIcon data-icon="inline-start" />
          {issue.archived ? t("local.unarchive") : t("local.archive")}
        </Button>
        <span className="flex-1" />
        {isOpen && (
          <>
            {canPublish && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPromoteOpen(true)}
                title={
                  canPublishForge && canPublishJira
                    ? t("local.publishToForgeOrJiraTitle")
                    : canPublishJira
                      ? t("local.openIssueInJiraTitle")
                      : t("local.openIssueOnProviderTitle", {
                          provider:
                            ghStatus.data?.provider === "gitlab"
                              ? "GitLab"
                              : "GitHub",
                        })
                }
              >
                {canPublishForge && canPublishJira ? (
                  <UploadSimpleIcon data-icon="inline-start" />
                ) : canPublishJira ? (
                  <KanbanIcon data-icon="inline-start" />
                ) : ghStatus.data?.provider === "gitlab" ? (
                  <GitlabLogoIcon data-icon="inline-start" />
                ) : (
                  <GithubLogoIcon data-icon="inline-start" />
                )}
                {canPublishForge && canPublishJira
                  ? t("local.publish")
                  : canPublishJira
                    ? t("local.publishToJira")
                    : t("local.publishToProvider", {
                        provider:
                          ghStatus.data?.provider === "gitlab"
                            ? "GitLab"
                            : "GitHub",
                      })}
              </Button>
            )}
            {/* The label swaps while a note rides along: the action changed
                meaning, and only the label reaches a viewer before the click. */}
            <DisabledReasonButton
              variant="outline"
              size="sm"
              disabled={statusHeld}
              reason={statusHeld ? t("shared.saving") : undefined}
              onClick={() => void setStatus("closed")}
              title={
                draftRidesStateChange
                  ? t("local.closeDraftTitle")
                  : undefined
              }
            >
              {draftRidesStateChange
                ? t("local.closeWithComment")
                : t("shared.close")}
            </DisabledReasonButton>
          </>
        )}
        {!isOpen && (
          <DisabledReasonButton
            variant="outline"
            size="sm"
            disabled={statusHeld}
            reason={statusHeld ? t("shared.saving") : undefined}
            onClick={() => void setStatus("open")}
            title={
              draftRidesStateChange
                ? t("local.reopenDraftTitle")
                : undefined
            }
          >
            <ArrowCounterClockwiseIcon data-icon="inline-start" />
            {draftRidesStateChange
              ? t("local.reopenWithComment")
              : t("shared.reopen")}
          </DisabledReasonButton>
        )}
      </div>

      <PromoteLocalIssueDialog
        repoPath={repoPath}
        issue={issue}
        open={promoteOpen}
        onOpenChange={setPromoteOpen}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("local.deleteIssueTitle")}</DialogTitle>
            <DialogDescription>
              {issue.comments.length === 0
                ? t("local.deleteIssueNoComments", { title: issue.title })
                : issue.comments.length === 1
                  ? t("local.deleteIssueOneComment", {
                      title: issue.title,
                    })
                  : t("local.deleteIssueManyComments", {
                      title: issue.title,
                      count: issue.comments.length,
                    })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              {t("shared.cancel")}
            </Button>
            <DisabledReasonButton
              variant="destructive"
              disabled={deleteHold !== undefined}
              reason={deleteHold ? t("shared.saving") : undefined}
              onClick={() => void deleteIssue(issue.id)}
            >
              {deleteHold && <Spinner data-icon="inline-start" />}
              {t("shared.delete")}
            </DisabledReasonButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EditTitleBodyDialog
        form={edit.form}
        open={edit.open}
        onOpenChange={edit.setOpen}
        title={t("local.editIssueTitle")}
        description={t("local.editIssueDescription")}
        contentClassName={undefined}
        bodyTextareaClassName="max-h-72"
        mentions={mentions}
      />

      <DeleteCommentDialog
        commentId={deletingCommentId}
        onClose={() => setDeletingCommentId(null)}
        description={t("local.deleteCommentDescription")}
        onConfirm={(commentId) => {
          deleteComment(commentId);
          setDeletingCommentId(null);
        }}
      />
    </div>
  );
}
