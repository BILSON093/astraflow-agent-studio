import {
  ApartmentOutlined,
  AuditOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  SearchOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import { Card, Input, Segmented, Space, Switch, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import type { MemoryKind } from "../domain/types";
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

export function MemoryPanel() {
  const { formatMemoryKind, language, t } = useI18n();
  const memories = useAgentStore((state) => state.memories);
  const updateMemory = useAgentStore((state) => state.updateMemory);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<MemoryKind | "all">("all");
  const [autoWrite, setAutoWrite] = useState(true);
  const [redaction, setRedaction] = useState(true);
  const [candidateReview, setCandidateReview] = useState(true);

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
  const memoryCounts = useMemo(() => {
    return memories.reduce<Record<MemoryKind, number>>(
      (result, memory) => ({
        ...result,
        [memory.kind]: result[memory.kind] + 1,
      }),
      { profile: 0, project: 0, episodic: 0, procedural: 0 },
    );
  }, [memories]);

  return (
    <div className="stack">
      <Card
        className="panel"
        title={language === "zh" ? "记忆架构" : "Memory Architecture"}
        extra={
          <Space size={6}>
            <DeploymentUnitOutlined />
            <Typography.Text type="secondary">
              {language === "zh" ? "本地 Runtime 托管" : "Local Runtime managed"}
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
                  ? "记忆元数据进 SQLite，向量索引进 LanceDB，密钥只进系统 Keychain；Context Compiler 只拿脱敏后的片段。"
                  : "Metadata goes to SQLite, vectors to LanceDB, secrets to Keychain, and only redacted snippets enter context."}
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
          <Space size={6}>
            <DatabaseOutlined />
            <Typography.Text type="secondary">
              {language === "zh" ? "LanceDB 就绪" : "LanceDB-ready"}
            </Typography.Text>
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
                  </Space>
                </div>
                <Typography.Paragraph ellipsis={{ rows: 2 }} className="memory-description">
                  {memory.content}
                </Typography.Paragraph>
              </div>
              <div>
                <Switch
                  checked={memory.enabled}
                  onChange={(enabled) => updateMemory(memory.id, { enabled })}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
