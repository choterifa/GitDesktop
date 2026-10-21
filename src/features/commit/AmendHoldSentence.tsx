import { useTranslation } from "react-i18next";
import type { AmendHold } from "./useCommitSubmit";

/** One sentence per hold, total over the union so a new hold can't ship without
 *  copy; the trailing space separates it from the surface's Stop amending button. */
/** The amend banner's sentence, shared by the commit box and the commit dialog. */
export function AmendHoldSentence({
  hold,
  hash,
}: {
  hold: AmendHold;
  hash: string | null;
}) {
  const { t } = useTranslation("commit");
  return <>{t(`amend.hold.${hold}`, { hash: hash?.slice(0, 7) ?? "" })} </>;
}
