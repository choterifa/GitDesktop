import { type BackendModule, createInstance, type InitOptions } from "i18next";
import { initReactI18next } from "react-i18next";
import { invoke } from "@/lib/tauri/invoke";

export const APP_LANGUAGES = ["es-MX", "en"] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

const LANGUAGE_STORAGE_KEY = "gd-language";
const catalogLoaders = import.meta.glob("./locales/*/*.json", {
  import: "default",
}) as Record<string, () => Promise<unknown>>;

function isAppLanguage(value: unknown): value is AppLanguage {
  return (
    typeof value === "string" &&
    (APP_LANGUAGES as readonly string[]).includes(value)
  );
}

/** Read the small localStorage mirror before React's first paint. The Tauri
 * settings store remains authoritative; this mirror prevents a language flash. */
export function readLanguageMirror(): AppLanguage {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (isAppLanguage(stored)) return stored;
  } catch {
    // Webviews can disable localStorage. The persisted settings query reconciles
    // the language after startup in that case.
  }
  return "es-MX";
}

function writeLanguageMirror(language: AppLanguage): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // The Tauri settings store remains the durable source of truth.
  }
}

const lazyCatalogBackend: BackendModule = {
  type: "backend",
  init() {
    // The JSON loaders are entirely contained in `read`.
  },
  read(language, namespace, callback) {
    const loader = catalogLoaders[`./locales/${language}/${namespace}.json`];
    if (!loader) {
      // A namespace is optional in a locale: i18next falls back to English or
      // returns the key until that locale's catalog is added.
      callback(null, {});
      return;
    }
    void loader()
      .then((catalog) => callback(null, catalog as never))
      .catch((error: unknown) =>
        callback(error instanceof Error ? error : new Error(String(error)), {}),
      );
  },
};

export const i18n = createInstance();
let initialization: Promise<void> | null = null;

/** Initialize before the app renders so the saved locale is active on first paint. */
export function initializeI18n(
  language: AppLanguage = readLanguageMirror(),
): Promise<void> {
  initialization ??= i18n
    .use(lazyCatalogBackend)
    .use(initReactI18next)
    .init({
      lng: language,
      fallbackLng: "en",
      supportedLngs: [...APP_LANGUAGES],
      load: "currentOnly",
      ns: [
        "common",
        "appearance",
        "errors",
        "components",
        "repositoryOperations",
        "settings",
        "updates",
        "repoSettings",
        "explore",
        "codeTodos",
        "issues",
        "projects",
        "automations",
        "actions",
        "discussions",
        "research",
        "scripts",
        "sessions",
        "plan",
        "securityFindings",
        "pulls",
      ],
      defaultNS: "common",
      interpolation: { escapeValue: false },
      returnNull: false,
      react: { useSuspense: true },
    } satisfies InitOptions)
    .then(() => {
      if (typeof document !== "undefined") {
        document.documentElement.lang = getAppLanguage();
      }
      syncNativeLanguage(getAppLanguage());
    });
  return initialization;
}

export function getAppLanguage(): AppLanguage {
  return isAppLanguage(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : isAppLanguage(i18n.language)
      ? i18n.language
      : readLanguageMirror();
}

/** Best-effort sync for the native menu bar and tray. Web-only transports may
 * not implement this command; that must never block or undo the web locale. */
export function syncNativeLanguage(language: AppLanguage): void {
  void invoke<void>("set_native_language", { language }).catch(() => undefined);
}

/** Change language after its resources are ready and update the first-paint mirror. */
export async function changeAppLanguage(language: AppLanguage): Promise<void> {
  await initializeI18n();
  writeLanguageMirror(language);
  await i18n.changeLanguage(language);
  if (typeof document !== "undefined") {
    document.documentElement.lang = language;
  }
  syncNativeLanguage(language);
}
