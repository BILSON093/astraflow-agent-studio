import { SafetyCertificateOutlined } from "@ant-design/icons";
import { Alert, Card, Space, Tag, Typography } from "antd";
import type { ExecutionPlan } from "../domain/types";
import { useI18n } from "../i18n";
import { shouldRequireApproval } from "../runtime/security";

type Props = {
  plan?: ExecutionPlan;
};

export function SecurityPanel({ plan }: Props) {
  const { language, t } = useI18n();
  const permissions = plan?.requiredPermissions ?? [];
  const needsApproval = shouldRequireApproval(permissions);

  return (
    <Card
      className="panel"
      title={t("securityTitle")}
      extra={
        <Space size={6}>
          <SafetyCertificateOutlined />
          <Typography.Text type="secondary">{t("localFirstPolicy")}</Typography.Text>
        </Space>
      }
    >
      <Alert
        type={needsApproval ? "warning" : "success"}
        showIcon
        message={
          needsApproval
            ? language === "zh"
              ? "存在需要人工审批的权限"
              : "Permissions require human approval"
            : language === "zh"
              ? "当前任务可自动执行低风险步骤"
              : "Low-risk steps can run automatically"
        }
        description={
          language === "zh"
            ? "当前版本已实现风险分级和人工审批；Docker/Podman 沙箱探测、受限执行器和真实命令运行将在下一阶段接入。"
            : "This build implements risk grading and human approval. Docker/Podman detection, restricted execution, and real command runs are next-stage work."
        }
      />
      <div className="security-band" style={{ marginTop: 12 }}>
        <div className="security-item">
          <Typography.Text strong>Level 0</Typography.Text>
          <div className="muted">
            {language === "zh" ? "只读搜索、总结、上下文组装" : "Read-only search, summary, context compile"}
          </div>
        </div>
        <div className="security-item">
          <Typography.Text strong>Level 1-2</Typography.Text>
          <div className="muted">
            {language === "zh" ? "写文件、外部 API、MCP 调用" : "File writes, external APIs, MCP calls"}
          </div>
        </div>
        <div className="security-item">
          <Typography.Text strong>Level 3-4</Typography.Text>
          <div className="muted">
            {language === "zh" ? "Shell、密钥、部署、Git push" : "Shell, secrets, deploys, Git push"}
          </div>
        </div>
      </div>
      <Space wrap style={{ marginTop: 12 }}>
        {permissions.map((permission) => (
          <Tag key={permission.id} color={permission.riskLevel === "high" ? "volcano" : "default"}>
            {permission.label}
          </Tag>
        ))}
      </Space>
    </Card>
  );
}
