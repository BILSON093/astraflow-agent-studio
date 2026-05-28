import { FileSearchOutlined } from "@ant-design/icons";
import { Card, Empty, Progress, Space, Tag, Typography } from "antd";
import type { ContextReport } from "../domain/types";
import { useI18n } from "../i18n";

type Props = {
  report?: ContextReport;
};

function renderSection(
  section: ContextReport["included"][number],
  tokenLabel: string,
  dropped = false,
) {
  return (
    <div className={`context-section ${dropped ? "dropped" : ""}`} key={section.id}>
      <Space align="start" orientation="vertical" size={4}>
        <Space wrap>
          <Typography.Text strong>{section.title}</Typography.Text>
          <Tag>{section.source}</Tag>
          <Tag color={dropped ? "default" : "green"}>
            {section.tokens} {tokenLabel}
          </Tag>
        </Space>
        <Typography.Paragraph ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>
          {section.content}
        </Typography.Paragraph>
      </Space>
    </div>
  );
}

export function ContextInspector({ report }: Props) {
  const { t } = useI18n();

  if (!report) {
    return (
      <Card className="panel" title={t("contextInspector")}>
        <Empty description={t("noContextReport")} />
      </Card>
    );
  }

  const percent = Math.round((report.totalTokens / report.maxTokens) * 100);

  return (
    <Card
      className="panel"
      title={t("contextInspector")}
      extra={
        <Space size={6}>
          <FileSearchOutlined />
          <Typography.Text type="secondary">
            {report.totalTokens.toLocaleString()} / {report.maxTokens.toLocaleString()}
          </Typography.Text>
        </Space>
      }
    >
      <Progress percent={percent} status={percent > 90 ? "exception" : "active"} />
      <Typography.Title level={5}>{t("contextIncluded")}</Typography.Title>
      <div className="context-list">
        {report.included.map((section) => renderSection(section, t("token")))}
      </div>
      {report.dropped.length > 0 && (
        <>
          <Typography.Title level={5}>{t("contextDropped")}</Typography.Title>
          <div className="context-list">
            {report.dropped.map((section) => renderSection(section, t("token"), true))}
          </div>
        </>
      )}
    </Card>
  );
}
