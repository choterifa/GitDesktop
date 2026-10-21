import type { TFunction } from "i18next";
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";
import type { PunchCard as PunchCardData } from "@/lib/git/types";
import { cn } from "@/lib/utils";
import { fmt } from "./primitives";

const HOUR_TICKS = [0, 6, 12, 18];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const DAY_INDICES = Array.from({ length: 7 }, (_, day) => day);

function describe(
  grid: PunchCardData,
  day: number,
  hour: number,
  days: string[],
  hours: string[],
  t: TFunction<"repository">,
): string {
  const n = grid[day]?.[hour] ?? 0;
  return t("insights.punchCard.description", {
    count: n,
    day: days[day],
    hour: hours[hour],
    formatted: fmt(n),
  });
}

/** The loading shape of {@link PunchCard}: the same row, cell, tick and caption
 *  boxes, so its width-proportional height matches the loaded grid at any
 *  pane width. */
export function PunchCardSkeleton() {
  return (
    <div aria-hidden className="space-y-2">
      <div className="space-y-px text-[10px]">
        {DAY_INDICES.map((day) => (
          <div key={day} className="flex items-center gap-1">
            {/* The day label's line height sets the row at narrow widths. */}
            <span className="w-7 shrink-0">&nbsp;</span>
            <div className="flex flex-1 gap-px">
              {HOURS.map((hour) => (
                <Skeleton
                  key={hour}
                  className="aspect-square min-w-0 flex-1 rounded-[1px]"
                />
              ))}
            </div>
          </div>
        ))}
        <div className="pt-0.5">&nbsp;</div>
      </div>
      <p className="text-[11px]">
        <Skeleton className="inline-block h-[1em] w-48 align-middle" />
      </p>
    </div>
  );
}

/**
 * A 7×24 day-of-week × hour heatmap of commit times. Recharts has no heatmap,
 * so this is a custom CSS grid. Cell opacity scales with the count; the value
 * is also exposed via the cell title, an `aria-live` announcer, and 2-D
 * arrow-key navigation (←/→ hour, ↑/↓ day), so meaning never rides on color
 * alone.
 */
export function PunchCard({ grid }: { grid: PunchCardData }) {
  const { t, i18n } = useTranslation("repository");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, day) =>
        new Intl.DateTimeFormat(locale, {
          weekday: "short",
          timeZone: "UTC",
        }).format(new Date(Date.UTC(2024, 0, 7 + day))),
      ),
    [locale],
  );
  const hours = useMemo(
    () =>
      HOURS.map((hour) =>
        new Intl.DateTimeFormat(locale, {
          hour: "numeric",
          hour12: true,
          timeZone: "UTC",
        }).format(new Date(Date.UTC(2024, 0, 7, hour))),
      ),
    [locale],
  );
  const flat = grid.flat();
  const max = Math.max(1, ...flat);
  const total = flat.reduce((a, b) => a + b, 0);

  // Busiest bucket, for the caption.
  let peak = { day: 0, hour: 0, n: 0 };
  grid.forEach((row, day) =>
    row.forEach((n, hour) => {
      if (n > peak.n) peak = { day, hour, n };
    }),
  );

  const [active, setActive] = useState<[number, number] | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [day0, hour0] = active ?? [0, 0];

  // Move DOM focus to the active cell so the focus ring tracks arrow nav.
  useEffect(() => {
    if (!active) return;
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-cell="${active[0]}-${active[1]}"]`)
      ?.focus();
  }, [active]);

  function onKeyDown(e: KeyboardEvent) {
    let [d, h] = active ?? [0, 0];
    switch (e.key) {
      case "ArrowRight":
        h = Math.min(h + 1, 23);
        break;
      case "ArrowLeft":
        h = Math.max(h - 1, 0);
        break;
      case "ArrowDown":
        d = Math.min(d + 1, 6);
        break;
      case "ArrowUp":
        d = Math.max(d - 1, 0);
        break;
      default:
        return;
    }
    e.preventDefault();
    setActive([d, h]);
  }

  if (total === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t("insights.noCommitTimesToChart")}
      </p>
    );
  }

  return (
    <figure className="space-y-2">
      <div
        ref={gridRef}
        role="grid"
        aria-label={t("insights.commitsByDayHour")}
        onKeyDown={onKeyDown}
        className="space-y-px text-[10px] text-muted-foreground"
      >
        {grid.map((row, day) => (
          <div key={days[day]} role="row" className="flex items-center gap-1">
            <span className="w-7 shrink-0 text-right">{days[day]}</span>
            <div className="flex flex-1 gap-px">
              {row.map((n, hour) => {
                const isActive = day === day0 && hour === hour0;
                return (
                  <div
                    key={hour}
                    data-cell={`${day}-${hour}`}
                    role="gridcell"
                    aria-label={describe(grid, day, hour, days, hours, t)}
                    title={describe(grid, day, hour, days, hours, t)}
                    tabIndex={
                      isActive || (!active && day === 0 && hour === 0) ? 0 : -1
                    }
                    onFocus={() => setActive([day, hour])}
                    className={cn(
                      "aspect-square min-w-0 flex-1 rounded-[1px] bg-primary outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      n === 0 && "bg-muted",
                    )}
                    style={
                      n === 0 ? undefined : { opacity: 0.2 + 0.8 * (n / max) }
                    }
                  />
                );
              })}
            </div>
          </div>
        ))}
        <div className="flex items-center gap-1 pt-0.5">
          <span className="w-7 shrink-0" />
          <div className="relative flex flex-1 gap-px">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="min-w-0 flex-1 text-center">
                {HOUR_TICKS.includes(h) ? hours[h] : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <figcaption
        className="text-[11px] text-muted-foreground"
        aria-live="polite"
      >
        {active
          ? describe(grid, day0, hour0, days, hours, t)
          : t("insights.punchCard.busiest", {
              description: describe(grid, peak.day, peak.hour, days, hours, t),
            })}
      </figcaption>
    </figure>
  );
}
