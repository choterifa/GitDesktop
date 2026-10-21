import { toast } from "sonner";
import { i18n } from "@/lib/i18n";
import { confirmDiscardParkedWrites } from "@/lib/parked-writes";
import { toastError } from "@/lib/toast";
import { installUpdate, type Update } from "@/lib/updater";

/** One install at a time: the offer toast and the Settings banner both start
 *  one, and a second press mid-download would download again alongside it. */
let installing = false;

/**
 * Installs an update behind a live progress toast, then relaunches. Shared by
 * the launch check and the Settings "Check for updates" button so the install
 * UX is identical wherever the user starts it. `onProceed` runs once the
 * download is done and the parked-writes confirm (asked only when writes are
 * parked) has passed, so a failed download or a declined confirm keeps the
 * caller's offer up.
 */
export async function installUpdateWithToast(
  update: Update,
  onProceed?: () => void,
): Promise<void> {
  if (installing) return;
  installing = true;
  const id = toast.loading(
    i18n.t("downloading", { ns: "updates", version: update.version }),
  );
  try {
    const installed = await installUpdate(
      update,
      ({ downloaded, total }) => {
        const pct = total ? Math.round((downloaded / total) * 100) : null;
        toast.loading(
          pct !== null
            ? i18n.t("downloadingProgress", {
                ns: "updates",
                version: update.version,
                percent: pct,
              })
            : i18n.t("downloading", {
                ns: "updates",
                version: update.version,
              }),
          { id },
        );
      },
      async () => {
        // Settled while the prompt is open: the download is done, and a spinner
        // at 100% would read as still working.
        const proceed = await confirmDiscardParkedWrites("update", () =>
          toast(
            i18n.t("downloadedWaiting", {
              ns: "updates",
              version: update.version,
            }),
            { id, duration: Number.POSITIVE_INFINITY },
          ),
        );
        if (proceed) {
          toast.loading(
            i18n.t("installing", { ns: "updates", version: update.version }),
            { id },
          );
          onProceed?.();
        }
        return proceed;
      },
    );
    if (!installed) {
      toast.dismiss(id);
      return;
    }
    // relaunch() restarts the app, so this rarely shows.
    toast.success(i18n.t("installedRestarting", { ns: "updates" }), { id });
  } catch (e) {
    toast.dismiss(id);
    toastError(e);
  } finally {
    installing = false;
  }
}
