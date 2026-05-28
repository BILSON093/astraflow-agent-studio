import { ApiOutlined, AppstoreAddOutlined, ToolOutlined } from "@ant-design/icons";
import { Button, Card, Input, Modal, Space, Switch, Table, Tabs, Tag, Typography } from "antd";
import type { TableColumnsType } from "antd";
import { useState } from "react";
import type { McpServerManifest, SkillManifest } from "../domain/types";
import { useI18n } from "../i18n";
import { permissions, useAgentStore } from "../store/useAgentStore";

type InstallTarget = "skill" | "mcp";

function slugify(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 36);

  return slug || fallback;
}

function inferSkillManifest(prompt: string): SkillManifest {
  const normalized = prompt.toLowerCase();
  const name = normalized.includes("github") || normalized.includes("pr")
    ? "github-pr-review"
    : normalized.includes("pdf") || prompt.includes("文档")
      ? "document-reader"
      : normalized.includes("report") || prompt.includes("周报")
        ? "report-writer"
        : normalized.includes("browser") || prompt.includes("浏览器")
          ? "browser-workflow"
          : slugify(prompt, "custom-workflow-skill");
  const skillPermissions = [permissions["fs.read"]];

  if (/写|改|生成|保存|write|edit|create/i.test(prompt)) {
    skillPermissions.push(permissions["fs.write"]);
  }

  if (/api|github|浏览器|browser|联网|http/i.test(prompt)) {
    skillPermissions.push(permissions["network.http"]);
  }

  return {
    name,
    version: "0.1.0",
    description: prompt,
    entry: "SKILL.md",
    permissions: Array.from(new Map(skillPermissions.map((permission) => [permission.id, permission])).values()),
    scripts: normalized.includes("github")
      ? { inspect: "node scripts/inspect-github-pr.js" }
      : undefined,
    enabled: true,
  };
}

function inferMcpManifest(prompt: string): McpServerManifest {
  const normalized = prompt.toLowerCase();

  if (normalized.includes("github") || normalized.includes("pr")) {
    return {
      name: "github-mcp",
      transport: "stdio",
      command: "npx -y @modelcontextprotocol/server-github",
      permissions: [permissions["network.http"]],
      enabled: true,
      health: "degraded",
    };
  }

  if (normalized.includes("browser") || prompt.includes("浏览器") || prompt.includes("网页")) {
    return {
      name: "browser-automation",
      transport: "http",
      url: "http://127.0.0.1:7331/mcp",
      permissions: [permissions["network.http"]],
      enabled: true,
      health: "offline",
    };
  }

  if (normalized.includes("postgres") || normalized.includes("mysql") || prompt.includes("数据库")) {
    return {
      name: "database-mcp",
      transport: "stdio",
      command: "npx -y @modelcontextprotocol/server-postgres",
      envSchema: {
        DATABASE_URL: "数据库连接字符串",
      },
      permissions: [permissions["network.http"], permissions["secret.read"]],
      enabled: false,
      health: "offline",
    };
  }

  if (normalized.includes("file") || prompt.includes("文件")) {
    return {
      name: "filesystem-safe",
      transport: "stdio",
      command: "npx -y @modelcontextprotocol/server-filesystem",
      permissions: [permissions["fs.read"], permissions["fs.write"]],
      enabled: true,
      health: "healthy",
    };
  }

  return {
    name: slugify(prompt, "custom-mcp-server"),
    transport: "stdio",
    command: `npx -y ${slugify(prompt, "custom-mcp-server")}`,
    permissions: [permissions["fs.read"], permissions["network.http"]],
    enabled: false,
    health: "offline",
  };
}

