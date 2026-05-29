import {
  AppstoreOutlined,
  BranchesOutlined,
  CloudOutlined,
  CodeOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DollarOutlined,
  ExperimentOutlined,
  SafetyCertificateOutlined,
  TranslationOutlined,
} from "@ant-design/icons";
import {
  App as AntdApp,
  Button,
  Card,
  ConfigProvider,
  Empty,
  Layout,
  Menu,
  Skeleton,
  Space,
  Tag,
  Typography,
  theme,
} from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { lazy, Suspense, useMemo, useState } from "react";
import { StatusStrip } from "./components/StatusStrip";
import type { TaskStatus } from "./domain/types";
import { astraFlowCommands, isTauriRuntime } from "./desktop/commands";
import { I18nProvider, useI18n } from "./i18n";
import { useAgentStore } from "./store/useAgentStore";

type ViewKey = "overview" | "memory" | "mcp" | "providers" | "usage" | "security";

const AgentCanvas = lazy(() =>
  import("./components/AgentCanvas").then((module) => ({ default: module.AgentCanvas })),
);
const ContextInspector = lazy(() =>
  import("./components/ContextInspector").then((module) => ({
    default: module.ContextInspector,
  })),
);
const McpSkillCenter = lazy(() =>
  import("./components/McpSkillCenter").then((module) => ({ default: module.McpSkillCenter })),
);
const MemoryPanel = lazy(() =>
  import("./components/MemoryPanel").then((module) => ({ default: module.MemoryPanel })),
);
const PlanPanel = lazy(() =>
  import("./components/PlanPanel").then((module) => ({ default: module.PlanPanel })),
);
const ProviderHub = lazy(() =>
  import("./components/ProviderHub").then((module) => ({ default: module.ProviderHub })),
);
const RuntimeLogPanel = lazy(() =>
  import("./components/RuntimeLogPanel").then((module) => ({ default: module.RuntimeLogPanel })),
);
const SecurityPanel = lazy(() =>
  import("./components/SecurityPanel").then((module) => ({ default: module.SecurityPanel })),
);
const TaskComposer = lazy(() =>
  import("./components/TaskComposer").then((module) => ({ default: module.TaskComposer })),
);
const TokenMonitor = lazy(() =>
  import("./components/TokenMonitor").then((module) => ({ default: module.TokenMonitor })),
);

const statusColor: Record<TaskStatus, string> = {
  planned: "gold",
  running: "blue",
  paused: "orange",
  blocked: "volcano",
  done: "green",
  failed: "red",
};

function LoadingPanel() {
  return (
    <Card className="panel">
      <Skeleton active paragraph={{ rows: 6 }} title={false} />
    </Card>
  );
}

