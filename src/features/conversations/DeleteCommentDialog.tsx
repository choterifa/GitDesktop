import type { ReactNode } from "react";
import { DisabledReasonButton } from "@/components/disabled-reason-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCommonText } from "@/lib/i18n/use-common-text";

/**
 * "Delete comment?" confirmation, shared by every PR/issue/discussion view.
 * Open while `commentId` is non-null. The dialog does NOT close itself on
 * confirm — `onConfirm(id)` runs the caller's delete and the caller closes
 * (synchronously for local comments; for remote ones in BOTH arms of the
 * awaited continuation — close-on-error is deliberate). `pending` disables
 * Delete during a remote mutation, explained by `reason` (the caller's
 * `pendingWriteReason`, so a delete queued offline says it is waiting); local
 * callers omit both.
 */
export function DeleteCommentDialog({
  commentId,
  onClose,
  onConfirm,
  title,
  description,
  pending,
  reason,
}: {
  commentId: string | null;
  onClose: () => void;
  onConfirm: (id: string) => void;
  title?: ReactNode;
  description?: ReactNode;
  pending?: boolean;
  reason?: string;
}) {
  const tx = useCommonText();
  const resolvedTitle =
    typeof title === "string"
      ? tx(title)
      : (title ?? tx("Delete comment?"));
  const remoteDescription =
    typeof description === "string"
      ? /^This permanently deletes the comment on (.+)\. This cannot be undone\.$/.exec(
          description,
        )
      : null;
  const resolvedDescription =
    typeof description === "string"
      ? remoteDescription
        ? tx(
            "This permanently deletes the comment on {{remoteLabel}}. This cannot be undone.",
            { remoteLabel: remoteDescription[1] },
          )
        : tx(description)
      : (description ??
        tx("This permanently deletes the comment on GitHub. This cannot be undone."));
  return (
    <Dialog
      open={commentId !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{resolvedTitle}</DialogTitle>
          <DialogDescription>{resolvedDescription}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tx("Cancel")}
          </Button>
          <DisabledReasonButton
            variant="destructive"
            disabled={pending}
            reason={reason}
            onClick={() => {
              if (commentId) onConfirm(commentId);
            }}
          >
            {tx("Delete")}
          </DisabledReasonButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
