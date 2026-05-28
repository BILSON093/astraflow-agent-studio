import {
  CodeOutlined,
  FileImageOutlined,
  FolderOpenOutlined,
  InboxOutlined,
  PaperClipOutlined,
  ProfileOutlined,
  SendOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Flex,
  Input,
  InputNumber,
  message,
  Select,
  Segmented,
  Space,
  Tag,
  Upload,
} from "antd";
import type { UploadFile } from "antd";
import { useMemo, useState } from "react";
import type { ModelPolicy, TaskAttachment, TaskExecutionMode } from "../domain/types";
import { isTauriRuntime } from "../desktop/commands";
import { selectWorkspaceDirectory } from "../desktop/workspaceDialog";
import { useI18n } from "../i18n";
import { useAgentStore } from "../store/useAgentStore";

const modelPolicies: ModelPolicy[] = [
  "balanced",
  "low_cost",
  "strong_reasoning",
  "long_context",
  "code_first",
  "privacy_first",
];

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

function fileToAttachment(file: UploadFile): TaskAttachment {
  const rawFile = file.originFileObj;
  const mimeType = file.type || rawFile?.type || "application/octet-stream";

  return {
    id: file.uid,
    name: file.name,
    type: mimeType.startsWith("image/") ? "image" : "file",
    mimeType,
    size: file.size ?? rawFile?.size ?? 0,
    previewUrl: file.thumbUrl,
  };
}

