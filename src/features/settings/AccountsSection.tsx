import { useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DisabledReasonButton } from "@/components/disabled-reason-button";
import { useRelativeNow } from "@/components/relative-time";
import { StatusDetailChip } from "@/components/status-detail-chip";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { calendarDaysUntil } from "@/features/accounts/expiry";
import { copyText } from "@/lib/clipboard";
import { presentError } from "@/lib/error-summary";
import { useAppForm } from "@/lib/form";
import { forgeBbClearAccount, forgeBbSetAccount } from "@/lib/git/api";
import {
  MY_WORK_SOURCES_KEY,
  myWorkPageKey,
  useAccountsHealth,
  useBbAccount,
  useClearGitlabReviewToken,
  useGhAccounts,
  useGitlabReviewBotStatus,
  useSetGitlabReviewToken,
  useSwitchAccount,
} from "@/lib/git/queries";
import {
  type GhAccount,
  rateLimitResetTime,
  type SessionHealth,
} from "@/lib/git/types";
import { i18n } from "@/lib/i18n";
import { formatDate as formatLocaleDate } from "@/lib/i18n/format";
import { setBitbucketTokenExpiresAt } from "@/lib/settings/api";
import { useSettings } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { useSettingsText } from "./use-settings-text";

/** The GitLab CLI install docs — where the "install glab" affordance points. */
const GLAB_INSTALL_URL = "https://gitlab.com/gitlab-org/cli#installation";

/** The shared OAuth-vs-PAT nudge (matches ForgeNotReady's wording). */
const GLAB_OAUTH_NUDGE =
  "Tip: choose the browser (OAuth) option — OAuth sessions renew themselves, while personal access tokens expire.";

/** Where a Bitbucket / Atlassian API token is created. */
const ATLASSIAN_TOKEN_URL =
  "https://id.atlassian.com/manage-profile/security/api-tokens";

/** GitLab docs for minting a project/group access token (the review-bot token). */
const GITLAB_PROJECT_TOKEN_URL =
  "https://docs.gitlab.com/ee/user/project/settings/project_access_tokens.html";

/** The scopes a token needs for full Bitbucket support: the read scopes that power
 *  browsing/PR/Pipeline reads, the write/admin scopes for acting on PRs and Pipelines,
 *  and the repository admin/delete + webhook scopes that power repository management
 *  (publish, settings, branch restrictions, default reviewers, webhooks, delete). A
 *  write fails with a clear message if the token lacks the matching scope. */
const BB_SCOPES = [
  "read:user:bitbucket",
  "read:workspace:bitbucket",
  "read:repository:bitbucket",
  "write:repository:bitbucket",
  "admin:repository:bitbucket",
  "delete:repository:bitbucket",
  "read:pullrequest:bitbucket",
  "write:pullrequest:bitbucket",
  "read:pipeline:bitbucket",
  "write:pipeline:bitbucket",
  "admin:pipeline:bitbucket",
  "read:webhook:bitbucket",
  "write:webhook:bitbucket",
  "delete:webhook:bitbucket",
];

/** A `YYYY-MM-DD` string rendered in the user's locale ("Jul 30, 2026"); falls
 *  back to the raw string if it can't be parsed. */
