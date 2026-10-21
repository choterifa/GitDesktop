import {
  CheckCircleIcon,
  CircleDashedIcon,
  CircleIcon,
  CircleNotchIcon,
  MinusCircleIcon,
  ProhibitIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { ForgeProvider } from "@/lib/git/types";
import { isRunActive } from "@/lib/github/actions";
import { i18n } from "@/lib/i18n";
import { parseableDate } from "@/lib/time";
import { cn } from "@/lib/utils";

/** Whether a completed conclusion counts as a failure (drives "Re-run failed"). */
export function isFailureConclusion(conclusion: string): boolean {
  return (
    conclusion === "failure" ||
    conclusion === "timed_out" ||
    conclusion === "startup_failure"
  );
}

/** Whether the provider calls its CI unit a pipeline rather than a workflow
 *  run. An unrecognized host routes through `gh`, so it reads as GitHub. */
export function isPipelineProvider(
  provider: ForgeProvider | null | undefined,
): boolean {
  return provider === "gitlab" || provider === "bitbucket";
}

/** What this provider calls one CI unit. Every run-facing label and toast is
 *  built from this, so one surface can never say "run" beside another's
 *  "pipeline". */
export type CiRunNoun = "run" | "pipeline";
export function ciRunNoun(
  provider: ForgeProvider | null | undefined,
): CiRunNoun {
  return isPipelineProvider(provider) ? "pipeline" : "run";
}

export function ciRunNounLabel(
  provider: ForgeProvider | null | undefined,
): string {
  return i18n.t(`nouns.${ciRunNoun(provider)}`, { ns: "actions" });
}

/** One re-run the provider offers for a run: the label users read, plus the
 *  kind the caller dispatches. */
export type RerunOffer = {
  kind: "all" | "failed" | "retry" | "bb-rerun";
  label: string;
};

/** What each re-run offer is called. Both offer builders below read these, so
 *  the run views and the PR checks rollup can't spell one operation two ways. */
const RERUN_LABEL_KEYS: Record<RerunOffer["kind"], string> = {
  all: "rerun.allJobs",
  failed: "rerun.failedJobs",
  retry: "rerun.retryPipeline",
  "bb-rerun": "rerun.triggerPipeline",
};

function rerunLabel(kind: RerunOffer["kind"]): string {
  return i18n.t(RERUN_LABEL_KEYS[kind], { ns: "actions" });
}

/**
 * The re-run offers for a run, in render order. Shared by the run detail view
 * and the runs-list context menu so the two can't drift on which offers a
 * provider makes or what they're called. An in-flight run offers none of them:
 * Cancel is its only action.
 */
export function rerunOffers(
  provider: ForgeProvider | null | undefined,
  status: string,
  conclusion: string,
): RerunOffer[] {
  // GitLab's retry restarts a pipeline's failed AND canceled jobs, so it covers
  // both conclusions and has no "all jobs" analogue.
  if (provider === "gitlab") {
    return isFailureConclusion(conclusion) || conclusion === "cancelled"
      ? [{ kind: "retry", label: rerunLabel("retry") }]
      : [];
  }
  // Bitbucket has no rerun endpoint — its "rerun" re-triggers the branch
  // pipeline, which makes sense on any finished run (success included).
  if (provider === "bitbucket") {
    return !isRunActive(status) && conclusion !== ""
      ? [{ kind: "bb-rerun", label: rerunLabel("bb-rerun") }]
      : [];
  }
  if (isRunActive(status)) return [];
  const offers: RerunOffer[] = [{ kind: "all", label: rerunLabel("all") }];
  if (isFailureConclusion(conclusion)) {
    offers.push({ kind: "failed", label: rerunLabel("failed") });
  }
  return offers;
}

/** GitHub re-runs a workflow run for 30 days after its creation (GitHub Actions
 *  docs), measured from the run's creation, not its latest attempt. */
const GITHUB_RERUN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Why a run's re-runs are held for age, or undefined while the forge still takes
 * them. `anchor` is the run's creation time, or any time the run is known to
 * predate (a check's start); an absent or unparseable anchor never holds. Only
 * a settled GitHub provider holds: the pipeline forges' windows are unverified,
 * and a pending probe may still resolve to one of them. `now` is the shared
 * ticker's.
 */
export function rerunWindowReason(
  provider: ForgeProvider | null | undefined,
  anchor: string | undefined,
  now: number,
): string | undefined {
  if (provider !== "github" || !anchor || !parseableDate(anchor))
    return undefined;
  return now - new Date(anchor).getTime() > GITHUB_RERUN_WINDOW_MS
    ? i18n.t("reasons.rerunExpired", { ns: "actions" })
    : undefined;
}

/** The single re-run the PR checks rollup offers when failed or cancelled runs
 *  exist: on GitHub failed-only, or all jobs when `failedOnly` is false (a
 *  cancelled run with no failed job); pipeline retry on GitLab; nothing on
 *  Bitbucket (its rerun re-triggers the branch pipeline — wrong from a PR row).
 *  Reads the same labels rerunOffers renders so the surfaces can't drift. */
export function checksRerunOffer(
  provider: ForgeProvider | null | undefined,
  failedOnly: boolean,
): RerunOffer | null {
  if (provider === "gitlab")
    return { kind: "retry", label: rerunLabel("retry") };
  if (provider === "github")
    return failedOnly
      ? { kind: "failed", label: rerunLabel("failed") }
      : { kind: "all", label: rerunLabel("all") };
  return null;
}

/** Every word a per-job re-run needs: the full label, the compact one for a
 *  narrow row, the hover copy that says what the provider actually restarts, and
 *  the started toast. */
export type JobRerunOffer = {
  label: string;
  compactLabel: string;
  title: string;
  toast: string;
};

/**
 * The per-job re-run a provider offers, or null where there is none (Bitbucket
 * steps have no retry endpoint). Shared by the PR checks rollup and the run
 * detail job rows so the two can't drift on the wording.
 *
 * Deliberately a flat bundle rather than the run-level `kind` + `rerunTitle` +
 * `rerunSuccessMessage` split: a job re-run has no `kind` axis to key those
 * records off, so one object keeps all the per-job wording in one place.
 */
export function jobRerunOffer(
  provider: ForgeProvider | null | undefined,
): JobRerunOffer | null {
  if (provider === "github") {
    return {
      label: i18n.t("rerun.job", { ns: "actions" }),
      compactLabel: i18n.t("rerun.again", { ns: "actions" }),
      title: i18n.t("rerun.jobDependencies", { ns: "actions" }),
      toast: i18n.t("rerun.startingJob", { ns: "actions" }),
    };
  }
  if (provider === "gitlab") {
    return {
      label: i18n.t("rerun.retryJob", { ns: "actions" }),
      compactLabel: i18n.t("rerun.retry", { ns: "actions" }),
      title: i18n.t("rerun.retryThisJob", { ns: "actions" }),
      toast: i18n.t("rerun.retryingJob", { ns: "actions" }),
    };
  }
  return null;
}

/** Localized hover copy for run-level re-run offers. */
export function rerunTitle(kind: RerunOffer["kind"]): string | undefined {
  if (kind === "retry")
    return i18n.t("rerun.retryPipelineTitle", { ns: "actions" });
  if (kind === "bb-rerun")
    return i18n.t("rerun.triggerPipelineTitle", { ns: "actions" });
  return undefined;
}

/** The toast a started re-run shows, in the words of the provider's own
 *  operation. */
export function rerunSuccessMessage(
  provider: ForgeProvider | null | undefined,
  failedOnly: boolean,
): string {
  switch (true) {
    case provider === "gitlab":
      return i18n.t("toasts.retryingPipeline", { ns: "actions" });
    case provider === "bitbucket":
      return i18n.t("toasts.triggeringPipeline", { ns: "actions" });
    case failedOnly:
      return i18n.t("toasts.rerunningFailedJobs", { ns: "actions" });
    default:
      return i18n.t("toasts.rerunningAllJobs", { ns: "actions" });
  }
}

/** Whether Cancel applies to a run. A manual/blocked GitLab pipeline reports
 *  completed + action_required, but GitLab's cancel endpoint does cancel it. */
export function cancelOffered(
  provider: ForgeProvider | null | undefined,
  status: string,
  conclusion: string,
): boolean {
  return (
    isRunActive(status) ||
    (provider === "gitlab" && conclusion === "action_required")
  );
}

/** What Cancel is called, in the provider's own noun. */
export function cancelLabel(
  provider: ForgeProvider | null | undefined,
): string {
  return i18n.t(
    isPipelineProvider(provider)
      ? "controls.cancelPipeline"
      : "controls.cancelRun",
    { ns: "actions" },
  );
}

/** The toast an accepted cancel shows — same noun as the control the user
 *  clicked. */
export function cancelStartedMessage(
  provider: ForgeProvider | null | undefined,
): string {
  return i18n.t(
    isPipelineProvider(provider)
      ? "toasts.cancellingPipeline"
      : "toasts.cancellingRun",
    { ns: "actions" },
  );
}

/** Human label for a run/job/step's combined status + conclusion. */
export function statusLabel(status: string, conclusion: string): string {
  if (status !== "completed") {
    if (status === "in_progress")
      return i18n.t("status.inProgress", { ns: "actions" });
    if (status === "waiting")
      return i18n.t("status.waiting", { ns: "actions" });
    return i18n.t("status.queued", { ns: "actions" });
  }
  switch (conclusion) {
    case "success":
      return i18n.t("status.succeeded", { ns: "actions" });
    case "failure":
      return i18n.t("status.failed", { ns: "actions" });
    case "timed_out":
      return i18n.t("status.timedOut", { ns: "actions" });
    case "startup_failure":
      return i18n.t("status.startupFailure", { ns: "actions" });
    case "cancelled":
      return i18n.t("status.cancelled", { ns: "actions" });
    case "skipped":
      return i18n.t("status.skipped", { ns: "actions" });
    case "action_required":
      return i18n.t("status.actionRequired", { ns: "actions" });
    case "neutral":
      return i18n.t("status.neutral", { ns: "actions" });
    case "stale":
      return i18n.t("status.stale", { ns: "actions" });
    default:
      return conclusion || i18n.t("status.completed", { ns: "actions" });
  }
}

/**
 * Status glyph for a run, job, or step. Active items spin; completed ones show
 * a coloured pass/fail/neutral mark. `weight="bold"` keeps the dashed/notch
 * outlines legible.
 */
export function StatusIcon({
  status,
  conclusion,
  className,
}: {
  status: string;
  conclusion: string;
  className?: string;
}) {
  const base = cn("size-4 shrink-0", className);

  if (status !== "completed") {
    if (status === "in_progress") {
      return (
        <CircleNotchIcon
          weight="bold"
          className={cn(base, "animate-spin text-warning")}
        />
      );
    }
    return (
      <CircleDashedIcon
        weight="bold"
        className={cn(base, "text-muted-foreground")}
      />
    );
  }

  switch (conclusion) {
    case "success":
      return (
        <CheckCircleIcon weight="fill" className={cn(base, "text-success")} />
      );
    case "failure":
    case "timed_out":
    case "startup_failure":
      return (
        <XCircleIcon weight="fill" className={cn(base, "text-destructive")} />
      );
    case "action_required":
      return <WarningIcon weight="fill" className={cn(base, "text-warning")} />;
    case "cancelled":
      return (
        <ProhibitIcon
          weight="bold"
          className={cn(base, "text-muted-foreground")}
        />
      );
    case "skipped":
      return (
        <MinusCircleIcon
          weight="bold"
          className={cn(base, "text-muted-foreground")}
        />
      );
    default:
      return (
        <CircleIcon
          weight="bold"
          className={cn(base, "text-muted-foreground")}
        />
      );
  }
}

export { isRunActive };
