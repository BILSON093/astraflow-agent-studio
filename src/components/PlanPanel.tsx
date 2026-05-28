import {
  CheckCircleOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Empty, Space, Tag, Typography } from "antd";
import type { AgentTask, ExecutionPlan, RiskLevel } from "../domain/types";
import { useI18n } from "../i18n";
import { useAgentStore } from "../store/useAgentStore";

type Props = {
  task?: AgentTask;
  plan?: ExecutionPlan;
};

const riskColor: Record<RiskLevel, string> = {
  low: "green",
  medium: "gold",
  high: "volcano",
};

export function PlanPanel({ task, plan }: Props) {
  const {
    formatModelPolicy,
    formatRisk,
    formatStepStatus,
    formatTaskStatus,
    language,
    t,
  } = useI18n();
  const approvePlan = useAgentStore((state) => state.approvePlan);
  const pauseTask = useAgentStore((state) => state.pauseTask);
  const resumeTask = useAgentStore((state) => state.resumeTask);
  const cancelTask = useAgentStore((state) => state.cancelTask);

  if (!task || !plan) {
    return (
      <Card className="panel" title={t("taskPlan")}>
        <Empty description={t("noPlan")} />
      </Card>
    );
  }

  const requiresApproval = plan.requiredPermissions.some((permission) => permission.riskLevel === "high");

  return (
    <Card
      className="panel"
      title={t("taskPlanTitle")}
      extra={<Tag color={riskColor[task.riskLevel]}>{formatRisk(task.riskLevel)}</Tag>}
    >
      {requiresApproval ? (
        <Alert
          showIcon
          type="warning"
          message={language === "zh" ? "检测到高风险权限" : "High-risk permissions detected"}
          description={
            language === "zh"
              ? "Shell、密钥或推送类能力必须经过人工审批。审批前 Agent 只会停留在计划态。"
              : "Shell, secret, and push capabilities require human approval. The Agent stays in planning mode before approval."
          }
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <Descriptions size="small" column={2} bordered>
        <Descriptions.Item label={t("status")}>{formatTaskStatus(task.status)}</Descriptions.Item>
        <Descriptions.Item label={t("modelPolicy")}>
          {formatModelPolicy(plan.estimatedTokenPlan.modelPolicy)}
        </Descriptions.Item>
        <Descriptions.Item label={language === "zh" ? "预计 Token" : "Estimated Token"}>
          {plan.estimatedTokenPlan.maxTokens.toLocaleString()}
        </Descriptions.Item>
        <Descriptions.Item label={language === "zh" ? "预计成本" : "Estimated Cost"}>
          ${plan.estimatedTokenPlan.estimatedCostUsd.toFixed(4)}
        </Descriptions.Item>
      </Descriptions>

      {plan.codingPlan ? (
        <Alert
          type="info"
          style={{ marginTop: 12 }}
          message="Coding Plan"
          description={`${plan.codingPlan.strategy} 验证：${plan.codingPlan.verification.join(" / ")}`}
        />
      ) : null}

      <div className="plan-step-list" style={{ marginTop: 12 }}>
        {plan.steps.map((step) => (
          <div className="plan-step-row" key={step.id}>
            <div className="plan-step-main">
              <div className="plan-step-title">
                <Space wrap>
                  <Typography.Text strong>{step.title}</Typography.Text>
                  <Tag color={riskColor[step.riskLevel]}>{formatRisk(step.riskLevel)}</Tag>
                  <Tag>
                    {step.estimatedTokens.toLocaleString()} {t("token")}
                  </Tag>
                </Space>
              </div>
              <Typography.Paragraph ellipsis={{ rows: 2 }} className="plan-step-description">
                {step.description}
              </Typography.Paragraph>
            </div>
            <Tag color={step.status === "done" ? "green" : "default"}>
              {formatStepStatus(step.status)}
            </Tag>
          </div>
        ))}
      </div>

      <Space wrap>
        <Button
          type="primary"
          icon={<CheckCircleOutlined />}
          disabled={task.status === "done"}
          onClick={() => approvePlan(task.id)}
        >
          {t("approvalRun")}
        </Button>
        <Button icon={<PauseCircleOutlined />} onClick={() => pauseTask(task.id)}>
          {language === "zh" ? "暂停" : "Pause"}
        </Button>
        <Button icon={<PlayCircleOutlined />} onClick={() => resumeTask(task.id)}>
          {language === "zh" ? "继续" : "Resume"}
        </Button>
        <Button danger icon={<StopOutlined />} onClick={() => cancelTask(task.id)}>
          {language === "zh" ? "取消" : "Cancel"}
        </Button>
      </Space>
    </Card>
  );
}
