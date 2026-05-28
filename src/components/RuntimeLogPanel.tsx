import { FieldTimeOutlined } from "@ant-design/icons";
import { Card, Empty, Space, Tag, Typography } from "antd";
import dayjs from "dayjs";
import type { RuntimeLog } from "../domain/types";
import { useI18n } from "../i18n";

type Props = {
  logs: RuntimeLog[];
};

const logColor: Record<RuntimeLog["level"], string> = {
  info: "blue",
  warning: "gold",
  error: "volcano",
  security: "purple",
};

export function RuntimeLogPanel({ logs }: Props) {
  const { formatLogLevel, t } = useI18n();

  return (
    <Card
      className="panel"
      title={t("runtimeLog")}
      extra={
        <Space size={6}>
          <FieldTimeOutlined />
          <Typography.Text type="secondary">
            {logs.length} {t("events")}
          </Typography.Text>
        </Space>
      }
    >
      {logs.length ? (
        <div className="runtime-log">
          {logs.map((log) => (
            <div className="log-row" key={log.id}>
              <Typography.Text type="secondary">{dayjs(log.createdAt).format("HH:mm:ss")}</Typography.Text>
              <Space orientation="vertical" size={2}>
                <Tag color={logColor[log.level]}>{formatLogLevel(log.level)}</Tag>
                <Typography.Text>{log.message}</Typography.Text>
              </Space>
            </div>
          ))}
        </div>
      ) : (
        <Empty description="暂无运行日志" />
      )}
    </Card>
  );
}
