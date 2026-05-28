import {
  CodeOutlined,
  FileImageOutlined,
  InboxOutlined,
  PaperClipOutlined,
  SendOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Flex,
  Input,
  InputNumber,
  Select,
  Space,
  Tag,
  Upload,
} from "antd";
import type { UploadFile } from "antd";
import { useMemo, useState } from "react";
import type { ModelPolicy, TaskAttachment } from "../domain/types";
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

  const submitTask = (override?: string, overridePolicy?: ModelPolicy) => {
    const taskText = (override ?? input).trim();
    const policy = overridePolicy ?? modelPolicy;
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
    });

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
        content:
          language === "zh"
            ? `已生成任务计划：${task.title}`
            : `Execution plan created: ${task.title}`,
      },
    ]);
    setInput("");
  };

  const applyCodingPlan = () => {
    const text =
      language === "zh"
        ? "检查当前工作区，生成代码任务计划，列出影响文件、修改步骤、验证命令和回滚方式。"
        : "Inspect the current workspace and create a code task plan with affected files, steps, verification commands, and rollback notes.";
    setInput(text);
    submitTask(text, "code_first");
  };

  return (
    <Card
      className="panel"
      title={language === "zh" ? "聊天任务框" : "Agent Chat"}
      extra={
        <Space size={6} wrap>
          <Tag color="cyan">{t("planFirstRuntime")}</Tag>
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
              ? "直接写一句任务，也可以拖入文件、图片，再让 AstraFlow 生成执行计划。"
              : "Write a task in one sentence, attach files or images, then let AstraFlow create the execution plan."}
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
            <Input
              value={workspace}
              onChange={(event) => setWorkspace(event.target.value)}
              placeholder={t("workspacePlaceholder")}
              style={{ width: 260 }}
            />
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
              icon={fileList.length ? <PaperClipOutlined /> : <SendOutlined />}
              disabled={disabled}
              onClick={() => submitTask()}
            >
              {t("createPlan")}
            </Button>
          </Space>
        </Flex>
      </div>
    </Card>
  );
}
