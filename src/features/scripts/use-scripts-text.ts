import { useCallback } from "react";
import { useTranslation } from "react-i18next";

/** Translate a stable English source string from the scripts catalog. */
export function useScriptsText() {
  const { t } = useTranslation("scripts");
  return useCallback(
    (source: string, options?: Record<string, unknown>) =>
      t(source, { keySeparator: false, ...options }),
    [t],
  );
}
