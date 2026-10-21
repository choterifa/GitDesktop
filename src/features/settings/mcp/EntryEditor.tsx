import {
  LockSimpleIcon,
  LockSimpleOpenIcon,
  PlusIcon,
  XIcon,
} from "@phosphor-icons/react";
import { LabeledGroup } from "@/components/form/labeled-group";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSettingsText } from "../use-settings-text";
import type { EntryRow } from "./shared";

/** The env-var / header rows editor inside the dialog. Each row can hold a plain
 *  value or be marked secret (masked, stored in the keychain). */
export function EntryEditor({
  label,
  keyPlaceholder,
  rows,
  editing,
  onAdd,
  onChange,
  onRemove,
}: {
  label: string;
  keyPlaceholder: string;
  rows: EntryRow[];
  editing: boolean;
  onAdd: () => void;
  onChange: (rowId: string, patch: Partial<EntryRow>) => void;
  onRemove: (rowId: string) => void;
}) {
  const tx = useSettingsText();
  return (
    <LabeledGroup
      label={label}
      actions={
        <Button type="button" variant="ghost" size="sm" onClick={onAdd}>
          <PlusIcon data-icon="inline-start" /> {tx("Add")}
        </Button>
      }
    >
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{tx("None.")}</p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.rowId} className="flex items-center gap-2">
              <Input
                value={row.key}
                onChange={(e) => onChange(row.rowId, { key: e.target.value })}
                placeholder={keyPlaceholder}
                className="w-44 shrink-0 font-mono"
                spellCheck={false}
              />
              <Input
                type={row.secret ? "password" : "text"}
                value={row.secret ? row.secretInput : row.value}
                onChange={(e) =>
                  onChange(
                    row.rowId,
                    row.secret
                      ? { secretInput: e.target.value }
                      : { value: e.target.value },
                  )
                }
                placeholder={
                  row.secret
                    ? editing
                      ? tx("•••• (leave blank to keep saved)")
                      : tx("secret value")
                    : tx("value")
                }
                className="flex-1 font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-pressed={row.secret}
                aria-label={
                  row.secret
                    ? tx("Stored in keychain")
                    : tx("Store in keychain")
                }
                title={
                  row.secret
                    ? tx("Secret — stored in your OS keychain")
                    : tx("Mark as a secret (store in OS keychain)")
                }
                onClick={() => onChange(row.rowId, { secret: !row.secret })}
              >
                {row.secret ? (
                  <LockSimpleIcon className="text-primary" />
                ) : (
                  <LockSimpleOpenIcon />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={tx("Remove")}
                onClick={() => onRemove(row.rowId)}
              >
                <XIcon />
              </Button>
            </div>
          ))}
        </div>
      )}
    </LabeledGroup>
  );
}
