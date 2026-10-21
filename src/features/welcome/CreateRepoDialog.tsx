import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffectEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useOpenRecordedRepo } from "@/features/repository/useOpenRepoByPath";
import { required, useAppForm } from "@/lib/form";
import { createRepo, validateRepo } from "@/lib/git/api";
import { useGlobalDefaultBranch } from "@/lib/git/queries";
import { toastError } from "@/lib/toast";
import { useSeedOnOpen } from "@/lib/use-seed-on-open";

const NONE = "__none__";
const GITIGNORE_TEMPLATES = ["Node", "Python", "Rust", "Go"];
const LICENSES = ["MIT", "Unlicense"];

function selectItems(values: string[], noneLabel: string): Record<string, string> {
  return { [NONE]: noneLabel, ...Object.fromEntries(values.map((v) => [v, v])) };
}

const DEFAULTS = {
  name: "",
  description: "",
  parentDir: "",
  initReadme: true,
  gitignore: NONE,
  license: NONE,
};

export function CreateRepoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("welcome");
  const openRecorded = useOpenRecordedRepo();
  const globalDefaultBranch = useGlobalDefaultBranch();

  // The branch `git init` uses, from global git config; "main" when unset.
  const defaultBranch = (globalDefaultBranch.data ?? "").trim() || "main";

  const form = useAppForm({
    defaultValues: DEFAULTS,
    onSubmit: async ({ value }) => {
      try {
        const root = await createRepo({
          name: value.name.trim(),
          description: value.description.trim(),
          parentDir: value.parentDir.trim(),
          initReadme: value.initReadme,
          gitignore: value.gitignore === NONE ? null : value.gitignore,
          license: value.license === NONE ? null : value.license,
          defaultBranch,
        });
        const info = await validateRepo(root);
        // Closes and confirms even when a newer navigation superseded the
        // switch: the repository exists either way.
        await openRecorded(info);
        onOpenChange(false);
        toast.success(t("create.created", { name: info.name }));
      } catch (e) {
        toastError(e);
      }
    },
  });

  const seedOnOpen = useEffectEvent(() => form.reset(DEFAULTS));
  useSeedOnOpen(open, seedOnOpen);

  async function pickParentDir() {
    const path = await openDialog({
      directory: true,
      title: t("create.folderPickerTitle"),
    });
    if (path) form.setFieldValue("parentDir", path);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("create.title")}</DialogTitle>
            <DialogDescription>
              {t("create.description", { branch: defaultBranch })}
            </DialogDescription>
          </DialogHeader>
          <form.AppField
            name="name"
            validators={{ onChange: ({ value }) => required(value) }}
          >
            {(field) => (
              <field.TextField
                label={t("create.name")}
                placeholder={t("create.namePlaceholder")}
              />
            )}
          </form.AppField>
          <form.AppField name="description">
            {(field) => <field.TextField label={t("create.descriptionLabel")} />}
          </form.AppField>
          <form.AppField
            name="parentDir"
            validators={{ onChange: ({ value }) => required(value) }}
          >
            {(field) => (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <field.TextField
                    label={t("create.localPath")}
                    placeholder={t("create.pathPlaceholder")}
                  />
                </div>
                <Button type="button" variant="outline" onClick={pickParentDir}>
                  {t("create.choose")}
                </Button>
              </div>
            )}
          </form.AppField>
          <form.AppField name="initReadme">
            {(field) => (
              <field.CheckboxField
                label={t("create.initializeReadme")}
                className="flex cursor-pointer items-center gap-2 text-xs"
              />
            )}
          </form.AppField>
          <div className="grid grid-cols-2 gap-4">
            <form.AppField name="gitignore">
              {(field) => (
                <field.SelectField
                  label={t("create.gitignore")}
                  items={selectItems(GITIGNORE_TEMPLATES, t("create.none"))}
                />
              )}
            </form.AppField>
            <form.AppField name="license">
              {(field) => (
                <field.SelectField
                  label={t("create.license")}
                  items={selectItems(LICENSES, t("create.none"))}
                />
              )}
            </form.AppField>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("create.cancel")}
            </Button>
            <form.AppForm>
              <form.SubmitButton>{t("create.submit")}</form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
