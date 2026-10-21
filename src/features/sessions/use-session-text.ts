import { useTranslation } from "react-i18next";

/** Translate stable English source labels from the agent sessions catalog. */
export function useSessionText() {
  const { t } = useTranslation("sessions");
  return (source: string, options?: Record<string, unknown>) =>
    t(source, { keySeparator: false, ...options });
}
