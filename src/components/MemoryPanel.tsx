import {
  ApartmentOutlined,
  AuditOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  DeploymentUnitOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import { useMemo, useState } from "react";
import type { MemoryKind, MemoryRecord } from "../domain/types";
import { isTauriRuntime } from "../desktop/commands";
import { useI18n } from "../i18n";
import { useAgentStore } from "../store/useAgentStore";

const memoryKinds: Array<MemoryKind | "all"> = [
  "all",
  "profile",
  "project",
  "episodic",
  "procedural",
];

const memoryLayers: Array<{
  kind: MemoryKind;
  priority: string;
  storage: string;
  writePolicy: string;
}> = [
  {
    kind: "profile",
    priority: "P1",
    storage: "SQLite metadata + LanceDB/profile",
    writePolicy: "用户偏好、常用路径、默认模型，默认人工确认后固化。",
  },
  {
    kind: "project",
    priority: "P2",
    storage: "SQLite metadata + LanceDB/project",
    writePolicy: "项目结构、README、约束和关键文件摘要，按工作区隔离。",
  },
  {
    kind: "episodic",
    priority: "P3",
    storage: "SQLite task ledger + LanceDB/episode",
    writePolicy: "任务结果、失败原因、成功路径，低置信度先进入候选区。",
  },
  {
    kind: "procedural",
    priority: "P4",
    storage: "SQLite recipes + Skill usage traces",
    writePolicy: "可复用流程、Skill/MCP 调用经验，稳定复用后提升权重。",
  },
];

const memoryLifecycle = {
  zh: ["捕获", "脱敏", "归类", "向量化", "检索", "注入", "衰减"],
  en: ["capture", "redact", "classify", "embed", "retrieve", "inject", "decay"],
};

type MemoryFormValue = {
  kind: MemoryKind;
  content: string;
  source: string;
  confidence: number;
  enabled: boolean;
};

export function MemoryPanel() {
  const { formatMemoryKind, language, t } = useI18n();
  const desktopSecrets = isTauriRuntime();
  const [form] = Form.useForm<MemoryFormValue>();
  const memories = useAgentStore((state) => state.memories);
  const addMemory = useAgentStore((state) => state.addMemory);
  const updateMemory = useAgentStore((state) => state.updateMemory);
  const deleteMemory = useAgentStore((state) => state.deleteMemory);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<MemoryKind | "all">("all");
  const [autoWrite, setAutoWrite] = useState(true);
  const [redaction, setRedaction] = useState(true);
  const [candidateReview, setCandidateReview] = useState(true);
  const [editingMemory, setEditingMemory] = useState<MemoryRecord>();
  const [modalOpen, setModalOpen] = useState(false);

  const filteredMemories = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return memories.filter((memory) => {
      const matchesKind = kind === "all" || memory.kind === kind;
      const matchesQuery = normalizedQuery
        ? memory.content.toLowerCase().includes(normalizedQuery) ||
          memory.source.toLowerCase().includes(normalizedQuery)
        : true;

      return matchesKind && matchesQuery;
    });
  }, [kind, memories, query]);
  const memoryKindOptions = useMemo(
    () =>
      memoryKinds.map((item) => ({
        label: item === "all" ? (language === "zh" ? "全部" : "all") : formatMemoryKind(item),
        value: item,
      })),
    [formatMemoryKind, language],
  );
  const editableMemoryKindOptions = useMemo(
    () =>
      memoryKinds
        .filter((item): item is MemoryKind => item !== "all")
        .map((item) => ({ label: formatMemoryKind(item), value: item })),
    [formatMemoryKind],
  );
  const memoryCounts = useMemo(() => {
    return memories.reduce<Record<MemoryKind, number>>(
      (result, memory) => ({
        ...result,
        [memory.kind]: result[memory.kind] + 1,
      }),
      { profile: 0, project: 0, episodic: 0, procedural: 0 },
    );
  }, [memories]);
  const openCreateMemory = () => {
    setEditingMemory(undefined);
    form.setFieldsValue({
      kind: "project",
      content: "",
      source: "manual",
      confidence: 0.8,
      enabled: true,
    });
    setModalOpen(true);
  };
  const openEditMemory = (memory: MemoryRecord) => {
    setEditingMemory(memory);
    form.setFieldsValue({
      kind: memory.kind,
      content: memory.content,
      source: memory.source,
      confidence: memory.confidence,
      enabled: memory.enabled,
    });
    setModalOpen(true);
  };
  const submitMemory = async () => {
    const value = await form.validateFields();
    const normalizedValue = {
      ...value,
      confidence: Number(value.confidence.toFixed(2)),
    };

    if (editingMemory) {
      updateMemory(editingMemory.id, normalizedValue);
    } else {
      addMemory(normalizedValue);
    }

    setModalOpen(false);
  };

  return (
    <div className="stack">
      <Card
        className="panel"
        title={language === "zh" ? "记忆架构" : "Memory Architecture"}
        extra={
          <Space size={6}>
            <DeploymentUnitOutlined />
            <Typography.Text type="secondary">
              {language === "zh" ? "本地状态管理" : "Local state managed"}
            </Typography.Text>
          </Space>
        }
      >
        <div className="memory-architecture">
          <div className="memory-map">
            {memoryLayers.map((layer) => (
              <div className="memory-layer" key={layer.kind}>
                <div className="memory-layer-head">
                  <Space wrap>
                    <Tag color="geekblue">{layer.priority}</Tag>
                    <Typography.Text strong>{formatMemoryKind(layer.kind)}</Typography.Text>
                    <Tag>{memoryCounts[layer.kind]}</Tag>
                  </Space>
                </div>
                <Typography.Paragraph className="memory-description" ellipsis={{ rows: 2 }}>
                  {language === "zh" ? layer.writePolicy : layer.storage}
                </Typography.Paragraph>
                <Typography.Text type="secondary">{layer.storage}</Typography.Text>
              </div>
            ))}
          </div>

          <div className="memory-policy-grid">
            <div className="memory-policy">
              <Space>
                <ApartmentOutlined />
                <Typography.Text strong>
                  {language === "zh" ? "放置位置" : "Placement"}
                </Typography.Text>
              </Space>
              <p>
                {language === "zh"
                  ? desktopSecrets
                    ? "当前记录保存在本地状态；SQLite 元数据和 LanceDB 向量索引是下一阶段落库目标。API Key 已进入系统钥匙串，Context Compiler 只拿脱敏后的片段。"
                    : "当前记录保存在本地状态；SQLite 元数据和 LanceDB 向量索引是下一阶段落库目标。网页预览不持久化明文密钥。"
                  : desktopSecrets
                    ? "Records currently use local state. SQLite metadata and LanceDB vectors are the next persistence target. API keys already use the system keychain."
                    : "Records currently use local state. SQLite metadata and LanceDB vectors are the next persistence target. Web preview does not persist plain secrets."}
              </p>
            </div>
            <div className="memory-policy">
              <Space>
                <AuditOutlined />
                <Typography.Text strong>
                  {language === "zh" ? "生命周期" : "Lifecycle"}
                </Typography.Text>
              </Space>
              <div className="memory-lifecycle">
                {memoryLifecycle[language].map((item) => (
                  <Tag key={item}>{item}</Tag>
                ))}
              </div>
            </div>
            <div className="memory-policy">
              <Space>
                <SafetyCertificateOutlined />
                <Typography.Text strong>
                  {language === "zh" ? "治理开关" : "Governance"}
                </Typography.Text>
              </Space>
              <div className="memory-toggles">
                <label>
                  <Switch checked={autoWrite} onChange={setAutoWrite} />
                  <span>{language === "zh" ? "成功任务自动候选写入" : "Auto-candidate successful tasks"}</span>
                </label>
                <label>
                  <Switch checked={redaction} onChange={setRedaction} />
                  <span>{language === "zh" ? "密钥/路径敏感片段先脱敏" : "Redact sensitive snippets first"}</span>
                </label>
                <label>
                  <Switch checked={candidateReview} onChange={setCandidateReview} />
                  <span>{language === "zh" ? "低置信度进入待确认区" : "Review low-confidence memory"}</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card
        className="panel"
        title={t("memorySystem")}
        extra={
          <Space size={8} wrap>
            <Space size={6}>
              <DatabaseOutlined />
              <Typography.Text type="secondary">
                {language === "zh" ? "本地状态 · 向量索引待接入" : "Local state · vector index pending"}
              </Typography.Text>
            </Space>
            <Button icon={<PlusOutlined />} type="primary" onClick={openCreateMemory}>
              {language === "zh" ? "添加记忆" : "Add Memory"}
            </Button>
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("memorySearchPlaceholder")}
            style={{ width: 280 }}
          />
          <Segmented
            options={memoryKindOptions}
            value={kind}
            onChange={(value) => setKind(value as MemoryKind | "all")}
          />
          <Typography.Text type="secondary">
            {language === "zh"
              ? `共 ${filteredMemories.length} 条`
              : `${filteredMemories.length} records`}
          </Typography.Text>
        </Space>
        <div className="memory-list">
          {filteredMemories.map((memory) => (
            <div className="memory-row" key={memory.id}>
              <div className="memory-main">
                <div className="memory-title">
                  <Space wrap>
                    <Typography.Text strong>{formatMemoryKind(memory.kind)}</Typography.Text>
                    <Tag>{memory.source}</Tag>
                    <Tag color="cyan">{Math.round(memory.confidence * 100)}%</Tag>
                    <Tag color={memory.enabled ? "green" : "default"}>
                      {memory.enabled
                        ? language === "zh"
                          ? "可注入上下文"
                          : "enabled"
                        : language === "zh"
                          ? "已禁用"
                          : "disabled"}
                    </Tag>
                  </Space>
                </div>
                <Typography.Paragraph ellipsis={{ rows: 2 }} className="memory-description">
                  {memory.content}
                </Typography.Paragraph>
                <Typography.Text type="secondary">
                  {language === "zh" ? "更新时间" : "Updated"}{" "}
                  {new Date(memory.updatedAt).toLocaleString()}
                </Typography.Text>
              </div>
              <div className="memory-actions">
                <Switch
                  checked={memory.enabled}
                  onChange={(enabled) => updateMemory(memory.id, { enabled })}
                />
                <Button size="small" icon={<EditOutlined />} onClick={() => openEditMemory(memory)}>
                  {language === "zh" ? "编辑" : "Edit"}
                </Button>
                <Popconfirm
                  title={language === "zh" ? "删除这条记忆？" : "Delete this memory?"}
                  description={
                    language === "zh"
                      ? "删除后不会再进入检索和上下文。"
                      : "It will no longer be retrieved or injected."
                  }
                  okText={language === "zh" ? "删除" : "Delete"}
                  cancelText={language === "zh" ? "取消" : "Cancel"}
                  onConfirm={() => deleteMemory(memory.id)}
                >
                  <Button danger size="small" icon={<DeleteOutlined />}>
                    {language === "zh" ? "删除" : "Delete"}
                  </Button>
                </Popconfirm>
              </div>
            </div>
          ))}
        </div>
        <Modal
          title={
            editingMemory
              ? language === "zh"
                ? "编辑记忆"
                : "Edit Memory"
              : language === "zh"
                ? "添加记忆"
                : "Add Memory"
          }
          open={modalOpen}
          onCancel={() => setModalOpen(false)}
          onOk={submitMemory}
          okText={language === "zh" ? "保存" : "Save"}
          cancelText={language === "zh" ? "取消" : "Cancel"}
          width={680}
        >
          <Form form={form} layout="vertical">
            <Space.Compact block>
              <Form.Item
                name="kind"
                label={language === "zh" ? "记忆类型" : "Memory Type"}
                rules={[{ required: true }]}
                style={{ width: "50%" }}
              >
                <Select options={editableMemoryKindOptions} />
              </Form.Item>
              <Form.Item
                name="source"
                label={language === "zh" ? "来源" : "Source"}
                rules={[{ required: true, whitespace: true }]}
                style={{ width: "50%" }}
              >
                <Input placeholder="manual / task / workspace / skill" />
              </Form.Item>
            </Space.Compact>
            <Form.Item
              name="content"
              label={language === "zh" ? "记忆内容" : "Content"}
              rules={[{ required: true, whitespace: true }]}
            >
              <Input.TextArea
                autoSize={{ minRows: 4, maxRows: 8 }}
                placeholder={
                  language === "zh"
                    ? "写入要长期保留、可被上下文检索的事实、偏好、项目约束或流程经验。"
                    : "Store durable facts, preferences, project constraints, or reusable procedures."
                }
              />
            </Form.Item>
            <Space.Compact block>
              <Form.Item
                name="confidence"
                label={language === "zh" ? "置信度" : "Confidence"}
                rules={[{ required: true }]}
                style={{ width: "50%" }}
              >
                <InputNumber min={0} max={1} step={0.05} style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item
                name="enabled"
                label={language === "zh" ? "是否启用" : "Enabled"}
                valuePropName="checked"
                style={{ width: "50%" }}
              >
                <Switch />
              </Form.Item>
            </Space.Compact>
            <Typography.Text type="secondary">
              {language === "zh"
                ? "启用后的记忆会参与检索；进入模型上下文前仍会经过 Context Compiler 排序、裁剪和脱敏。"
                : "Enabled memory can be retrieved; Context Compiler still ranks, trims, and redacts before model injection."}
            </Typography.Text>
          </Form>
        </Modal>
      </Card>
    </div>
  );
}
