import { withForm } from "@/lib/form";
import { settingsFormOpts } from "./settings-form";
import { useSettingsText } from "./use-settings-text";

export const InstructionsSection = withForm({
  ...settingsFormOpts,
  render: function InstructionsSectionRender({ form }) {
    const tx = useSettingsText();
    return (
      <section className="space-y-4 border-t pt-4">
        <div>
          <h2 className="text-sm font-medium">{tx("Instructions")}</h2>
          <p className="text-xs text-muted-foreground">
            {tx('Applied to every AI generation. Use instructions for team conventions, e.g. “Follow Conventional Commits” or “Explain intent, not implementation.”')}
          </p>
        </div>
        <form.AppField name="globalInstructions">
          {(field) => (
            <field.TextareaField
              label={tx("Global instructions")}
              rows={6}
              className="max-h-64"
              placeholder={
                "Debes seguir Conventional Commits.\nExplica siempre el contexto de negocio en el cuerpo."
              }
            />
          )}
        </form.AppField>
        <div className="space-y-2">
          <form.AppField name="aiIgnorePatterns">
            {(field) => (
              <field.TextareaField
                label={tx("Excluded files")}
                rows={4}
                className="max-h-48 font-mono"
                placeholder={".agents\n*.lock\ndocs/generated"}
              />
            )}
          </form.AppField>
          <p className="text-xs text-muted-foreground">
            {tx("gitignore-style patterns, one per line:")}{" "}
            <code className="rounded bg-muted px-1 py-0.5">secrets.env</code>{" "}
            {tx("matches that file at any depth,")}{" "}
            <code className="rounded bg-muted px-1 py-0.5">/secrets.env</code>{" "}
            {tx("only the copy at the repo root, and")}{" "}
            <code className="rounded bg-muted px-1 py-0.5">vendor/</code> a
            {tx("matches a folder at any depth. A leading")}{" "}
            <code className="rounded bg-muted px-1 py-0.5">!</code>{" "}
            {tx("re-includes something hidden by a broader pattern. To keep a file inside an excluded folder, exclude the folder's contents (")}
            <code className="rounded bg-muted px-1 py-0.5">vendor/*</code>, not{" "}
            <code className="rounded bg-muted px-1 py-0.5">vendor/</code>),
            {tx("since git never re-includes files below an excluded directory. These patterns are applied after the repository's own ignore file, so a repo can't re-expose what you excluded here. Matching files stay staged and committed as usual, but their diffs are hidden from the AI so noisy folders don't dominate the message.")}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {tx("Per-repository overrides: create")}{" "}
          <code className="rounded bg-muted px-1 py-0.5">
            .gitdesktop/instructions.md
          </code>{" "}
          {tx("for project-specific rules and")}{" "}
          <code className="rounded bg-muted px-1 py-0.5">
            .gitdesktop/aiignore
          </code>{" "}
          {tx("for project-specific exclusions. Both combine with the global settings above.")}
        </p>
      </section>
    );
  },
});
