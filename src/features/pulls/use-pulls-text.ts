import { useTranslation } from "react-i18next";

/** Translate stable English source labels from the pulls catalog. */
export function usePullsText() {
  const { t } = useTranslation("pulls");
  return (source: string, options?: Record<string, unknown>) =>
    t(source, { keySeparator: false, ...options });
}
