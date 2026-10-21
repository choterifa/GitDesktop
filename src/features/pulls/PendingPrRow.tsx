import { GitPullRequestIcon } from "@phosphor-icons/react";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { clipTitleFromText } from "@/lib/clip-title";
import type { PrCreate } from "@/lib/stores/pr-create";
import { usePullsText } from "./use-pulls-text";

/** The one spelling of "this hold is a settled fact": the forge answered the
 *  create, so the pull request exists and is presumed open until evidence says
 *  otherwise. Deliberately NOT `!laneBlocks(create)` — the two coincide today,
 *  but this asks a presentation question about the entry's own state, and a
 *  change to the admission predicate must not silently repaint the row. */
function isHeldOpen(create: PrCreate): boolean {
  return create.phase === "created" && create.guardReleased;
}

/** The meta line, per lane phase — the only thing that distinguishes them, since
 *  a glyph alone carries no state under reduced motion. `creating` borrows the
 *  banner's verb so one screen never reads two words for one operation; the
 *  `created` arm splits on the guard, which is what separates a forge call still
 *  finishing from a pull request the forge opened and this view has yet to show. */
/**
 * The CONTENT of a row holding a running create's place, in the slot the real
 * row will take; the list panel owns the box. Row semantics split on phase:
 * a `created` entry has a number the PR view can open, so its pinned row is a
 * real, selectable one carrying the same `data-row` id the real row will; a
 * `creating` entry has nothing to open and stays presentational, absent from the
 * caller's arrow-key registry and the tab order. The repo view's create banner
 * stays the sole live region for this fact (a second one double-announces).
 */
export function PendingPrRow({ create }: { create: PrCreate }) {
  const tx = usePullsText();
  // The settled row drops the spinner: motion would claim work still running.
  // It takes the real row's own glyph, which the slot swap then leaves in place.
  const settled = isHeldOpen(create);
  return (
    <>
      <p className="flex items-center gap-1.5 text-xs font-medium">
        {settled ? (
          <GitPullRequestIcon className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <Spinner aria-hidden className="size-3 shrink-0" />
        )}
        <span className="min-w-0 truncate" title={create.title}>
          {create.title}
        </span>
        {create.draft && <Badge variant="secondary">{tx("Draft")}</Badge>}
      </p>
      <p
        className="mt-0.5 truncate pl-4 text-[11px] text-muted-foreground"
        onMouseEnter={clipTitleFromText}
      >
        {create.phase === "created"
          ? isHeldOpen(create)
            ? tx("#{{number}} · opened, not in this view yet", {
                number: create.number,
              })
            : tx("#{{number}} · updating list…", { number: create.number })
          : tx("Creating {{noun}}…", { noun: tx(create.noun) })}
      </p>
      <p
        className="mt-0.5 truncate pl-4 text-[11px] text-muted-foreground"
        onMouseEnter={clipTitleFromText}
      >
        {create.head} → {create.base}
      </p>
    </>
  );
}
