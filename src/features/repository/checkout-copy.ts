// Checkout copy shared across features: branch-row naming for every branch
// picker, and the refusal the app's HEAD-moving surfaces show. Component-free,
// so pulls/tags/history/compare read it without a cycle.
import { i18n } from "@/lib/i18n";

/** Last path segment (folder name). Git reports worktree paths forward-slashed
 *  on every platform (`UserWorktree.path`), and a backslash is a legal
 *  character in a POSIX directory name, so splitting on one truncates it. */
export const baseName = (p: string) => p.split("/").filter(Boolean).pop() ?? p;

/** How a branch row NAMES the checkout holding its branch — chip, tooltip, open
 *  item, after-the-fact toast, and the phrases that say a row is held because of
 *  it. Git counts the main workspace as a worktree and this row can point at it
 *  when you're standing in a linked one, but users don't call it one; routing
 *  the naming through one record keeps a later phrase from drifting back.
 *  "Rename worktree…" and "Delete worktree…" are deliberately NOT routed here:
 *  they name the git operation, and their held-reason carries the naming instead.
 *  `noun` is bare, for badges and parenthetical reasons; `blockedTitle` is the
 *  sentence-capitalized chip-tooltip form of `blocked`, for rows that name the
 *  holding checkout without offering to open it. */
/** Copy for a branch row that points to the checkout holding its branch. */
export const rowCheckoutCopy = (isMain: boolean | undefined) => {
  const arm = isMain ? "main" : "linked";
  const key = `checkoutCopy.${arm}`;
  const t = (suffix: string, options?: Record<string, string>) =>
    i18n.t(`${key}.${suffix}`, {
      ns: "repositoryOperations",
      ...options,
    });
  return {
    noun: t("noun"),
    open: t("open"),
    title: (path: string) => t("title", { name: baseName(path), path }),
    opened: (path: string) => t("opened", { name: baseName(path) }),
    blocked: t("blocked"),
    blockedTitle: (path: string) => t("blockedTitle", { path }),
    held: t("held"),
  };
};

/** The refusal every in-app HEAD- or branch-moving surface, and every branch
 *  delete, shows while `promotionBlocksCheckout` holds: in the main workspace the
 *  op would race the promote's own stash and checkout (or delete the branch it is
 *  about to check out), and in the promote's source worktree the folder is being
 *  removed. */
/** The shared, current-locale refusal for HEAD-moving operations during promotion. */
export const promotionBlocksCheckoutCopy = (): string =>
  i18n.t("checkoutCopy.promotionBlocksCheckout", {
    ns: "repositoryOperations",
  });
