import { BranchesOutlined } from "@ant-design/icons";
import { Background, Controls, MarkerType, ReactFlow } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import { Card, Empty, Space, Tag, Typography } from "antd";
import { useMemo } from "react";
import type { AgentTask, ExecutionPlan, RiskLevel } from "../domain/types";
import { useI18n } from "../i18n";

type Props = {
  task?: AgentTask;
  plan?: ExecutionPlan;
};

const riskColor: Record<RiskLevel, string> = {
  low: "green",
  medium: "gold",
  high: "volcano",
};

function statusColor(status: string): string {
  if (status === "done") {
    return "green";
  }

  if (status === "needs_approval") {
    return "volcano";
  }

  if (status === "running") {
    return "blue";
  }

  return "default";
}

export function AgentCanvas({ task, plan }: Props) {
  const { formatRisk, formatStepStatus, language, t } = useI18n();
  const nodes = useMemo<Node[]>(() => {
    if (!plan) {
      return [];
    }

    const stepTypeLabels: Record<ExecutionPlan["steps"][number]["type"], string> =
      language === "zh"
        ? {
            planner: "规划器",
            memory: "记忆",
            context: "上下文",
            mcp: "MCP 工具",
            skill: "Skill",
            model: "模型调用",
            approval: "审批",
            result: "结果",
          }
        : {
            planner: "PLANNER",
            memory: "MEMORY",
            context: "CONTEXT",
            mcp: "MCP TOOL",
            skill: "SKILL",
            model: "MODEL CALL",
            approval: "APPROVAL",
            result: "RESULT",
          };

    return plan.steps.map((step, index) => ({
      id: step.id,
      position: {
        x: (index % 3) * 260,
        y: Math.floor(index / 3) * 170,
      },
      data: {
        label: (
          <div className={`flow-node ${step.riskLevel}`}>
            <div className="flow-node-title">{step.title}</div>
            <div className="flow-node-meta">{stepTypeLabels[step.type]}</div>
            <Space size={4} wrap>
              <Tag color={riskColor[step.riskLevel]}>{formatRisk(step.riskLevel)}</Tag>
              <Tag color={statusColor(step.status)}>{formatStepStatus(step.status)}</Tag>
            </Space>
          </div>
        ),
      },
      style: {
        background: "transparent",
        border: 0,
        padding: 0,
      },
    }));
  }, [formatRisk, formatStepStatus, language, plan]);

  const edges = useMemo<Edge[]>(() => {
    if (!plan) {
      return [];
    }

    return plan.steps.slice(0, -1).map((step, index) => ({
      id: `${step.id}-${plan.steps[index + 1].id}`,
      source: step.id,
      target: plan.steps[index + 1].id,
      animated: task?.status === "running",
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "#6b7d85" },
    }));
  }, [plan, task?.status]);

  return (
    <Card
      className="panel"
      title={t("agentCanvas")}
      extra={
        <Space size={6}>
          <BranchesOutlined />
          <Typography.Text type="secondary">{task?.title ?? t("noTask")}</Typography.Text>
        </Space>
      }
    >
      {plan ? (
        <div className="canvas-frame">
          <ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.55} maxZoom={1.25}>
            <Background color="#d7e1e4" gap={18} />
            <Controls />
          </ReactFlow>
        </div>
      ) : (
        <Empty description={t("noTaskCanvas")} />
      )}
    </Card>
  );
}