export function McpSkillCenter() {
  const { formatHealth, formatRisk, language, t } = useI18n();
  const skills = useAgentStore((state) => state.skills);
  const mcpServers = useAgentStore((state) => state.mcpServers);
  const enableSkill = useAgentStore((state) => state.enableSkill);
  const installSkill = useAgentStore((state) => state.installSkill);
  const enableMcp = useAgentStore((state) => state.enableMcp);
  const installMcp = useAgentStore((state) => state.installMcp);
  const [installTarget, setInstallTarget] = useState<InstallTarget>("skill");
  const [installOpen, setInstallOpen] = useState(false);
  const [installPrompt, setInstallPrompt] = useState("");

  const openInstaller = (target: InstallTarget) => {
    setInstallTarget(target);
    setInstallPrompt(
      target === "skill"
        ? language === "zh"
          ? "安装一个 GitHub PR 评审 Skill，能读取 diff、总结风险并生成修改建议"
          : "Install a GitHub PR review Skill that reads diffs, summarizes risk, and suggests fixes"
        : language === "zh"
          ? "安装 GitHub MCP，用来读取 issue、PR 和仓库信息"
          : "Install GitHub MCP for issues, pull requests, and repository context",
    );
    setInstallOpen(true);
  };

  const submitInstall = () => {
    const prompt = installPrompt.trim();

    if (!prompt) {
      return;
    }

    if (installTarget === "skill") {
      installSkill(inferSkillManifest(prompt));
    } else {
      installMcp(inferMcpManifest(prompt));
    }

    setInstallOpen(false);
  };

  const skillColumns: TableColumnsType<SkillManifest> = [
    {
      title: "Skill",
      key: "skill",
      render: (_, skill) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{skill.name}</Typography.Text>
          <Typography.Text type="secondary">{skill.description}</Typography.Text>
        </Space>
      ),
    },
    {
      title: t("version"),
      dataIndex: "version",
      key: "version",
    },
    {
      title: t("permissions"),
      key: "permissions",
      render: (_, skill) => (
        <Space size={4} wrap>
          {skill.permissions.map((permission) => (
            <Tag key={permission.id} color={permission.riskLevel === "high" ? "volcano" : "default"}>
              {permission.id} · {formatRisk(permission.riskLevel)}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: t("enabled"),
      key: "enabled",
      render: (_, skill) => (
        <Switch
          checked={Boolean(skill.enabled)}
          onChange={(enabled) => enableSkill(skill.name, enabled)}
        />
      ),
    },
  ];

  const mcpColumns: TableColumnsType<McpServerManifest> = [
    {
      title: "Server",
      key: "server",
      render: (_, server) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{server.name}</Typography.Text>
          <Typography.Text type="secondary">
            {server.command ?? server.url}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t("transport"),
      dataIndex: "transport",
      key: "transport",
      render: (transport: McpServerManifest["transport"]) => <Tag color="blue">{transport}</Tag>,
    },
    {
      title: t("health"),
      dataIndex: "health",
      key: "health",
      render: (health: McpServerManifest["health"]) => {
        const color = health === "healthy" ? "green" : health === "degraded" ? "gold" : "default";
        return <Tag color={color}>{formatHealth(health)}</Tag>;
      },
    },
    {
      title: t("enabled"),
      key: "enabled",
      render: (_, server) => (
        <Switch
          checked={Boolean(server.enabled)}
          onChange={(enabled) => enableMcp(server.name, enabled)}
        />
      ),
    },
  ];

  return (
    <Card
      className="panel"
      title={language === "zh" ? "MCP / Skill 中心" : "MCP Center / Skill Store"}
      extra={
        <Space>
          <Button
            icon={<AppstoreAddOutlined />}
            onClick={() => openInstaller("skill")}
          >
            {t("addSkill")}
          </Button>
          <Button
            icon={<ApiOutlined />}
            onClick={() => openInstaller("mcp")}
          >
            {t("addMcp")}
          </Button>
        </Space>
      }
    >
      <Tabs
        items={[
          {
            key: "skills",
            label: (
              <Space>
                <ToolOutlined />
                Skills
              </Space>
            ),
            children: (
              <Table
                rowKey="name"
                columns={skillColumns}
                dataSource={skills}
                pagination={false}
                scroll={{ x: 780 }}
              />
            ),
          },
          {
            key: "mcp",
            label: (
              <Space>
                <ApiOutlined />
                MCP Servers
              </Space>
            ),
            children: (
              <Table
                rowKey="name"
                columns={mcpColumns}
                dataSource={mcpServers}
                pagination={false}
                scroll={{ x: 760 }}
              />
            ),
          },
        ]}
      />
      <Modal
        title={
          installTarget === "skill"
            ? language === "zh"
              ? "一句话安装 Skill"
              : "Install Skill from one sentence"
            : language === "zh"
              ? "一句话安装 MCP"
              : "Install MCP from one sentence"
        }
        open={installOpen}
        onCancel={() => setInstallOpen(false)}
        onOk={submitInstall}
        okText={language === "zh" ? "生成并安装" : "Generate & Install"}
        cancelText={language === "zh" ? "取消" : "Cancel"}
      >
        <Input.TextArea
          autoSize={{ minRows: 4, maxRows: 8 }}
          value={installPrompt}
          onChange={(event) => setInstallPrompt(event.target.value)}
          placeholder={
            language === "zh"
              ? "例如：安装一个能读取 PDF、提取表格并生成摘要的 Skill"
              : "Example: Install a Skill that reads PDFs, extracts tables, and creates summaries"
          }
        />
        <Space wrap style={{ marginTop: 12 }}>
          {(installTarget === "skill"
            ? [
                language === "zh"
                  ? "安装 GitHub PR 评审 Skill"
                  : "Install GitHub PR review Skill",
                language === "zh"
                  ? "安装 PDF 文档总结 Skill"
                  : "Install PDF summary Skill",
                language === "zh"
                  ? "安装自动周报 Skill"
                  : "Install weekly report Skill",
              ]
            : [
                language === "zh" ? "安装 GitHub MCP" : "Install GitHub MCP",
                language === "zh" ? "安装浏览器自动化 MCP" : "Install browser automation MCP",
                language === "zh" ? "安装数据库 MCP" : "Install database MCP",
              ]
          ).map((example) => (
            <Button size="small" key={example} onClick={() => setInstallPrompt(example)}>
              {example}
            </Button>
          ))}
        </Space>
      </Modal>
    </Card>
  );
}
