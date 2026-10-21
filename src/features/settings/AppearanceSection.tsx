import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { APP_LANGUAGES, type AppLanguage } from "@/lib/i18n";
import {
  useApplyLanguage,
  useApplyTheme,
  useSettings,
} from "@/lib/settings/queries";
import { THEME_ORDER, type ThemeSetting } from "@/lib/theme";

const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  "es-MX": "Español (México)",
  en: "English",
};

/**
 * Settings → Appearance. The theme picker is an apply-on-change preference owned
 * by this control (not the bulk Save bar), mirroring `diffViewMode`: it persists
 * and applies the class immediately, so picking a theme previews it live.
 */
export function AppearanceSection() {
  const settings = useSettings();
  const applyTheme = useApplyTheme();
  const applyLanguage = useApplyLanguage();
  const { t } = useTranslation("appearance");
  const labelId = useId();
  const languageLabelId = useId();
  const theme = settings.data?.theme ?? "system";
  const language = settings.data?.language ?? "es-MX";
  const themeLabels = Object.fromEntries(
    THEME_ORDER.map((id) => [id, t(`themes.${id}`)]),
  ) as Record<ThemeSetting, string>;

  function selectTheme(next: ThemeSetting) {
    if (settings.data) applyTheme(settings.data, next);
  }

  function selectLanguage(next: AppLanguage) {
    if (settings.data) applyLanguage(settings.data, next);
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">{t("title")}</h2>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>
      <div className="space-y-1.5">
        <span id={labelId} className="text-xs font-medium">
          {t("themeLabel")}
        </span>
        <div className="max-w-xs">
          <Select
            items={themeLabels}
            value={theme}
            onValueChange={(value) => selectTheme(value as ThemeSetting)}
          >
            <SelectTrigger aria-labelledby={labelId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEME_ORDER.map((id) => (
                <SelectItem key={id} value={id}>
                  {themeLabels[id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">{t("themeDescription")}</p>
      </div>
      <div className="space-y-1.5">
        <span id={languageLabelId} className="text-xs font-medium">
          {t("language.label")}
        </span>
        <div className="max-w-xs">
          <Select
            items={LANGUAGE_LABELS}
            value={language}
            onValueChange={(value) => selectLanguage(value as AppLanguage)}
          >
            <SelectTrigger aria-labelledby={languageLabelId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {APP_LANGUAGES.map((id) => (
                <SelectItem key={id} value={id}>
                  {LANGUAGE_LABELS[id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("language.description")}
        </p>
      </div>
    </section>
  );
}