export function TaskComposer() {
  const { formatModelPolicy, language, t } = useI18n();
  const createTask = useAgentStore((state) => state.createTask);
  const [input, setInput] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [modelPolicy, setModelPolicy] = useState<ModelPolicy>("balanced");
  const [executionMode, setExecutionMode] = useState<TaskExecutionMode>("plan");
  const [softBudgetUsd, setSoftBudgetUsd] = useState(1.5);
  const [hardBudgetUsd, setHardBudgetUsd] = useState(3);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const disabled = input.trim().length < 2 && fileList.length === 0;
  const modelPolicyOptions = useMemo(
    () =>
      modelPolicies.map((policy) => ({
        label: formatModelPolicy(policy),
        value: policy,
      })),
    [formatModelPolicy],
  );
  const executionModeOptions = useMemo(
    () => [
      {
        label: (
          <Space size={4}>
            <ProfileOutlined />
            {language === "zh" ? "计划模式" : "Plan"}
          </Space>
        ),
        value: "plan",
      },
      {
        label: (
          <Space size={4}>
            <ThunderboltOutlined />
            {language === "zh" ? "直接执行" : "Direct"}
          </Space>
        ),
        value: "direct",
      },
    ],
    [language],
  );

  const submitTask = (
    override?: string,
    overridePolicy?: ModelPolicy,
    overrideMode?: TaskExecutionMode,
  ) => {
    const taskText = (override ?? input).trim();
    const policy = overridePolicy ?? modelPolicy;
    const mode = overrideMode ?? executionMode;
    const attachments = fileList.map(fileToAttachment);
    const finalText =
      taskText ||
      (language === "zh"
        ? "根据上传的文件和图片生成一份处理计划。"
        : "Create a plan from the uploaded files and images.");

    const task = createTask({
      input: finalText,
      workspace: workspace.trim() || undefined,
      attachments,
      modelPolicy: policy,
      softBudgetUsd,
      hardBudgetUsd,
      executionMode: mode,
    });
    const assistantReply =
      mode === "direct" && task.status === "done"
        ? language === "zh"
          ? `已直接执行完成：${task.title}`
          : `Direct execution completed: ${task.title}`
        : mode === "direct" && task.status === "blocked"
          ? language === "zh"
            ? `已生成计划，但检测到高风险动作，已切换为人工审批：${task.title}`
            : `Plan created, but high-risk actions require approval: ${task.title}`
          : language === "zh"
            ? `已生成任务计划：${task.title}`
            : `Execution plan created: ${task.title}`;

    setMessages((current) => [
      ...current,
      {
        id: `${task.id}-user`,
        role: "user",
        content:
          attachments.length > 0
            ? `${finalText} · ${attachments.length} ${language === "zh" ? "个附件" : "attachments"}`
            : finalText,
      },
      {
        id: `${task.id}-assistant`,
        role: "assistant",
        content: assistantReply,
      },
    ]);
    setInput("");
  };

  const chooseWorkspace = async () => {
    try {
      const selected = await selectWorkspaceDirectory();

      if (selected) {
        setWorkspace(selected);
        message.success(language === "zh" ? "已选择工作区。" : "Workspace selected.");
        return;
      }

      if (!isTauriRuntime()) {
        message.info(
          language === "zh"
            ? "网页预览无法读取完整本机路径；桌面端会打开系统文件夹选择器，也可以先手动粘贴路径。"
            : "The web preview cannot read full local paths; the desktop app opens a native folder picker.",
        );
      }
    } catch (error) {
      message.warning(
        error instanceof Error
          ? error.message
          : language === "zh"
            ? "工作区选择失败。"
            : "Failed to select workspace.",
      );
    }
  };

  const applyCodingPlan = () => {
    const text =
      language === "zh"
        ? "检查当前工作区，生成代码任务计划，列出影响文件、修改步骤、验证命令和回滚方式。"
        : "Inspect the current workspace and create a code task plan with affected files, steps, verification commands, and rollback notes.";
    setInput(text);
    submitTask(text, "code_first", "plan");
  };

  return (
    <Card
      className="panel"
      title={language === "zh" ? "聊天任务框" : "Agent Chat"}
      extra={
        <Space size={6} wrap>
          <Tag color={executionMode === "direct" ? "volcano" : "cyan"}>
            {executionMode === "direct"
              ? language === "zh"
                ? "安全直跑"
                : "Safe direct run"
              : t("planFirstRuntime")}
          </Tag>
          <Tag icon={<FileImageOutlined />}>
            {language === "zh" ? "文件 / 图片" : "Files / Images"}
          </Tag>
        </Space>
      }
    >
      <div className="chat-task">
        <div className="chat-thread">
          <div className="chat-bubble assistant">
            {language === "zh"
              ? "先选计划模式还是直接执行；直接执行只会自动跑低/中风险任务，高风险会停在审批。"
              : "Choose plan mode or direct execution. Direct mode only auto-runs low/medium-risk tasks."}
          </div>
          {messages.map((message) => (
            <div className={`chat-bubble ${message.role}`} key={message.id}>
              {message.content}
            </div>
          ))}
        </div>

        <Input.TextArea
          aria-label="任务聊天输入"
          autoSize={{ minRows: 3, maxRows: 6 }}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onPressEnter={(event) => {
            if (event.metaKey || event.ctrlKey) {
              event.preventDefault();
              submitTask();
            }
          }}
          placeholder={
            language === "zh"
              ? "例如：帮我分析上传的需求文档，生成可执行任务计划，并估算 Token 成本。"
              : "Example: Analyze the uploaded requirement doc, create an execution plan, and estimate Token cost."
          }
        />

        <Segmented
          block
          options={executionModeOptions}
          value={executionMode}
          onChange={(value) => setExecutionMode(value as TaskExecutionMode)}
        />

        <Upload.Dragger
          multiple
          fileList={fileList}
          accept="image/*,.pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.json,.zip"
          beforeUpload={() => false}
          onChange={({ fileList: nextFileList }) => setFileList(nextFileList.slice(-8))}
          onRemove={(file) => setFileList((current) => current.filter((item) => item.uid !== file.uid))}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">
            {language === "zh"
              ? "拖入文件或图片，或点击选择"
              : "Drop files or images here, or click to choose"}
          </p>
        </Upload.Dragger>

        <Flex wrap gap={10} align="center" justify="space-between">
          <Space wrap>
            <Space.Compact>
              <Input
                value={workspace}
                onChange={(event) => setWorkspace(event.target.value)}
                placeholder={t("workspacePlaceholder")}
                style={{ width: 300 }}
              />
              <Button icon={<FolderOpenOutlined />} onClick={chooseWorkspace}>
                {language === "zh" ? "选择工作区" : "Choose"}
              </Button>
            </Space.Compact>
            <Select
              aria-label="模型路由策略"
              options={modelPolicyOptions}
              value={modelPolicy}
              onChange={setModelPolicy}
              style={{ width: 160 }}
            />
            <Space.Compact>
              <span className="budget-prefix">$</span>
              <InputNumber
                aria-label="软预算"
                min={0.1}
                step={0.1}
                value={softBudgetUsd}
                onChange={(value) => setSoftBudgetUsd(Number(value ?? 1.5))}
              />
              <InputNumber
                aria-label="硬预算"
                min={0.2}
                step={0.1}
                value={hardBudgetUsd}
                onChange={(value) => setHardBudgetUsd(Number(value ?? 3))}
              />
            </Space.Compact>
          </Space>
          <Space wrap>
            <Button icon={<CodeOutlined />} onClick={applyCodingPlan}>
              {language === "zh" ? "代码任务计划" : "Code Task Plan"}
            </Button>
            <Button
              type="primary"
              icon={
                executionMode === "direct" ? (
                  <ThunderboltOutlined />
                ) : fileList.length ? (
                  <PaperClipOutlined />
                ) : (
                  <SendOutlined />
                )
              }
              disabled={disabled}
              onClick={() => submitTask()}
            >
              {executionMode === "direct"
                ? language === "zh"
                  ? "直接执行"
                  : "Run"
                : t("createPlan")}
            </Button>
          </Space>
        </Flex>
      </div>
    </Card>
  );
}
