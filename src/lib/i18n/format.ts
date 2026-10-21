import { type AppLanguage, getAppLanguage } from "@/lib/i18n";

/** Format a count with the active UI locale. Pass options for compact or fixed precision. */
export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
  language: AppLanguage = getAppLanguage(),
): string {
  return new Intl.NumberFormat(language, options).format(value);
}

/** Format a date using the active UI locale. */
export function formatDate(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
  language: AppLanguage = getAppLanguage(),
): string {
  return new Intl.DateTimeFormat(language, options).format(new Date(value));
}

/** Format a date and time using the active UI locale. */
export function formatDateTime(
  value: string | number | Date,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
  },
  language: AppLanguage = getAppLanguage(),
): string {
  return new Intl.DateTimeFormat(language, options).format(new Date(value));
}
