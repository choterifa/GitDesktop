import { CheckCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { CommunityInsights } from "@/lib/git/types";
import { fmt, Stat } from "./primitives";

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      {ok ? (
        <CheckCircleIcon
          weight="fill"
          className="size-3.5 shrink-0 text-success"
        />
      ) : (
        <XCircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className={ok ? undefined : "text-muted-foreground"}>{label}</span>
    </li>
  );
}

export function CommunityCard({ data }: { data: CommunityInsights }) {
  const { t } = useTranslation("repository");
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-x-8">
        <Stat label={t("communityCard.stars")}>
          {fmt(data.stargazersCount)}
        </Stat>
        <Stat label={t("communityCard.forks")}>{fmt(data.forksCount)}</Stat>
        <Stat label={t("communityCard.watchers")}>
          {fmt(data.watchersCount)}
        </Stat>
        <Stat label={t("communityCard.openIssues")}>
          {fmt(data.openIssuesCount)}
        </Stat>
      </dl>
      <div>
        <p className="mb-1 text-xs">
          {t("communityCard.health")}{" "}
          <span className="font-medium tabular-nums">
            {data.healthPercentage}%
          </span>
          {data.license && (
            <span className="text-muted-foreground"> · {data.license}</span>
          )}
        </p>
        <ul className="space-y-0.5">
          <Check ok={data.hasReadme} label={t("communityCard.readme")} />
          <Check ok={data.hasLicense} label={t("communityCard.license")} />
          <Check
            ok={data.hasCodeOfConduct}
            label={t("communityCard.codeOfConduct")}
          />
          <Check
            ok={data.hasContributing}
            label={t("communityCard.contributingGuide")}
          />
          <Check
            ok={data.hasIssueTemplate}
            label={t("communityCard.issueTemplates")}
          />
          <Check
            ok={data.hasPullRequestTemplate}
            label={t("communityCard.pullRequestTemplate")}
          />
        </ul>
      </div>
    </div>
  );
}