function formatDate(date: string): string {
  const t = Date.parse(`${date}T00:00:00`);
  if (Number.isNaN(t)) return date;
  return formatLocaleDate(new Date(t), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** A rate-limited badge's detail: the forge's own message, then when access
 *  resumes. No Reconnect rides this state — the credential is fine. */
function rateLimitDetail(
  health: SessionHealth,
  now: number,
): string | undefined {
  const resumesAt = rateLimitResetTime(health.resetAt, now);
  const lines = [
    health.detail,
    resumesAt
      ? i18n.t("Access resumes at {{time}}", {
          ns: "settings",
          keySeparator: false,
          time: resumesAt,
        })
      : null,
  ].filter((line): line is string => Boolean(line));
  return lines.length > 0 ? lines.join("\n") : undefined;
}

/** Whether this gh supports multiple accounts (`gh auth switch`, 2.40+). */
function supportsSwitching(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 2 || (major === 2 && minor >= 40);
}

/**
 * Sign-in settings for the hosted providers: the GitHub CLI accounts (switch the
 * active account per host), a GitLab review-bot token (so AI reviews post as the
 * project bot rather than the signed-in `glab` account), and a Bitbucket Cloud
 * account (an Atlassian API token in the OS keychain). GitLab's day-to-day
 * sign-in is still CLI-driven like GitHub (via `glab auth login`).
 */
export function AccountsSection() {
  return (
    <div className="space-y-8">
      <GitHubAccounts />
      <GitLabAccount />
      <BitbucketAccount />
    </div>
  );
}

/**
 * GitHub accounts known to the gh CLI. Switching changes which account
 * every GitHub feature acts as — immediately, like API keys.
 */
function GitHubAccounts() {
  const tx = useSettingsText();
  const accounts = useGhAccounts();
  const switchAccount = useSwitchAccount();
  const health = useAccountsHealth();
  const openReconnect = useUiStore((s) => s.openReconnect);
  const now = useRelativeNow();

  async function switchTo(host: string, login: string) {
    try {
      await switchAccount.mutateAsync({ host, login });
    } catch (e) {
      toastError(e);
      return;
    }
    toast.success(tx("Switched to {{login}}", { login }));
  }

  const version = accounts.data?.version ?? "";
  const canSwitch = supportsSwitching(version);
  const list = accounts.data?.accounts ?? [];

  // Merge the health probe onto each account by host+login. Only `broken` and
  // `rateLimited` surface (silence is health — no "ok" chip); "offline" and
  // everything else read as fine, so a network blip never badges a good account.
  const healthByKey = useMemo(() => {
    const map = new Map<string, SessionHealth>();
    for (const h of health.data ?? []) {
      if (h.provider === "github") map.set(`${h.host}/${h.login}`, h);
    }
    return map;
  }, [health.data]);

  // Group accounts by host so a developer with both github.com and an
  // Enterprise account sees the active one per host. github.com first, then
  // alphabetical. A single-host user (today's common case) gets no subhead.
  const groups = useMemo(() => {
    const byHost = new Map<string, GhAccount[]>();
    for (const account of list) {
      const arr = byHost.get(account.host) ?? [];
      arr.push(account);
      byHost.set(account.host, arr);
    }
    return [...byHost.entries()].sort(([a], [b]) => {
      if (a === b) return 0;
      if (a === "github.com") return -1;
      if (b === "github.com") return 1;
      return a.localeCompare(b);
    });
  }, [list]);
  const multiHost = groups.length > 1;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">GitHub</h2>
        <p className="text-xs text-muted-foreground">
          {tx(
            "GitDesktop acts as whichever account is active in the GitHub CLI — pull requests, issues, and pushes all use it. Works with github.com and GitHub Enterprise hosts alike. (GitLab signs in the same way, via glab auth login.)",
          )}
        </p>
      </div>

      {/* The skeleton is one account row (the usual signed-in list); "Add an
          account" below is static, so it renders while gh is being read too and
          leaves only when gh turns out to be missing. */}
      {accounts.isPending ? (
        <Skeleton className="h-9.5 w-full max-w-xl" />
      ) : version === "" ? (
        <p className="text-xs text-muted-foreground">
          {tx(
            "The GitHub CLI (gh) isn't installed, so there are no accounts to manage.",
          )}
        </p>
      ) : (
        <>
          {list.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {tx("No account is signed in yet.")}
            </p>
          ) : (
            <div className="max-w-xl space-y-4">
              {groups.map(([host, hostAccounts]) => (
                <div key={host} className="space-y-1.5">
                  {multiHost && (
                    <p className="text-xs font-medium text-muted-foreground">
                      {host}
                    </p>
                  )}
                  <div className="space-y-px border">
                    {hostAccounts.map((account) => {
                      const rowHealth = healthByKey.get(
                        `${account.host}/${account.login}`,
                      );
                      const broken = rowHealth?.state === "broken";
                      const brokenDetail = rowHealth?.detail;
                      return (
                        <div
                          key={`${account.host}/${account.login}`}
                          className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
                        >
                          <span className="text-xs font-medium">
                            {account.login}
                          </span>
                          {account.active && (
                            <Badge variant="secondary">{tx("active")}</Badge>
                          )}
                          {broken && (
                            <StatusDetailChip
                              variant="destructive"
                              label={tx("session expired")}
                              detail={
                                brokenDetail ??
                                (account.active
                                  ? undefined
                                  : tx(
                                      "Switch to this account, then reconnect.",
                                    ))
                              }
                            />
                          )}
                          {rowHealth?.state === "rateLimited" && (
                            <StatusDetailChip
                              variant="outline"
                              className="text-warning"
                              label={tx("rate limited")}
                              detail={rateLimitDetail(rowHealth, now)}
                            />
                          )}
                          <span className="flex-1" />
                          {broken && account.active && (
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() =>
                                openReconnect({
                                  provider: "github",
                                  host: account.host,
                                  mode: "refresh",
                                })
                              }
                            >
                              {tx("Reconnect")}
                            </Button>
                          )}
                          {!account.active && (
                            <DisabledReasonButton
                              variant="outline"
                              size="xs"
                              disabled={!canSwitch || switchAccount.isPending}
                              // Only the CLI-version term is a reason; an
                              // in-flight switch would announce it falsely.
                              reason={
                                canSwitch
                                  ? undefined
                                  : tx(
                                      "Switching needs GitHub CLI 2.40 or newer",
                                    )
                              }
                              title={tx(
                                "Make {{login}} the active account on {{host}}",
                                { login: account.login, host: account.host },
                              )}
                              onClick={() =>
                                void switchTo(account.host, account.login)
                              }
                            >
                              {switchAccount.isPending && (
                                <Spinner data-icon="inline-start" />
                              )}
                              {tx("Switch")}
                            </DisabledReasonButton>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!canSwitch && (
            <p className="text-xs text-warning">
              {tx(
                "Multiple accounts need GitHub CLI 2.40+ (you have {{version}}). Update with",
                { version },
              )}{" "}
              <button
                type="button"
                className="font-mono underline underline-offset-2"
                onClick={() =>
                  copyText("winget upgrade GitHub.cli", tx("Command copied"))
                }
                title={tx("Copy command")}
              >
                winget upgrade GitHub.cli
              </button>
              {tx(", then restart GitDesktop.")}
            </p>
          )}
        </>
      )}

      {(accounts.isPending || version !== "") && (
        <div className="space-y-2">
          <p className="text-xs font-medium">{tx("Add an account")}</p>
          {/* Held while gh is read: the block keeps its place, but a sign-in
              must not start before the CLI is known to be installed. */}
          <DisabledReasonButton
            size="sm"
            className="cursor-pointer"
            disabled={accounts.isPending}
            reason={
              accounts.isPending
                ? tx("Checking for the GitHub CLI…")
                : undefined
            }
            onClick={() =>
              openReconnect({
                provider: "github",
                host: "github.com",
                mode: "login",
              })
            }
          >
            {tx("Sign in to GitHub…")}
          </DisabledReasonButton>
          <p className="text-xs text-muted-foreground">
            {tx("For a GitHub Enterprise host, run")}{" "}
            <button
              type="button"
              className="font-mono underline underline-offset-2"
              onClick={() =>
                copyText("gh auth login -h <host>", tx("Command copied"))
              }
              title={tx("Copy command")}
            >
              gh auth login -h &lt;host&gt;
            </button>{" "}
            {tx("in a terminal, then come back here.")}
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * The GitLab day-to-day sign-in block (distinct from the review-bot token below):
 * the `glab` accounts known to the CLI, with a "session expired" badge + Reconnect
 * on a broken one, a "rate limited" badge (no Reconnect) on a rate-limited one,
 * and a warning before a knowable PAT expiry. OAuth sessions
 * renew themselves, so they carry no expiry chip. Sourced from the accounts-health
 * probe. cliMissing → an install affordance; no signed-in host → a sign-in button.
 */
function GitLabSignInBlock() {
  const tx = useSettingsText();
  const health = useAccountsHealth();
  const openReconnect = useUiStore((s) => s.openReconnect);
  const now = useRelativeNow();

  const gitlab = (health.data ?? []).filter((h) => h.provider === "gitlab");
  const cliMissing = gitlab.some((h) => h.state === "cliMissing");
  // Signed-in hosts = the entries that name a real host (a cliMissing/notConnected
  // sentinel carries none we should list as an account).
  const hosts = gitlab.filter(
    (h) => h.state !== "cliMissing" && h.state !== "notConnected",
  );

  return (
    <div className="max-w-xl space-y-3">
      {/* Sized to the loaded arms (install or sign-in prompt, one host row);
          the nudge below is static, so it renders from the first frame. */}
      {health.isPending ? (
        <Skeleton className="h-13 w-full" />
      ) : cliMissing ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {tx("The GitLab CLI (glab) isn't installed.")}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={() => openUrl(GLAB_INSTALL_URL)}
          >
            {tx("Install the GitLab CLI")}
          </Button>
        </div>
      ) : hosts.length === 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {tx("No GitLab host is signed in yet.")}
          </p>
          <Button
            size="sm"
            className="cursor-pointer"
            onClick={() =>
              openReconnect({
                provider: "gitlab",
                host: "gitlab.com",
                mode: "login",
              })
            }
          >
            {tx("Sign in to gitlab.com…")}
          </Button>
        </div>
      ) : (
        <div className="space-y-px border">
          {hosts.map((h) => {
            const broken = h.state === "broken";
            const warnExpiry =
              h.state === "healthy" &&
              h.method === "pat" &&
              h.daysLeft != null &&
              h.daysLeft <= 14;
            return (
              <div
                key={`${h.host}/${h.login ?? ""}`}
                className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">
                    {h.login ?? h.host}
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {h.host}
                  </p>
                </div>
                {broken && (
                  <StatusDetailChip
                    variant="destructive"
                    className="ml-auto shrink-0"
                    label={tx("session expired")}
                    detail={h.detail}
                  />
                )}
                {h.state === "rateLimited" && (
                  <StatusDetailChip
                    variant="outline"
                    className="ml-auto shrink-0 text-warning"
                    label={tx("rate limited")}
                    detail={rateLimitDetail(h, now)}
                  />
                )}
                {warnExpiry && (
                  <StatusDetailChip
                    variant="outline"
                    className="ml-auto shrink-0 text-warning"
                    label={
                      (h.daysLeft ?? 0) < 0
                        ? tx("token expired")
                        : h.daysLeft === 0
                          ? tx("token expires today")
                          : tx("token expires in {{count}} {{unit}}", {
                              count: h.daysLeft,
                              unit: h.daysLeft === 1 ? tx("day") : tx("days"),
                            })
                    }
                    detail={h.detail}
                  />
                )}
                {broken && (
                  <Button
                    variant="outline"
                    size="xs"
                    className="shrink-0"
                    onClick={() =>
                      openReconnect({
                        provider: "gitlab",
                        host: h.host,
                        mode: "refresh",
                      })
                    }
                  >
                    {tx("Reconnect")}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">{tx(GLAB_OAUTH_NUDGE)}</p>
    </div>
  );
}

/**
 * The GitLab review-bot token — a project or group access token so AI reviews
 * post as that project's bot user instead of the signed-in `glab` account.
 * Immediate-apply like the AI-provider keys (the token isn't part of the
 * settings draft): connecting validates the token against GitLab, saves it to
 * the OS keychain, and returns the bot login the status line then reflects. The
 * token itself never leaves the backend — it's never rendered or logged, and the
 * input clears on success.
 */
function GitLabAccount() {
  const tx = useSettingsText();
  const status = useGitlabReviewBotStatus();
  const setToken = useSetGitlabReviewToken();
  const clearToken = useClearGitlabReviewToken();
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const botLogin = status.data ?? null;

  const form = useAppForm({
    defaultValues: { token: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const login = await setToken.mutateAsync(value.token.trim());
        form.reset({ token: "" });
        toast.success(tx("AI reviews now post as @{{login}}", { login }));
      } catch (e) {
        setError(presentError(e).summary);
      }
    },
  });

  const token = useSelector(form.store, (s) => s.values.token);
  const canSubmit = token.trim().length > 0;

  async function disconnect() {
    try {
      await clearToken.mutateAsync();
      setConfirmClear(false);
      form.reset({ token: "" });
      toast.success(tx("GitLab review bot disconnected"));
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <section className="space-y-4 border-t pt-6">
      <div>
        <h2 className="text-sm font-medium">GitLab</h2>
        <p className="text-xs text-muted-foreground">
          {tx(
            "GitDesktop acts as whichever account is signed in to the GitLab CLI (glab) — merge requests, issues, and pushes all use it. Works with gitlab.com and self-managed GitLab hosts alike; signing in from here covers gitlab.com, so for your own instance run",
          )}{" "}
          <span className="font-mono">glab auth login --hostname …</span>{" "}
          {tx("in a terminal and it appears below.")}
        </p>
      </div>

      <GitLabSignInBlock />

      <div className="space-y-2">
        <p className="text-xs font-medium">{tx("AI review bot")}</p>
        <p className="text-xs text-muted-foreground">
          {tx(
            "Add a GitLab project or group access token to post AI reviews as that project's bot user instead of your signed-in account. Tokens are stored in the OS keychain, never in app files.",
          )}
        </p>
      </div>

      <div className="max-w-xl space-y-4">
        {/* The skeleton is the connected box's size; the docs below don't
            depend on the status, so they render from the first frame. */}
        {status.isPending ? (
          <Skeleton className="h-22 w-full" />
        ) : botLogin ? (
          <div className="space-y-3 border">
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <p className="min-w-0 truncate text-xs">
                {tx("AI reviews post as")}{" "}
                <span className="font-medium">@{botLogin}</span>
              </p>
              <Badge variant="secondary" className="ml-auto shrink-0">
                {tx("connected")}
              </Badge>
            </div>
            <div className="flex items-center gap-2 px-3 pb-3">
              <Button
                variant="destructive"
                size="xs"
                onClick={() => setConfirmClear(true)}
              >
                {tx("Disconnect")}
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
          >
            <form.AppField name="token">
              {(field) => (
                <field.TextField
                  type="password"
                  label={tx("Project or group access token")}
                  placeholder={tx(
                    "Paste a GitLab project or group access token",
                  )}
                />
              )}
            </form.AppField>

            <div className="flex items-center gap-2">
              <DisabledReasonButton
                type="submit"
                size="sm"
                disabled={!canSubmit || setToken.isPending}
                // No `reason`: the same text renders as the visible warning
                // beside the button, so announcing it would double up.
                title={
                  canSubmit
                    ? undefined
                    : tx("Paste a project or group access token")
                }
              >
                {setToken.isPending && <Spinner data-icon="inline-start" />}
                {tx("Connect")}
              </DisabledReasonButton>
              {!canSubmit && (
                <span className="text-xs text-warning">
                  {tx("Paste a project or group access token")}
                </span>
              )}
            </div>

            {error && <p className="text-xs text-destructive">{error}</p>}
          </form>
        )}

        <div className="space-y-1.5 text-xs text-muted-foreground">
          <p>
            {tx(
              "The token needs the api scope and a role of Maintainer or Owner to mint. On gitlab.com, project access tokens require a Premium or Ultimate namespace (they're free on self-managed GitLab). This applies to gitlab.com in this version.",
            )}
          </p>
          <button
            type="button"
            className="cursor-pointer underline underline-offset-2"
            onClick={() => openUrl(GITLAB_PROJECT_TOKEN_URL)}
            title={tx("Open the GitLab project access token docs")}
          >
            {tx("Create one on GitLab")}
          </button>
        </div>
      </div>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tx("Disconnect the GitLab review bot?")}</DialogTitle>
            <DialogDescription>
              {tx(
                "Removes the saved project access token from the OS keychain. AI reviews will post as your signed-in GitLab account again. This can't be undone.",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              {tx("Cancel")}
            </Button>
            <Button variant="destructive" onClick={disconnect}>
              {tx("Disconnect")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/**
 * A Bitbucket Cloud account, connected with an Atlassian API token. Immediate-
 * apply like the AI-provider keys (the token isn't part of the settings draft):
 * connecting validates the token against Bitbucket, saves it to the OS keychain,
 * and flips open Bitbucket repos ready without a restart.
 */
function BitbucketAccount() {
  const tx = useSettingsText();
  const account = useBbAccount();
  const settings = useSettings();
  const queryClient = useQueryClient();
  const [replacing, setReplacing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = account.data ?? null;
  const storedExpiry = settings.data?.bitbucketTokenExpiresAt ?? null;
  const expiryDaysLeft = calendarDaysUntil(storedExpiry);

  // The set/clear both invalidate the account query AND every repo's forge-status
  // so a connected Bitbucket repo lights up (or goes dark) without a restart. The
  // settings key too, so the stored token-expiry date reflects immediately. And
  // the work inbox: its sources probe is what gates the Bitbucket leg, on a
  // 5-minute window, so without it a just-connected account reads as absent (and
  // a disconnected one keeps fetching against a missing token) until that lapses.
  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["bb-account"] });
    queryClient.invalidateQueries({ queryKey: ["settings"] });
    queryClient.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === "repo" && q.queryKey[2] === "forge-status",
    });
    queryClient.invalidateQueries({ queryKey: MY_WORK_SOURCES_KEY });
    queryClient.invalidateQueries({ queryKey: myWorkPageKey("bitbucket") });
  }

  const form = useAppForm({
    // `expiresAt` is optional — connect works without it. Seeded from the stored
    // value so "Replace token…" pre-fills the current expiry.
    defaultValues: {
      email: connected?.email ?? "",
      token: "",
      expiresAt: storedExpiry ?? "",
    },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const info = await forgeBbSetAccount(
          value.email.trim(),
          value.token.trim(),
        );
        // Persist the optional expiry on the serialized settings chain (empty =
        // clear). Ride it so a concurrent recent-repo write can't clobber it.
        await setBitbucketTokenExpiresAt(value.expiresAt.trim() || null);
        form.reset({
          email: info.email,
          token: "",
          expiresAt: value.expiresAt,
        });
        setReplacing(false);
        invalidateAll();
        toast.success(
          tx("Connected to Bitbucket as {{user}}", {
            user: info.username ?? info.email,
          }),
        );
      } catch (e) {
        setError(presentError(e).summary);
      }
    },
  });

  const email = useSelector(form.store, (s) => s.values.email);
  const token = useSelector(form.store, (s) => s.values.token);
  const canSubmit = email.trim().length > 0 && token.trim().length > 0;
  const disabledReason =
    email.trim().length === 0
      ? tx("Enter your Atlassian account email")
      : token.trim().length === 0
        ? tx("Paste an Atlassian API token")
        : null;

  async function clearAccount() {
    try {
      await forgeBbClearAccount();
      // The stored expiry can't outlive the token it described.
      await setBitbucketTokenExpiresAt(null);
      setConfirmClear(false);
      setReplacing(false);
      form.reset({ email: "", token: "", expiresAt: "" });
      invalidateAll();
      toast.success(tx("Disconnected from Bitbucket"));
    } catch (e) {
      toastError(e);
    }
  }

  const showForm = !connected || replacing;

  return (
    <section className="space-y-4 border-t pt-6">
      <div>
        <h2 className="text-sm font-medium">Bitbucket</h2>
        <p className="text-xs text-muted-foreground">
          {tx(
            "Connect Bitbucket Cloud with an Atlassian API token to browse and clone your repositories and read pull requests and Pipelines. Tokens are stored in the OS keychain, never in app files.",
          )}
        </p>
      </div>

      <div className="max-w-xl space-y-4">
        {/* The skeleton is the connected box's size; the docs below don't
            depend on the account, so they render from the first frame. */}
        {account.isPending ? (
          <Skeleton className="h-25 w-full" />
        ) : (
          <>
            {connected && !replacing && (
              <div className="space-y-3 border">
                <div className="flex items-center gap-2 border-b px-3 py-2">
                  <div className="min-w-0">
                    <p
                      className="truncate text-xs font-medium"
                      title={connected.username ?? connected.email}
                    >
                      {connected.displayName ??
                        connected.username ??
                        connected.email}
                    </p>
                    <p
                      className="truncate text-[11px] text-muted-foreground"
                      title={connected.email}
                    >
                      {connected.username ? `${connected.username} · ` : ""}
                      {connected.email}
                    </p>
                  </div>
                  <Badge variant="secondary" className="ml-auto shrink-0">
                    {tx("connected")}
                  </Badge>
                </div>
                {storedExpiry && (
                  <p
                    className={`px-3 text-[11px] ${
                      expiryDaysLeft != null && expiryDaysLeft <= 14
                        ? "text-warning"
                        : "text-muted-foreground"
                    }`}
                  >
                    {expiryDaysLeft != null && expiryDaysLeft <= 14
                      ? `${
                          expiryDaysLeft < 0
                            ? tx("token expired")
                            : expiryDaysLeft === 0
                              ? tx("token expires today")
                              : tx("token expires in {{count}} {{unit}}", {
                                  count: expiryDaysLeft,
                                  unit:
                                    expiryDaysLeft === 1
                                      ? tx("day")
                                      : tx("days"),
                                })
                        } — ${tx("replace the token soon")}`
                      : tx("token expires {{date}}", {
                          date: formatDate(storedExpiry),
                        })}
                  </p>
                )}
                <div className="flex items-center gap-2 px-3 pb-3">
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      setError(null);
                      form.reset({
                        email: connected.email,
                        token: "",
                        expiresAt: storedExpiry ?? "",
                      });
                      setReplacing(true);
                    }}
                  >
                    {tx("Replace token…")}
                  </Button>
                  <Button
                    variant="destructive"
                    size="xs"
                    onClick={() => setConfirmClear(true)}
                  >
                    {tx("Disconnect")}
                  </Button>
                </div>
              </div>
            )}

            {showForm && (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  form.handleSubmit();
                }}
              >
                <form.AppField name="email">
                  {(field) => (
                    <field.TextField
                      type="email"
                      label={tx("Atlassian account email")}
                      placeholder="you@example.com"
                    />
                  )}
                </form.AppField>
                <form.AppField name="token">
                  {(field) => (
                    <field.TextField
                      type="password"
                      label={tx("API token")}
                      placeholder={tx("Paste your Atlassian API token")}
                    />
                  )}
                </form.AppField>
                {/* Optional — connect works without it (Bitbucket never reports the
                  expiry, so it's user-supplied to power the pre-expiry warning). */}
                <div className="space-y-1.5">
                  <form.AppField name="expiresAt">
                    {(field) => (
                      <field.TextField
                        type="date"
                        label={tx("Token expires on")}
                      />
                    )}
                  </form.AppField>
                  <p className="text-[11px] text-muted-foreground">
                    {tx(
                      "Shown when Atlassian created the token (max 1 year). Lets GitDesktop warn you before it expires.",
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <DisabledReasonButton
                    type="submit"
                    size="sm"
                    disabled={!canSubmit}
                    // No `reason`: the same text renders as the visible warning
                    // beside the button, so announcing it would double up.
                    title={disabledReason ?? undefined}
                  >
                    {connected ? tx("Save token") : tx("Connect")}
                  </DisabledReasonButton>
                  {replacing && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setReplacing(false);
                        setError(null);
                      }}
                    >
                      {tx("Cancel")}
                    </Button>
                  )}
                  {disabledReason && (
                    <span className="text-xs text-warning">
                      {disabledReason}
                    </span>
                  )}
                </div>

                {error && <p className="text-xs text-destructive">{error}</p>}
              </form>
            )}
          </>
        )}

        <div className="space-y-1.5 text-xs text-muted-foreground">
          <p>
            {tx("Create a token at")}{" "}
            <button
              type="button"
              className="cursor-pointer underline underline-offset-2"
              onClick={() => openUrl(ATLASSIAN_TOKEN_URL)}
              title={tx("Open the Atlassian API tokens page")}
            >
              id.atlassian.com
            </button>{" "}
            {` ${tx("and sign in with your Atlassian account email (not your Bitbucket username). The token needs these scopes; write scopes let you act on pull requests and Pipelines.")}`}
          </p>
          <ul className="flex flex-wrap gap-1">
            {BB_SCOPES.map((scope) => (
              <li
                key={scope}
                className="rounded-none border px-1.5 py-0.5 font-mono text-[10px]"
              >
                {scope}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tx("Disconnect Bitbucket?")}</DialogTitle>
            <DialogDescription>
              {tx(
                "Removes the saved Atlassian API token from the OS keychain. Bitbucket repositories will stop loading their pull requests and Pipelines until you connect again. This can't be undone.",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              {tx("Cancel")}
            </Button>
            <Button variant="destructive" onClick={clearAccount}>
              {tx("Disconnect")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
