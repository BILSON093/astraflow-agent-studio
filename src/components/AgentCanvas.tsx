import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  PlayCircleOutlined,
  RedoOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { Background, Controls, MarkerType, ReactFlow } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import { Button, Card, Empty, message, Space, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import type { AgentTask, ExecutionPlan, PlanStep, RiskLevel } from "../domain/types";
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
  const updatePlanStepStatus = useAgentStore((state) => state.updatePlanStepStatus);
  const [selectedStepId, setSelectedStepId] = useState<string>();
  const selectedStep = useMemo<PlanStep | undefined>(() => {
    if (!plan) {
      return undefined;
    }

    return plan.steps.find((step) => step.id === selectedStepId) ?? plan.steps[0];
  }, [plan, selectedStepId]);
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
          <div
            className={`flow-node ${step.riskLevel} ${
              selectedStep?.id === step.id ? "selected" : ""
            }`}
          >
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
  }, [formatRisk, formatStepStatus, language, plan, selectedStep?.id]);

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

  const setStepStatus = (status: PlanStep["status"]) => {
    if (!task || !selectedStep) {
      return;
    }

    updatePlanStepStatus(task.id, selectedStep.id, status);
  };

  const copyStepInput = async () => {
    if (!selectedStep) {
      return;
    }

    await navigator.clipboard.writeText(selectedStep.inputPreview);
    message.success(language === "zh" ? "已复制节点输入。" : "Node input copied.");
  };

  return (
    <Card
      className="panel"
      title={t("agentCanvas")}
      extra={
        <Space size={6}>
          <SafetyCertificateOutlined />
          <Typography.Text type="secondary">{task?.title ?? t("noTask")}</Typography.Text>
        </Space>
      }
    >
      {plan ? (
        <div className="interactive-canvas">
          <div className="canvas-frame">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              fitView
              minZoom={0.55}
              maxZoom={1.25}
              nodesDraggable
              nodesConnectable={false}
              onNodeClick={(_, node) => setSelectedStepId(node.id)}
            >
              <Background color="#d7e1e4" gap={18} />
              <Controls />
            </ReactFlow>
          </div>
          <div className="canvas-inspector">
            <div className="canvas-inspector-head">
              <div>
                <Typography.Text strong>
                  {selectedStep?.title ?? (language === "zh" ? "选择节点" : "Select a node")}
                </Typography.Text>
                <div className="flow-node-meta">
                  {selectedStep
                    ? `${formatStepStatus(selectedStep.status)} / ${formatRisk(selectedStep.riskLevel)}`
                    : language === "zh"
                      ? "点击画布节点查看详情"
                      : "Click a graph node to inspect it"}
                </div>
              </div>
              {selectedStep ? <Tag>{selectedStep.type}</Tag> : null}
            </div>
            {selectedStep ? (
              <>
                <Typography.Paragraph className="canvas-step-description">
                  {selectedStep.description}
                </Typography.Paragraph>
                <div className="canvas-step-grid">
                  <div>
                    <span>{language === "zh" ? "预计 Token" : "Est. tokens"}</span>
                    <strong>{selectedStep.estimatedTokens.toLocaleString()}</strong>
                  </div>
                  <div>
                    <span>{language === "zh" ? "工具" : "Tool"}</span>
                    <strong>{selectedStep.tool ?? selectedStep.model ?? "-"}</strong>
                  </div>
                </div>
                <div className="canvas-preview-block">
                  <Typography.Text type="secondary">
                    {language === "zh" ? "输入预览" : "Input Preview"}
                  </Typography.Text>
                  <Typography.Paragraph ellipsis={{ rows: 3 }}>
                    {selectedStep.inputPreview}
                  </Typography.Paragraph>
                </div>
                <div className="canvas-preview-block">
                  <Typography.Text type="secondary">
                    {language === "zh" ? "输出预览" : "Output Preview"}
                  </Typography.Text>
                  <Typography.Paragraph ellipsis={{ rows: 3 }}>
                    {selectedStep.outputPreview ??
                      (language === "zh" ? "等待执行结果。" : "Waiting for execution output.")}
                  </Typography.Paragraph>
                </div>
                <Space wrap>
                  <Button icon={<PlayCircleOutlined />} onClick={() => setStepStatus("running")}>
                    {language === "zh" ? "运行此步" : "Run"}
                  </Button>
                  <Button icon={<CheckCircleOutlined />} onClick={() => setStepStatus("done")}>
                    {language === "zh" ? "完成" : "Complete"}
                  </Button>
                  <Button icon={<RedoOutlined />} onClick={() => setStepStatus("running")}>
                    {language === "zh" ? "重试" : "Retry"}
                  </Button>
                  <Button
                    icon={<SafetyCertificateOutlined />}
                    onClick={() => setStepStatus("needs_approval")}
                  >
                    {language === "zh" ? "请求审批" : "Approval"}
                  </Button>
                  <Button danger icon={<CloseCircleOutlined />} onClick={() => setStepStatus("failed")}>
                    {language === "zh" ? "标记失败" : "Fail"}
                  </Button>
                  <Button icon={<CopyOutlined />} onClick={copyStepInput}>
                    {language === "zh" ? "复制输入" : "Copy Input"}
                  </Button>
                </Space>
              </>
            ) : (
              <Empty description={language === "zh" ? "选择节点后显示操作" : "Select a node"} />
            )}
          </div>
        </div>
      ) : (
        <Empty description={t("noTaskCanvas")} />
      )}
    </Card>
  );
}
