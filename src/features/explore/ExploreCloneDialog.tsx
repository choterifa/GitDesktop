import { useSelector } from "@tanstack/react-store";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffectEvent } from "react";
import { useTranslation } from "react-i18next";
import { PathText } from "@/components/path-text";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOpenRecordedRepo } from "@/features/repository/useOpenRepoByPath";
import { parentDir } from "@/features/welcome/clone-utils";
import { useAppForm } from "@/lib/form";
import { forgeClone, validateRepo } from "@/lib/git/api";
import type { ForgeProvider } from "@/lib/git/types";
import { useSettings } from "@/lib/settings/queries";
import { toastError } from "@/lib/toast";
import {
  ARIA_DISABLED_CLASS,
  useDisabledReason,
} from "@/lib/use-disabled-reason";
import { useSeedOnOpen } from "@/lib/use-seed-on-open";
import { cn } from "@/lib/utils";

/** The repo an Explore clone is pinned to. */
export interface ExploreCloneTarget {
  provider: ForgeProvider;
  cloneUrl: string;
  name: string;
}

const DEFAULTS = { destination: "", recurseSubmodules: false };

/**
 * A clone dialog pinned to a repo chosen in Explore — same submit path as the
 * Welcome CloneRepoDialog (forgeClone → validateRepo → record recent → openRepo)
 * but with the URL fixed to the selected repo, so it only asks for the local path.
 */
export function ExploreCloneDialog({
  target,
  onOpenChange,
}: {
  target: ExploreCloneTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("explore");
  const openRecorded = useOpenRecordedRepo();
  const settings = useSettings();

  const form = useAppForm({
    defaultValues: DEFAULTS,
    onSubmit: async ({ value }) => {
      const dest = value.destination.trim();
      if (!target || !dest) return;
      try {
        const clonedPath = await forgeClone(
          target.provider,
          target.cloneUrl,
          dest,
          target.name,
          value.recurseSubmodules,
        );
        const info = await validateRepo(clonedPath);
        // Closes even when a newer navigation superseded the switch: the clone
        // landed either way.
        await openRecorded(info);
        onOpenChange(false);
      } catch (e) {
        toastError(e);
      }
    },
  });

  // Default the destination near the user's other repos each time it opens.
  const defaultPath = useEffectEvent(() => {
    const recent = settings.data?.recentRepos?.[0]?.path;
    return recent ? parentDir(recent) : "";
  });
  const seedOnOpen = useEffectEvent(() => {
    form.reset(
      { destination: defaultPath(), recurseSubmodules: false },
      { keepDefaultValues: true },
    );
  });
  const open = target !== null;
  useSeedOnOpen(open, seedOnOpen);

  const values = useSelector(form.store, (s) => s.values);
  const isSubmitting = useSelector(form.store, (s) => s.isSubmitting);

  async function pickDestination() {
    const path = await openDialog({
      directory: true,
      title: t("clone.localPath"),
    });
    if (path) form.setFieldValue("destination", path);
  }

  const canClone = values.destination.trim().length > 0;
  const { blockedReason, reasonId, wrapperTitle, describedBy } =
    useDisabledReason({
      disabled: !canClone,
      reason: t("clone.choosePathReason"),
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t("clone.title", { name: target?.name })}
            </DialogTitle>
            <DialogDescription>
              {t("clone.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <form.AppField name="destination">
                  {(field) => (
                    <field.TextField
                      label={t("clone.localPath")}
                      placeholder={t("clone.pathPlaceholder")}
                    />
                  )}
                </form.AppField>
              </div>
              <Button type="button" variant="outline" onClick={pickDestination}>
                {t("clone.choose")}
              </Button>
            </div>
            {values.destination.trim() && target && (
              // gap-1, not a trailing label space — flex line boxes trim those.
              <p className="flex min-w-0 gap-1 text-[11px] text-muted-foreground">
                <span className="shrink-0">{t("clone.destinationLabel")}</span>
                <PathText
                  path={`${values.destination.trim().replace(/[\\/]$/, "")}${
                    values.destination.includes("/") ? "/" : "\\"
                  }${target.name}`}
                  className="font-mono"
                />
              </p>
            )}
          </div>

          <div className="space-y-1">
            <form.AppField name="recurseSubmodules">
              {(field) => (
                <field.CheckboxField
                  label={t("clone.submodules")}
                  className="flex cursor-pointer items-center gap-2 text-xs"
                />
              )}
            </form.AppField>
            <p className="text-[11px] text-muted-foreground">
              {t("clone.submodulesDescription")}
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t("cancel")}
            </Button>
            <form.AppForm>
              <span
                className={cn(
                  "inline-flex",
                  blockedReason && "cursor-not-allowed",
                )}
                title={wrapperTitle}
              >
                <form.SubmitButton
                  focusableWhenDisabled={!!blockedReason}
                  disabled={!canClone}
                  aria-describedby={describedBy}
                  className={ARIA_DISABLED_CLASS}
                >
                  {t("clone.submit")}
                </form.SubmitButton>
                {blockedReason ? (
                  <span id={reasonId} className="sr-only">
                    {blockedReason}
                  </span>
                ) : null}
              </span>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
