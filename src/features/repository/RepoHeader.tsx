import { ArrowLeftIcon, GearIcon, QuestionIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { BranchCiBadge } from "@/features/actions/BranchCiBadge";
import { BranchJiraBadge } from "@/features/actions/BranchJiraBadge";
import { ActivityDock } from "@/features/activity/ActivityDock";
import { useUpdateCheck } from "@/features/updates/useUpdateCheck";
import { useUiStore } from "@/lib/stores/ui";
import { BranchSwitcher } from "./BranchSwitcher";
import { RepoSwitcher } from "./RepoSwitcher";
import { RepositoryMenu } from "./RepositoryMenu";
import { SyncControls } from "./SyncControls";

export function RepoHeader({ repoPath }: { repoPath: string }) {
  const closeRepo = useUiStore((s) => s.closeRepo);
  const openSettings = useUiStore((s) => s.openSettings);
  const openHelp = useUiStore((s) => s.openHelp);
  const updateAvailable = Boolean(useUpdateCheck().data);
  const { t } = useTranslation("repositoryOperations");

  return (
    // The named container drives the compact layout of the branch, badges and
    // repo switcher below 56rem of header content.
    <header className="@container/repo-header flex items-center gap-2 border-b px-3 py-2">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("repoHeader.back")}
        title={t("repoHeader.back")}
        onClick={closeRepo}
      >
        <ArrowLeftIcon />
      </Button>
      <RepoSwitcher />
      <RepositoryMenu repoPath={repoPath} />
      <Separator orientation="vertical" className="my-1" />
      <BranchSwitcher repoPath={repoPath} />
      <BranchCiBadge repoPath={repoPath} />
      <BranchJiraBadge repoPath={repoPath} />
      <div className="flex-1" />
      <SyncControls repoPath={repoPath} />
      <ActivityDock />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("repoHeader.help")}
        title={t("repoHeader.helpTitle")}
        onClick={openHelp}
      >
        <QuestionIcon />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="relative"
        aria-label={
          updateAvailable
            ? t("repoHeader.settingsUpdateAvailable")
            : t("repoHeader.settings")
        }
        title={
          updateAvailable
            ? t("repoHeader.settingsUpdateAvailable")
            : t("repoHeader.settings")
        }
        onClick={() => openSettings()}
      >
        <GearIcon />
        {updateAvailable && (
          <span
            aria-hidden
            className="absolute top-1 right-1 size-1.5 rounded-full bg-primary ring-2 ring-background animate-in fade-in motion-reduce:animate-none"
          />
        )}
      </Button>
    </header>
  );
}
