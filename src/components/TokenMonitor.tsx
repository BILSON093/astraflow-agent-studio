import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { Card, Col, Progress, Row, Statistic, Table, Tag } from "antd";
import type { TableColumnsType } from "antd";
import { useMemo } from "react";
import type { ProviderConfig, UsageEntry } from "../domain/types";
import { useI18n } from "../i18n";
import { aggregateUsage } from "../runtime/usage";

type Props = {
  entries: UsageEntry[];
  providers: ProviderConfig[];
};

type ProviderRow = {
  key: string;
  provider: string;
  tokens: number;
  cachedTokens: number;
  cacheHitRate: number;
  cacheCost: number;
  cost: number;
};

export function TokenMonitor({ entries, providers }: Props) {
  const { language, t } = useI18n();
  const report = useMemo(() => aggregateUsage(entries, providers), [entries, providers]);
  const providerRows = report.byProvider.map((item) => ({
    key: item.providerId,
    provider: item.name,
    tokens: item.tokens,
    cachedTokens: item.cachedTokens,
    cacheHitRate: item.cacheHitRate,
    cacheCost: item.cacheCost,
    cost: item.cost,
  }));
  const weeklyBudget = 10;
  const budgetPercent = Math.min(100, Math.round((report.weekCost / weeklyBudget) * 100));

  const chartOption: EChartsOption = {
    tooltip: { trigger: "axis" },
    grid: { top: 24, left: 34, right: 10, bottom: 34 },
    xAxis: {
      type: "category",
      data: report.byModel.map((item) => item.model),
      axisLabel: { color: "#667982" },
    },
    yAxis: { type: "value", axisLabel: { color: "#667982" } },
    series: [
      {
        type: "bar",
        name: t("token"),
        data: report.byModel.map((item) => item.tokens),
        itemStyle: { color: "#0d9488", borderRadius: [4, 4, 0, 0] },
      },
      {
        type: "bar",
        name: language === "zh" ? "缓存 Token" : "Cached Tokens",
        data: report.byModel.map((item) => item.cachedTokens),
        itemStyle: { color: "#7c3aed", borderRadius: [4, 4, 0, 0] },
      },
      {
        type: "line",
        name: t("weekCost"),
        data: report.byModel.map((item) => item.cost),
        yAxisIndex: 0,
        itemStyle: { color: "#d9480f" },
      },
    ],
  };

  const columns: TableColumnsType<ProviderRow> = [
    {
      title: t("provider"),
      dataIndex: "provider",
      key: "provider",
    },
    {
      title: t("token"),
      dataIndex: "tokens",
      key: "tokens",
      render: (value: number) => value.toLocaleString(),
    },
    {
      title: language === "zh" ? "缓存 Token" : "Cached Tokens",
      dataIndex: "cachedTokens",
      key: "cachedTokens",
      render: (value: number) => value.toLocaleString(),
    },
    {
      title: language === "zh" ? "缓存命中率" : "Cache Hit Rate",
      dataIndex: "cacheHitRate",
      key: "cacheHitRate",
      render: (value: number) => <Tag color={value >= 60 ? "green" : "gold"}>{value}%</Tag>,
    },
    {
      title: language === "zh" ? "缓存成本" : "Cache Cost",
      dataIndex: "cacheCost",
      key: "cacheCost",
      render: (value: number) => <Tag color="purple">${value.toFixed(4)}</Tag>,
    },
    {
      title: t("weekCost"),
      dataIndex: "cost",
      key: "cost",
      render: (value: number) => <Tag color="cyan">${value.toFixed(4)}</Tag>,
    },
  ];

  return (
    <Card className="panel" title={t("tokenMonitor")}>
      <Row gutter={[12, 12]}>
        <Col xs={24} md={6}>
          <Statistic title={t("todayCost")} value={report.todayCost} prefix="$" precision={4} />
        </Col>
        <Col xs={24} md={6}>
          <Statistic title={t("weekToken")} value={report.weekTokens} />
        </Col>
        <Col xs={24} md={6}>
          <Statistic
            title={language === "zh" ? "缓存命中率" : "Cache Hit Rate"}
            value={report.cacheHitRate}
            suffix="%"
          />
        </Col>
        <Col xs={24} md={6}>
          <Statistic title={t("weekCost")} value={report.weekCost} prefix="$" precision={4} />
        </Col>
      </Row>
      <Row gutter={[12, 12]} style={{ marginTop: 8 }}>
        <Col xs={24} md={12}>
          <Statistic
            title={language === "zh" ? "缓存 Token" : "Cached Tokens"}
            value={report.cachedTokens}
          />
        </Col>
        <Col xs={24} md={12}>
          <Statistic
            title={language === "zh" ? "缓存单独成本" : "Cache Cost"}
            value={report.weekCacheCost}
            prefix="$"
            precision={4}
          />
        </Col>
      </Row>
      <Progress
        percent={budgetPercent}
        status={budgetPercent > 80 ? "exception" : "active"}
        style={{ marginTop: 12 }}
      />
      <div className="token-chart">
        <ReactECharts option={chartOption} style={{ height: 260 }} />
      </div>
      <Table columns={columns} dataSource={providerRows} size="small" pagination={false} />
    </Card>
  );
}
