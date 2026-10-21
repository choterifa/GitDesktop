import { WarningIcon } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function GitMissingScreen({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation("welcome");
  return (
    <div className="flex h-screen items-center justify-center p-8">
      <div className="w-full max-w-md space-y-4">
        <Alert variant="destructive">
          <WarningIcon />
          <AlertTitle>{t("gitMissing.title")}</AlertTitle>
          <AlertDescription>
            {t("gitMissing.description")}
          </AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <Button onClick={onRetry}>{t("gitMissing.retry")}</Button>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={() => openUrl("https://git-scm.com/downloads")}
          >
            {t("gitMissing.download")}
          </Button>
        </div>
      </div>
    </div>
  );
}