function AppContent() {
  const { formatRisk, formatTaskStatus, language, t, toggleLanguage } = useI18n();
  const [view, setView] = useState<ViewKey>("overview");
  const tasks = useAgentStore((state) => state.tasks);
  const plans = useAgentStore((state) => state.plans);
  const memories = useAgentStore((state) => state.memories);
  const providers = useAgentStore((state) => state.providers);
  const usageEntries = useAgentStore((state) => state.usageEntries);
  const logs = useAgentStore((state) => state.logs);
  const contextReports = useAgentStore((state) => state.contextReports);
  const activeTaskId = useAgentStore((state) => state.activeTaskId);
  const createTask = useAgentStore((state) => state.createTask);

  const activeTask = tasks.find((task) => task.id === activeTaskId) ?? tasks[0];
  const activePlan = activeTask ? plans[activeTask.id] : undefined;
  const contextReport = activeTask ? contextReports[activeTask.id] : undefined;
  const runtimeMode = isTauriRuntime() ? t("desktopRuntime") : t("webRuntime");

  const mainContent = useMemo(() => {
    if (view === "memory") {
      return <MemoryPanel />;
    }

    if (view === "mcp") {
      return <McpSkillCenter />;
    }

    if (view === "providers") {
      return <ProviderHub />;
    }

    if (view === "usage") {
      return <TokenMonitor entries={usageEntries} providers={providers} />;
    }

    if (view === "security") {
      return (
        <div className="stack">
          <SecurityPanel plan={activePlan} />
          <ContextInspector report={contextReport} />
        </div>
      );
    }

    return (
      <div className="dashboard-grid">
        <div className="stack">
          <TaskComposer />
          <AgentCanvas task={activeTask} plan={activePlan} />
          <PlanPanel task={activeTask} plan={activePlan} />
        </div>
        <div className="stack">
          <TokenMonitor entries={usageEntries} providers={providers} />
          <ContextInspector report={contextReport} />
          <RuntimeLogPanel logs={logs} />
        </div>
      </div>
    );
  }, [activePlan, activeTask, contextReport, logs, providers, usageEntries, view]);

  return (
    <Layout className="app-shell">
      <Layout.Sider className="app-sider" width={250}>
        <div className="brand">
          <div className="brand-mark">
            <ExperimentOutlined />
          </div>
          <div>
            <p className="brand-title">AstraFlow</p>
            <div className="brand-subtitle">星流智能体工作台</div>
          </div>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[view]}
          onSelect={(item) => setView(item.key as ViewKey)}
          items={[
            { key: "overview", icon: <DashboardOutlined />, label: t("dashboard") },
            { key: "memory", icon: <DatabaseOutlined />, label: t("memorySystem") },
            { key: "mcp", icon: <AppstoreOutlined />, label: "MCP / Skill" },
            { key: "providers", icon: <CloudOutlined />, label: t("modelAccess") },
            { key: "usage", icon: <DollarOutlined />, label: t("tokenMonitor") },
            { key: "security", icon: <SafetyCertificateOutlined />, label: t("security") },
          ]}
        />
      </Layout.Sider>
      <Layout.Content className="main-content">
        <div className="topbar">
          <div>
            <Typography.Title className="page-title" level={1}>
              AstraFlow Agent Studio
            </Typography.Title>
            <div className="page-subtitle">{t("pageSubtitle")}</div>
          </div>
          <Space wrap>
            <Tag color="cyan">{runtimeMode}</Tag>
            <Tag color="geekblue">
              {t("commandCount")} {astraFlowCommands.length}
            </Tag>
            <Button icon={<TranslationOutlined />} onClick={toggleLanguage}>
              {t("languageSwitch")}
            </Button>
            <Button
              icon={<CodeOutlined />}
              onClick={() =>
                createTask({
                  input: "检查当前工作区，生成代码任务计划，并估算运行测试所需 Token 成本。",
                  modelPolicy: "code_first",
                  softBudgetUsd: 1,
                  hardBudgetUsd: 2.5,
                })
              }
            >
              {language === "zh" ? `生成${t("codingPlan")}` : t("codingPlan")}
            </Button>
          </Space>
        </div>
        <div className="mobile-nav">
          {[
            { label: t("dashboard"), value: "overview" },
            { label: t("memorySystem"), value: "memory" },
            { label: "MCP / Skill", value: "mcp" },
            { label: t("modelAccess"), value: "providers" },
            { label: t("tokenMonitor"), value: "usage" },
            { label: t("security"), value: "security" },
          ].map((item) => (
            <Button
              key={item.value}
              size="small"
              type={view === item.value ? "primary" : "default"}
              onClick={() => setView(item.value as ViewKey)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <StatusStrip
          taskCount={tasks.length}
          memoryCount={memories.length}
          providers={providers}
          usageEntries={usageEntries}
        />
        {tasks.length ? (
          <Suspense fallback={<LoadingPanel />}>{mainContent}</Suspense>
        ) : (
          <Empty description={t("noTask")} />
        )}
        <div className="stack" style={{ marginTop: 16 }}>
          <Card
            className="panel"
            title={
              <Space>
                <BranchesOutlined />
                <Typography.Text strong>{t("queue")}</Typography.Text>
              </Space>
            }
          >
            <div className="task-queue-list">
              {tasks.slice(0, 6).map((task) => (
                <div className="task-queue-row" key={task.id}>
                  <div className="task-queue-title">
                    <Space wrap>
                      <Typography.Text strong>{task.title}</Typography.Text>
                      <Tag color={task.executionMode === "direct" ? "volcano" : "cyan"}>
                        {task.executionMode === "direct"
                          ? language === "zh"
                            ? "直接执行"
                            : "direct"
                          : language === "zh"
                            ? "计划模式"
                            : "plan"}
                      </Tag>
                      <Tag color={statusColor[task.status]}>{formatTaskStatus(task.status)}</Tag>
                      <Tag>{formatRisk(task.riskLevel)}</Tag>
                    </Space>
                  </div>
                  <Typography.Paragraph ellipsis={{ rows: 2 }} className="task-queue-description">
                    {task.input}
                  </Typography.Paragraph>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </Layout.Content>
    </Layout>
  );
}

function ThemedApp() {
  const { language } = useI18n();

  return (
    <ConfigProvider
      locale={language === "zh" ? zhCN : enUS}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: "#0d9488",
          colorInfo: "#2563eb",
          colorWarning: "#d99e00",
          colorError: "#d9480f",
          borderRadius: 8,
          fontFamily:
            "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        },
        components: {
          Card: { borderRadiusLG: 8 },
          Button: { borderRadius: 8 },
        },
      }}
    >
      <AntdApp>
        <AppContent />
      </AntdApp>
    </ConfigProvider>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <ThemedApp />
    </I18nProvider>
  );
}
