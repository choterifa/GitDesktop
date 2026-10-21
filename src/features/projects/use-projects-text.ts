import { useTranslation } from "react-i18next";
import { i18n } from "@/lib/i18n";

/** Translate stable English source labels from the projects catalog. */
export function useProjectsText() {
  const { t } = useTranslation("projects");
  return (source: string, options?: Record<string, unknown>) =>
    t(source, { keySeparator: false, ...options });
}

/** Translate a projects label outside component render. */
export function projectsText(
  source: string,
  options?: Record<string, unknown>,
) {
  return i18n.t(source, {
    ns: "projects",
    keySeparator: false,
    ...options,
  });
}
