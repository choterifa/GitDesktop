import { useTranslation } from "react-i18next";

/** Translate an English source label from the shared UI catalog. */
export function useCommonText() {
  const { t } = useTranslation("common");
  return (source: string, options?: Record<string, unknown>) =>
    t(source, { keySeparator: false, ...options });
}
