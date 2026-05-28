import { DatabaseOutlined, SearchOutlined } from "@ant-design/icons";
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

export function MemoryPanel() {
  const { formatMemoryKind, language, t } = useI18n();
  const memories = useAgentStore((state) => state.memories);
  const updateMemory = useAgentStore((state) => state.updateMemory);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<MemoryKind | "all">("all");

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

  return (
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
  );
}
