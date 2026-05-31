import { SafetyCertificateOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Input, Popconfirm, Select, Space, Tag, Typography, message } from "antd";
import { useState } from "react";
import type { AgentTask, ExecutionPlan } from "../domain/types";
import { isTauriRuntime } from "../desktop/commands";
import { executeRestrictedShell } from "../desktop/runtimeClient";
import { useI18n } from "../i18n";
import { shouldRequireApproval } from "../runtime/security";

type Props = {
  plan?: ExecutionPlan;
  task?: AgentTask;
};

export function SecurityPanel({ plan, task }: Props) {
  const { language, t } = useI18n();
  const permissions = plan?.requiredPermissions ?? [];
  const needsApproval = shouldRequireApproval(permissions);
  const [workspace, setWorkspace] = useState(task?.workspace ?? "");
  const [executable, setExecutable] = useState("pwd");
  const [args, setArgs] = useState("");
  const [shellOutput, setShellOutput] = useState("");
  const [running, setRunning] = useState(false);
  const executeShell = async () => {
    if (!isTauriRuntime()) {
      message.info(language === "zh" ? "受限执行器仅在桌面版可用。" : "Restricted execution is desktop-only.");
      return;
    }
    setRunning(true);
    try {
      const result = await executeRestrictedShell({
        workspace,
        executable,
        args: args.split(/\s+/).filter(Boolean),
        approved: true,
      });
      setShellOutput([result.stdout, result.stderr].filter(Boolean).join("\n"));
      message.success(result.ok ? "命令执行完成。" : "命令已运行，但返回非零状态。");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "命令执行失败。");
    } finally {
      setRunning(false);
    }
  };

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
            ? "当前版本已实现风险分级、人工审批和本地受限执行器。Docker/Podman 容器探测仍在下一阶段接入。"
            : "This build implements risk grading, human approval, and restricted local execution. Docker/Podman detection remains next-stage work."
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
      <div className="restricted-shell">
        <Typography.Text strong>
          {language === "zh" ? "受限 Shell 执行器" : "Restricted Shell Executor"}
        </Typography.Text>
        <Space wrap style={{ marginTop: 10 }}>
          <Input
            value={workspace}
            onChange={(event) => setWorkspace(event.target.value)}
            placeholder={language === "zh" ? "本机工作区文件夹路径" : "Local workspace directory"}
            style={{ width: 320 }}
          />
          <Select
            value={executable}
            onChange={setExecutable}
            style={{ width: 110 }}
            options={["pwd", "ls", "rg", "git", "npm", "npx", "node", "cargo", "rustc"].map(
              (value) => ({ label: value, value }),
            )}
          />
          <Input
            value={args}
            onChange={(event) => setArgs(event.target.value)}
            placeholder={language === "zh" ? "参数，例如 status --short" : "Arguments, e.g. status --short"}
            style={{ width: 260 }}
          />
          <Popconfirm
            title={language === "zh" ? "审批并执行本机命令？" : "Approve local command execution?"}
            description={`${executable} ${args}`.trim()}
            onConfirm={executeShell}
          >
            <Button type="primary" loading={running}>
              {language === "zh" ? "审批并运行" : "Approve & Run"}
            </Button>
          </Popconfirm>
        </Space>
        {shellOutput ? <pre className="shell-output">{shellOutput}</pre> : null}
      </div>
    </Card>
  );
}
