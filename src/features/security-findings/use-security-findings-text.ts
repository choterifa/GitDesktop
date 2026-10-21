import { useCallback } from "react";
import { useTranslation } from "react-i18next";

/** Translate a stable English source string from the security findings catalog. */
export function useSecurityFindingsText() {
  const { t } = useTranslation("securityFindings");
  return useCallback(
    (source: string, options?: Record<string, unknown>) =>
      t(source, { keySeparator: false, ...options }),
    [t],
  );
}
