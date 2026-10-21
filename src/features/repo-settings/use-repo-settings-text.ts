import { useTranslation } from "react-i18next";
import { i18n } from "@/lib/i18n";

/** Translate a source label outside a component render. RepoSettingsDialog
 *  subscribes to language changes and re-renders its active section. */
export function repoSettingsText(
  source: string,
  options?: Record<string, unknown>,
) {
  return i18n.t(normalizeSource(source), {
    ns: "repoSettings",
    keySeparator: false,
    ...options,
  });
}

/** Translate a stable English source label from the repository-settings catalog. */
export function useRepoSettingsText() {
  const { t } = useTranslation("repoSettings");
  return (source: string, options?: Record<string, unknown>) => {
    return t(normalizeSource(source), { keySeparator: false, ...options });
  };
}

function normalizeSource(source: string) {
  return source.replace(/\s+/g, " ").trim();
}
