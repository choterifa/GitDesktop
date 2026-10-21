import { useTranslation } from "react-i18next";

/** Translate stable English source labels from the planning surface catalog. */
export function usePlanText() {
  const { t } = useTranslation("plan");
  return (source: string, options?: Record<string, unknown>) =>
    t(source, { keySeparator: false, ...options });
}
