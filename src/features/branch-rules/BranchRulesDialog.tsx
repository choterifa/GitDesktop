import { GithubLogoIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { DIALOG_SCROLL } from "@/components/dialog-scroll";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { githubProtectionsToRules } from "@/lib/branch-rules/github";
import { matchesGlob } from "@/lib/branch-rules/match";
import {
  useBranchRules,
  useSaveBranchRules,
  useSaveSharedBranchRules,
  useSharedBranchRules,
} from "@/lib/branch-rules/queries";
import {
  ALL_MERGE_METHODS,
  type BranchRulesConfig,
  EMPTY_BRANCH_RULES,
  type MergeMethod,
} from "@/lib/branch-rules/types";
import { ghBranchProtections } from "@/lib/git/api";
import { forgeFeatureReady, useForgeStatus } from "@/lib/git/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";

export function BranchRulesDialog({
  repoPath,
  open,
  onOpenChange,
}: {
  repoPath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("branchRules");
  // Which set of rules we're editing: the user's personal (app-data) rules or
  // the repo's shared, committed `.gitdesktop/branch-rules.json`. Both are
  // always enforced (merged) — this only chooses what this dialog edits.
  const [scope, setScope] = useState<"personal" | "shared">("personal");
  const personal = useBranchRules(repoPath);
  const shared = useSharedBranchRules(repoPath);
  const savePersonal = useSaveBranchRules(repoPath);
  const saveShared = useSaveSharedBranchRules(repoPath);
  const gh = useForgeStatus(repoPath);
  // Importing branch protections is a GitHub-only operation for now — the
  // repoActions flag is on for GitLab too (view/star), so the provider check is
  // load-bearing here.
  const ghReady =
    forgeFeatureReady(gh.data, "repoActions") && gh.data?.provider === "github";
  const [importing, setImporting] = useState(false);
  const [draft, setDraft] = useState<BranchRulesConfig>(EMPTY_BRANCH_RULES);
  const [testName, setTestName] = useState("");
  const patternInputId = useId();
  const hintInputId = useId();
  const testNameInputId = useId();
  // Keyed by row position, like the list itself — Add and Remove hand focus to a
  // neighbour rather than dropping it to the body.
  const promotionRefs = useRef<(HTMLInputElement | null)[]>([]);
  const addPromotionRef = useRef<HTMLButtonElement>(null);

  const active = scope === "shared" ? shared : personal;
  const saving = scope === "shared" ? saveShared : savePersonal;

  // Seed the editable draft from the active scope when the dialog opens or the
  // scope changes (switching scopes discards any unsaved edits in the other).
  const seededScope = useRef<string | null>(null);
  // Open-session token, reminted on every reseed: the dialog stays mounted and
  // Cancel is live mid-save, so a settle closes only the draft that submitted.
  // Dropped only in `!open`, never by a cleanup: an `<Activity>` hide runs those.
  const session = useRef<object | null>(null);
  useEffect(() => {
    if (!open) {
      seededScope.current = null;
      session.current = null;
      return;
    }
    if (session.current === null) session.current = {};
    if (seededScope.current !== scope && active.data) {
      seededScope.current = scope;
      session.current = {};
      setDraft(active.data);
    }
  }, [open, scope, active.data]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(active.data ?? null);

  function setNaming(patch: Partial<BranchRulesConfig["naming"]>) {
    setDraft((d) => ({ ...d, naming: { ...d.naming, ...patch } }));
  }

  function addProtection() {
    setDraft((d) => ({
      ...d,
      protections: [
        ...d.protections,
        {
          id: crypto.randomUUID(),
          pattern: "",
          blockDeletion: true,
          blockForcePush: true,
          requirePr: false,
          allowedMergeMethods: [...ALL_MERGE_METHODS],
        },
      ],
    }));
  }

  function toggleMergeMethod(id: string, method: MergeMethod, on: boolean) {
    setDraft((d) => ({
      ...d,
      protections: d.protections.map((p) =>
        p.id === id
          ? {
              ...p,
              allowedMergeMethods: on
                ? ALL_MERGE_METHODS.filter(
                    (m) => p.allowedMergeMethods.includes(m) || m === method,
                  )
                : p.allowedMergeMethods.filter((m) => m !== method),
            }
          : p,
      ),
    }));
  }

  function updateProtection(
    id: string,
    patch: Partial<BranchRulesConfig["protections"][number]>,
  ) {
    setDraft((d) => ({
      ...d,
      protections: d.protections.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      ),
    }));
  }

  function removeProtection(id: string) {
    setDraft((d) => ({
      ...d,
      protections: d.protections.filter((p) => p.id !== id),
    }));
  }

  // Promotion branches are bare patterns with no per-entry settings, so they're
  // edited by position rather than by an id the way protections are. Focus follows
  // the edit — deferred to after the re-render, since the row being focused doesn't
  // exist (or has shifted) until then.
  function addPromotionBranch() {
    const next = draft.promotionBranches.length;
    setDraft((d) => ({
      ...d,
      promotionBranches: [...d.promotionBranches, ""],
    }));
    requestAnimationFrame(() => promotionRefs.current[next]?.focus());
  }

  function updatePromotionBranch(index: number, pattern: string) {
    setDraft((d) => ({
      ...d,
      promotionBranches: d.promotionBranches.map((p, i) =>
        i === index ? pattern : p,
      ),
    }));
  }

  function removePromotionBranch(index: number) {
    const emptied = draft.promotionBranches.length === 1;
    setDraft((d) => ({
      ...d,
      promotionBranches: d.promotionBranches.filter((_, i) => i !== index),
    }));
    // The survivors shift down one, so index-1 IS the row above — and index 0 lands
    // on whichever row took its place. With none left, Add is the nearest control
    // that outlives the removal.
    requestAnimationFrame(() => {
      if (emptied) addPromotionRef.current?.focus();
      else promotionRefs.current[Math.max(0, index - 1)]?.focus();
    });
  }

  // Pulls GitHub's branch protection rules into the draft (deduped by pattern),
  // for the user to review and save. Read-only against GitHub.
  async function importFromGitHub() {
    setImporting(true);
    try {
      const mapped = githubProtectionsToRules(
        await ghBranchProtections(repoPath),
      );
      if (mapped.length === 0) {
        toast.info(t("import.none"));
        return;
      }
      setDraft((d) => {
        const byPattern = new Map(d.protections.map((p) => [p.pattern, p]));
        for (const m of mapped) byPattern.set(m.pattern, m);
        return { ...d, protections: [...byPattern.values()] };
      });
      toast.success(t("import.success", { count: mapped.length }));
    } catch (e) {
      toastError(e);
    } finally {
      setImporting(false);
    }
  }

  async function doSave() {
    // Scope and repo are read before the await: the toast names where THIS save
    // went, and a save landing after a repo switch must not close the next
    // repo's dialog (RepositoryView is one instance across switches).
    const savedFor = repoPath;
    const submitted = session.current;
    const savedShared = scope === "shared";
    try {
      await saving.mutateAsync(draft);
    } catch (e) {
      toastError(e);
      return;
    }
    toast.success(
      t(savedShared ? "saved.shared" : "saved.personal"),
    );
    if (
      useUiStore.getState().repoPath === savedFor &&
      submitted !== null &&
      session.current === submitted
    )
      onOpenChange(false);
  }

  const promotionBranches = draft.promotionBranches;
  const namePattern = draft.naming.pattern.trim();
  const testMatches = namePattern !== "" && matchesGlob(namePattern, testName);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        {/* Header and footer stay pinned; the rules (many protections + merge
            toggles) scroll so the dialog can't outgrow the viewport. */}
        <div className={cn(DIALOG_SCROLL, "min-h-0 flex-1 space-y-4")}>
          <div className="space-y-1.5">
            <div className="flex gap-1">
              <Button
                variant={scope === "personal" ? "secondary" : "ghost"}
                size="xs"
                onClick={() => setScope("personal")}
              >
                {t("scope.personal")}
              </Button>
              <Button
                variant={scope === "shared" ? "secondary" : "ghost"}
                size="xs"
                onClick={() => setScope("shared")}
              >
                {t("scope.shared")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {scope === "shared" ? (
                <>
                  {t("scope.sharedSavedLead")}{" "}
                  <span className="font-mono">
                    .gitdesktop/branch-rules.json
                  </span>{" "}
                  {t("scope.sharedSavedTail")}
                </>
              ) : (
                t("scope.personalSaved")
              )}
            </p>
          </div>

          {active.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <div className="space-y-6">
              <section className="space-y-2">
                <h3 className="text-xs font-medium">{t("naming.title")}</h3>
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox
                    checked={draft.naming.enabled}
                    onCheckedChange={(c) => setNaming({ enabled: c === true })}
                  />
                  {t("naming.requirePattern")}
                </label>
                {draft.naming.enabled && (
                  <div className="space-y-2 pl-6">
                    <div className="space-y-1">
                      <Label htmlFor={patternInputId} className="text-xs">
                        {t("naming.pattern")}
                      </Label>
                      <Input
                        id={patternInputId}
                        value={draft.naming.pattern}
                        onChange={(e) => setNaming({ pattern: e.target.value })}
                        placeholder="{feature,fix,chore}/*"
                        className="font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={hintInputId} className="text-xs">
                        {t("naming.hint")}
                      </Label>
                      <Input
                        id={hintInputId}
                        value={draft.naming.hint}
                        onChange={(e) => setNaming({ hint: e.target.value })}
                        placeholder="feature/login, fix/crash"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={testNameInputId} className="text-xs">
                        {t("naming.tryName")}
                      </Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id={testNameInputId}
                          value={testName}
                          onChange={(e) => setTestName(e.target.value)}
                          placeholder="feature/login"
                          className="font-mono"
                        />
                        {testName.trim() !== "" && (
                          <span
                            className={
                              testMatches
                                ? "shrink-0 text-xs text-success"
                                : "shrink-0 text-xs text-destructive"
                            }
                          >
                            {testMatches
                              ? t("naming.matches")
                              : t("naming.rejected")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-medium">{t("protection.title")}</h3>
                  <div className="flex gap-1">
                    {ghReady && (
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={importing}
                        onClick={importFromGitHub}
                        title={t("protection.importTitle")}
                      >
                        <GithubLogoIcon data-icon="inline-start" />
                        {t("protection.import")}
                      </Button>
                    )}
                    <Button variant="outline" size="xs" onClick={addProtection}>
                      <PlusIcon data-icon="inline-start" />
                      {t("add")}
                    </Button>
                  </div>
                </div>
                {draft.protections.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("protection.empty")}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {draft.protections.map((p) => (
                      <div
                        key={p.id}
                        className="space-y-2 rounded-md border p-2.5"
                      >
                        <div className="flex items-center gap-2">
                          <Input
                            value={p.pattern}
                            onChange={(e) =>
                              updateProtection(p.id, {
                                pattern: e.target.value,
                              })
                            }
                            placeholder="main"
                            className="font-mono"
                          />
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t("remove")}
                            onClick={() => removeProtection(p.id)}
                          >
                            <TrashIcon />
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                            <Checkbox
                              checked={p.blockDeletion}
                              onCheckedChange={(c) =>
                                updateProtection(p.id, {
                                  blockDeletion: c === true,
                                })
                              }
                            />
                            {t("protection.blockDeletion")}
                          </label>
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                            <Checkbox
                              checked={p.blockForcePush}
                              onCheckedChange={(c) =>
                                updateProtection(p.id, {
                                  blockForcePush: c === true,
                                })
                              }
                            />
                            {t("protection.blockForcePush")}
                          </label>
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                            <Checkbox
                              checked={p.requirePr}
                              onCheckedChange={(c) =>
                                updateProtection(p.id, {
                                  requirePr: c === true,
                                })
                              }
                            />
                            {t("protection.requirePullRequest")}
                          </label>
                        </div>
                        <div>
                          <span className="text-[11px] text-muted-foreground">
                            {t("protection.allowedMerges")}
                            {p.requirePr
                              ? ` (${t("protection.viaPullRequest")})`
                              : ""}
                          </span>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1.5">
                            {ALL_MERGE_METHODS.map((m) => (
                              <label
                                key={m}
                                className="flex cursor-pointer items-center gap-1.5 text-xs"
                              >
                                <Checkbox
                                  checked={p.allowedMergeMethods.includes(m)}
                                  onCheckedChange={(c) =>
                                    toggleMergeMethod(p.id, m, c === true)
                                  }
                                />
                                {t(`mergeMethod.${m}`)}
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-medium">{t("promotion.title")}</h3>
                  <Button
                    ref={addPromotionRef}
                    variant="outline"
                    size="xs"
                    onClick={addPromotionBranch}
                  >
                    <PlusIcon data-icon="inline-start" />
                    {t("add")}
                  </Button>
                </div>
                {promotionBranches.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("promotion.empty")}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {promotionBranches.map((pattern, i) => (
                      // Position IS the identity here: the entries are bare
                      // strings, so two blank rows would share any value-derived
                      // key. The inputs stay controlled from the array, so a
                      // removal re-renders the survivors correctly.
                      <div key={i} className="flex items-center gap-2">
                        <Input
                          ref={(el) => {
                            promotionRefs.current[i] = el;
                          }}
                          value={pattern}
                          onChange={(e) =>
                            updatePromotionBranch(i, e.target.value)
                          }
                          placeholder="staging"
                          className="font-mono"
                          aria-label={t("promotion.patternLabel", {
                            number: i + 1,
                          })}
                        />
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t("promotion.removeLabel", {
                            pattern: pattern || i + 1,
                          })}
                          onClick={() => removePromotionBranch(i)}
                        >
                          <TrashIcon />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <DisabledReasonButton
            // Below `sm` the footer stacks and stretches the wrapper span; the
            // Button fills it to match the stretched Cancel beside it.
            className="w-full"
            onClick={() => void doSave()}
            disabled={!active.data || !dirty || saving.isPending}
            reason={(() => {
              switch (true) {
                case !active.data && active.isError:
                  return t("save.loadError");
                case !active.data:
                  return t("save.loading");
                case !dirty:
                  return t("save.noChanges");
                default:
                  return t("save.saving");
              }
            })()}
          >
            {scope === "shared" ? t("save.shared") : t("save.personal")}
          </DisabledReasonButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
