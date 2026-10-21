import { useTranslation } from "react-i18next";

/** Translate a short, stable English source label from the settings catalog. */
export function useSettingsText() {
  const { t } = useTranslation("settings");
  return (source: string, options?: Record<string, unknown>) =>
    t(source, { keySeparator: false, ...options });
}
