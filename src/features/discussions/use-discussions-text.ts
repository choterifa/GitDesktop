import { useTranslation } from "react-i18next";

/** Translate an English source label from the discussions catalog. */
export function useDiscussionsText() {
  const { t } = useTranslation("discussions");
  return (source: string, options?: Record<string, unknown>) =>
    t(source, { ns: ["discussions", "common"], keySeparator: false, ...options });
}
