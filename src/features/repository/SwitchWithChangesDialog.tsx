import { WarningIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { DisabledReasonButton } from "@/components/disabled-reason-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRetained } from "@/lib/use-retained";

/**
 * Prompt shown when switching branches with uncommitted changes: bring the
 * changes along, or stash them so the current branch stays put. Open when
 * `target` is the pending switch (null = closed). Presentational — the switcher
 * owns the checkout/stash mutations and hands down the actions.
 */
export function SwitchWithChangesDialog({
  target,
  currentLabel,
  hint,
  reapply,
  onReapplyChange,
  onCancel,
  onBringChanges,
  onStashAndSwitch,
}: {
  target: { name: string; remote: string | null } | null;
  currentLabel: string;
  /**
   * One-line note above the choices. Set only when a bring-changes attempt was
   * refused — the switcher clears it on every fresh open — so its presence is
   * also what puts the footer in its refusal state below, and what the reapply
   * clause is appended to.
   */
  hint?: string | null;
  reapply: boolean;
  onReapplyChange: (reapply: boolean) => void;
  onCancel: () => void;
  onBringChanges: () => void;
  onStashAndSwitch: () => void;
}) {
  const { t } = useTranslation("repositoryOperations");
  const shownTarget = useRetained(target);
  // Bringing the changes has already been refused, so it can only fail again:
  // stashing takes the primary and the dead offer stays visible but inert,
  // rather than reading as the recommended action beside a hint saying it lost.
  const refused = Boolean(hint);
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("dialogs.switch.title")}</DialogTitle>
          <DialogDescription>
            {t("dialogs.switch.description", {
              target: shownTarget?.name,
              current: currentLabel,
            })}{" "}
            {reapply ? (
              <>
                {t("dialogs.switch.reapplyDescription", {
                  target: shownTarget?.name,
                })}
              </>
            ) : (
              t("dialogs.switch.popDescription")
            )}
          </DialogDescription>
        </DialogHeader>
        {hint && (
          <p
            role="status"
            className="flex items-start gap-1.5 text-xs text-warning"
          >
            <WarningIcon className="size-4 shrink-0" />
            {/* The reapply clause is appended here rather than baked into the
                hint: the checkbox stays live while this note shows. */}
            <span>
              {hint}
              {refused && reapply
                ? ` ${t("dialogs.switch.reapplyHint")}`
                : null}
            </span>
          </p>
        )}
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox
            checked={reapply}
            onCheckedChange={(v) => onReapplyChange(v === true)}
          />
          {t("dialogs.switch.reapply")}
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("dialogs.common.cancel")}
          </Button>
          <Button
            variant={refused ? "default" : "outline"}
            onClick={onStashAndSwitch}
          >
            {t("dialogs.switch.stashAndSwitch")}
          </Button>
          <DisabledReasonButton
            // Below `sm` the footer stacks and stretches the wrapper span; the
            // Button fills it to match the plain siblings beside it.
            className="w-full"
            disabled={refused}
            reason={refused ? t("dialogs.switch.overwriteReason") : null}
            variant={refused ? "outline" : "default"}
            onClick={onBringChanges}
          >
            {t("dialogs.switch.bringChanges")}
          </DisabledReasonButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
