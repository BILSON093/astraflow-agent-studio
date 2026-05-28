import { ApiOutlined, BranchesOutlined, DatabaseOutlined, DollarOutlined } from "@ant-design/icons";
import type { ProviderConfig, UsageEntry } from "../domain/types";
import { useI18n } from "../i18n";
import { aggregateUsage } from "../runtime/usage";

type Props = {
  taskCount: number;
  memoryCount: number;
  providers: ProviderConfig[];
  usageEntries: UsageEntry[];
};

export function StatusStrip({ taskCount, memoryCount, providers, usageEntries }: Props) {
  const { language, t } = useI18n();
  const usageReport = aggregateUsage(usageEntries, providers);
  const enabledProviders = providers.filter((provider) => provider.enabled).length;

  return (
    <div className="status-strip">
      <div className="status-tile">
        <div className="status-label">
          <BranchesOutlined /> {t("taskPlan")}
        </div>
        <div className="status-value">{taskCount}</div>
        <div className="status-note">{t("planFirstExecution")}</div>
      </div>
      <div className="status-tile">
        <div className="status-label">
          <DatabaseOutlined /> {language === "zh" ? "长期记忆" : "Long-term Memory"}
        </div>
        <div className="status-value">{memoryCount}</div>
        <div className="status-note">
          {language === "zh" ? "用户 / 项目 / 任务 / 流程" : "Profile / Project / Episodic"}
        </div>
      </div>
      <div className="status-tile">
        <div className="status-label">
          <ApiOutlined /> {language === "zh" ? "模型供应商" : "Model Providers"}
        </div>
        <div className="status-value">{enabledProviders}</div>
        <div className="status-note">{t("providerRoutingEnabled")}</div>
      </div>
      <div className="status-tile">
        <div className="status-label">
          <DollarOutlined /> {t("weekCost")}
        </div>
        <div className="status-value">${usageReport.weekCost.toFixed(4)}</div>
        <div className="status-note">
          {usageReport.weekTokens.toLocaleString()} {t("token")} ·{" "}
          {language === "zh" ? "缓存命中" : "cache hit"} {usageReport.cacheHitRate}%
        </div>
      </div>
    </div>
  );
}
