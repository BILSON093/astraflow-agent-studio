import { CloudSyncOutlined, PlusOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import { useState } from "react";
import type { ModelPolicy, ProviderConfig } from "../domain/types";
import { isTauriRuntime } from "../desktop/commands";
import { useI18n } from "../i18n";
import { saveProviderCredential } from "../runtime/providerClient";
import { getProviderProtocolLabel } from "../runtime/providerAdapters";
import { useAgentStore } from "../store/useAgentStore";

type ProviderFormValue = {
  id?: string;
  name: string;
  kind: ProviderConfig["kind"];
  baseUrl: string;
  model: string;
  contextWindow: number;
  inputPricePerMTok: number;
  outputPricePerMTok: number;
  cacheReadPricePerMTok: number;
  tags: ModelPolicy[];
  apiKey?: string;
  enabled: boolean;
};

const providerKinds: ProviderConfig["kind"][] = [
  "openai-compatible",
  "anthropic",
  "gemini",
  "mimo",
  "deepseek",
  "qwen",
  "kimi",
  "zhipu",
  "ollama",
];

const providerKindLabels: Record<ProviderConfig["kind"], string> = {
  "openai-compatible": "OpenAI-compatible",
  anthropic: "Anthropic Messages",
  gemini: "Gemini generateContent",
  mimo: "Xiaomi MiMo OpenAI-compatible",
  deepseek: "DeepSeek OpenAI-compatible",
  qwen: "Qwen OpenAI-compatible",
  kimi: "Kimi OpenAI-compatible",
  zhipu: "Zhipu OpenAI-compatible",
  ollama: "Ollama Local",
};

const modelPolicies: ModelPolicy[] = [
  "low_cost",
  "balanced",
  "strong_reasoning",
  "long_context",
  "code_first",
  "privacy_first",
];

const providerPresets: Array<
  Omit<ProviderFormValue, "id" | "apiKey" | "enabled"> & { enabled?: boolean }
> = [
  {
    name: "OpenAI Compatible",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5",
    contextWindow: 400_000,
    inputPricePerMTok: 1.25,
    outputPricePerMTok: 10,
    cacheReadPricePerMTok: 0.125,
    tags: ["balanced", "strong_reasoning", "code_first"],
  },
  {
    name: "Anthropic Claude",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-20250514",
    contextWindow: 200_000,
    inputPricePerMTok: 3,
    outputPricePerMTok: 15,
    cacheReadPricePerMTok: 0.3,
    tags: ["strong_reasoning", "long_context", "code_first"],
  },
  {
    name: "Google Gemini",
    kind: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-pro",
    contextWindow: 1_048_576,
    inputPricePerMTok: 1.25,
    outputPricePerMTok: 10,
    cacheReadPricePerMTok: 0.125,
    tags: ["long_context", "strong_reasoning", "code_first"],
  },
  {
    name: "Xiaomi MiMo",
    kind: "mimo",
    baseUrl: "https://api.mimo-v2.com/v1",
    model: "mimo-v2.5-pro",
    contextWindow: 1_048_576,
    inputPricePerMTok: 0.6,
    outputPricePerMTok: 2.4,
    cacheReadPricePerMTok: 0.6,
    tags: ["strong_reasoning", "long_context", "code_first"],
  },
  {
    name: "DeepSeek",
    kind: "deepseek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    contextWindow: 128_000,
    inputPricePerMTok: 0.27,
    outputPricePerMTok: 1.1,
    cacheReadPricePerMTok: 0.027,
    tags: ["low_cost", "balanced", "code_first"],
  },
  {
    name: "Qwen",
    kind: "qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-max",
    contextWindow: 128_000,
    inputPricePerMTok: 1.6,
    outputPricePerMTok: 6.4,
    cacheReadPricePerMTok: 0.16,
    tags: ["balanced", "long_context"],
  },
  {
    name: "Ollama Local",
    kind: "ollama",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen3-coder",
    contextWindow: 32_000,
    inputPricePerMTok: 0,
    outputPricePerMTok: 0,
    cacheReadPricePerMTok: 0,
    tags: ["privacy_first", "low_cost", "code_first"],
  },
];

function makeProviderId(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

  return `${slug || "custom-provider"}-${Date.now()}`;
}

function maskKey(apiKey?: string, fallback?: string): string {
  if (!apiKey) {
    return fallback ?? "未配置";
  }

  if (apiKey.length <= 8) {
    return "***";
  }

  return `${apiKey.slice(0, 3)}...${apiKey.slice(-4)}`;
}

export function ProviderHub() {
  const { formatModelPolicy, formatProviderStatus, language, t } = useI18n();
  const desktopSecrets = isTauriRuntime();
  const providers = useAgentStore((state) => state.providers);
  const testProvider = useAgentStore((state) => state.testProvider);
  const saveProvider = useAgentStore((state) => state.saveProvider);
  const [form] = Form.useForm<ProviderFormValue>();
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | undefined>();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [testingProviderId, setTestingProviderId] = useState<string>();

  const applyPreset = (preset: (typeof providerPresets)[number]) => {
    form.setFieldsValue({
      ...preset,
      enabled: preset.enabled ?? true,
      apiKey: "",
    });
  };

  const openCreate = () => {
    setEditingProvider(undefined);
    applyPreset(providerPresets[0]);
    setOpen(true);
  };

  const openEdit = (provider: ProviderConfig) => {
    setEditingProvider(provider);
    form.setFieldsValue({
      ...provider,
      cacheReadPricePerMTok: provider.cacheReadPricePerMTok ?? provider.inputPricePerMTok * 0.1,
      apiKey: "",
    });
    setOpen(true);
  };

  const runProviderTest = async (provider: ProviderConfig, apiKey?: string) => {
    setTestingProviderId(provider.id);

    try {
      const result = await testProvider(provider.id, apiKey);

      if (result.ok) {
        message.success(language === "zh" ? "连通测试成功，已写入 Token 监控。" : "Connection test passed.");
      } else {
        message.warning(result.message);
      }

      return result;
    } finally {
      setTestingProviderId(undefined);
    }
  };

  const submitProvider = async () => {
    const value = await form.validateFields();
    const connectionChanged =
      !editingProvider ||
      editingProvider.kind !== value.kind ||
      editingProvider.baseUrl !== value.baseUrl ||
      editingProvider.model !== value.model;
    const providerDraft: ProviderConfig = {
      id: editingProvider?.id ?? makeProviderId(value.name),
      name: value.name,
      kind: value.kind,
      baseUrl: value.baseUrl,
      model: value.model,
      contextWindow: value.contextWindow,
      inputPricePerMTok: value.inputPricePerMTok,
      outputPricePerMTok: value.outputPricePerMTok,
      cacheReadPricePerMTok: value.cacheReadPricePerMTok,
      tags: value.tags,
      enabled: value.enabled,
      maskedKey: maskKey(value.apiKey, editingProvider?.maskedKey),
      status: value.apiKey || connectionChanged ? "untested" : editingProvider?.status ?? "untested",
    };

    setSubmitting(true);

    try {
      const credentialResult = await saveProviderCredential(providerDraft, value.apiKey);
      const provider: ProviderConfig = {
        ...providerDraft,
        maskedKey: credentialResult.maskedKey,
      };

      saveProvider(provider);

      if (value.apiKey || value.kind === "ollama") {
        await runProviderTest(provider, value.apiKey);
      } else {
        message.success(
          language === "zh"
            ? desktopSecrets
              ? "配置已保存；如已保存过 Key，后续测试会从系统钥匙串读取。"
              : "配置已保存。为了安全，明文 API Key 不会进入本地状态。"
            : desktopSecrets
              ? "Provider saved. Existing keys are read from the system keychain."
              : "Provider saved.",
        );
      }

      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const columns: TableColumnsType<ProviderConfig> = [
    {
      title: t("provider"),
      key: "provider",
      render: (_, provider) => (
        <Space orientation="vertical" size={0}>
          <Typography.Text strong>{provider.name}</Typography.Text>
          <Typography.Text type="secondary">{provider.baseUrl}</Typography.Text>
        </Space>
      ),
    },
    {
      title: t("model"),
      dataIndex: "model",
      key: "model",
      render: (model: string, provider) => (
        <Space wrap>
          <Tag color="geekblue">{model}</Tag>
          <Tag>{provider.contextWindow.toLocaleString()} ctx</Tag>
        </Space>
      ),
    },
    {
      title: language === "zh" ? "协议" : "Protocol",
      key: "protocol",
      render: (_, provider) => <Tag color="purple">{getProviderProtocolLabel(provider)}</Tag>,
    },
    {
      title: t("policy"),
      dataIndex: "tags",
      key: "tags",
      render: (tags: ProviderConfig["tags"]) => (
        <Space size={4} wrap>
          {tags.map((tag) => (
            <Tag key={tag}>{formatModelPolicy(tag)}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: t("key"),
      dataIndex: "maskedKey",
      key: "maskedKey",
    },
    {
      title: t("status"),
      dataIndex: "status",
      key: "status",
      render: (status: ProviderConfig["status"]) => {
        const color = status === "connected" ? "green" : status === "failed" ? "volcano" : "default";
        return <Tag color={color}>{formatProviderStatus(status)}</Tag>;
      },
    },
    {
      title: t("enabled"),
      key: "enabled",
      render: (_, provider) => (
        <Switch
          checked={provider.enabled}
          onChange={(enabled) => saveProvider({ ...provider, enabled })}
        />
      ),
    },
    {
      title: language === "zh" ? "操作" : "Action",
      key: "action",
      render: (_, provider) => (
        <Space>
          <Button size="small" onClick={() => openEdit(provider)}>
            {language === "zh" ? "编辑" : "Edit"}
          </Button>
          <Button
            size="small"
            icon={<CloudSyncOutlined />}
            loading={testingProviderId === provider.id}
            onClick={() => {
              if (provider.kind === "ollama" || desktopSecrets) {
                void runProviderTest(provider);
                return;
              }

              openEdit(provider);
              message.info(
                language === "zh"
                  ? "请在弹窗里输入 API Key；保存后会立即做真实连通测试。"
                  : "Enter an API key in the dialog; saving will run a real test.",
              );
            }}
          >
            {provider.kind === "ollama" ? t("test") : language === "zh" ? "填 Key 测试" : "Test with key"}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Card
      className="panel"
      title={t("providerHub")}
      extra={
        <Tooltip
          title={
            language === "zh"
              ? desktopSecrets
                ? "桌面版会把明文 Key 写入系统钥匙串；前端只保留脱敏标记。"
                : "网页预览不会持久化明文 Key；保存/测试后只保留脱敏标记。"
              : desktopSecrets
                ? "Desktop stores plain keys in the system keychain; frontend state keeps only masked markers."
                : "Web preview does not persist plain keys; only masked markers are kept after save/test."
          }
        >
          <Button icon={<PlusOutlined />} onClick={openCreate}>
            {t("addProvider")}
          </Button>
        </Tooltip>
      }
    >
      <Table
        rowKey="id"
        columns={columns}
        dataSource={providers}
        pagination={false}
        scroll={{ x: 1180 }}
      />
      <Modal
        title={editingProvider ? (language === "zh" ? "编辑模型供应商" : "Edit Provider") : t("addProvider")}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={submitProvider}
        confirmLoading={submitting}
        okText={language === "zh" ? "保存" : "Save"}
        cancelText={language === "zh" ? "取消" : "Cancel"}
        width={720}
      >
        <Form form={form} layout="vertical">
          <Form.Item label={language === "zh" ? "快速预设" : "Presets"}>
            <Space wrap>
              {providerPresets.map((preset) => (
                <Button key={preset.name} size="small" onClick={() => applyPreset(preset)}>
                  {preset.name}
                </Button>
              ))}
            </Space>
          </Form.Item>
          <Space.Compact block>
            <Form.Item
              name="name"
              label={language === "zh" ? "名称" : "Name"}
              rules={[{ required: true }]}
              style={{ width: "50%" }}
            >
              <Input placeholder="DeepSeek / Qwen / OpenAI Compatible" />
            </Form.Item>
            <Form.Item
              name="kind"
              label={language === "zh" ? "类型" : "Type"}
              rules={[{ required: true }]}
              style={{ width: "50%" }}
            >
              <Select
                options={providerKinds.map((kind) => ({
                  label: providerKindLabels[kind],
                  value: kind,
                }))}
              />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true }, { type: "url" }]}>
            <Input placeholder="https://api.example.com/v1" />
          </Form.Item>
          <Space.Compact block>
            <Form.Item name="model" label={t("model")} rules={[{ required: true }]} style={{ width: "50%" }}>
              <Input placeholder="gpt-5 / deepseek-chat / qwen-max" />
            </Form.Item>
            <Form.Item
              name="contextWindow"
              label={language === "zh" ? "上下文长度" : "Context Window"}
              rules={[{ required: true }]}
              style={{ width: "50%" }}
            >
              <InputNumber min={1_000} step={1_000} style={{ width: "100%" }} />
            </Form.Item>
          </Space.Compact>
          <Space.Compact block>
            <Form.Item
              name="inputPricePerMTok"
              label={language === "zh" ? "输入价格 / 百万 Token" : "Input / MTok"}
              rules={[{ required: true }]}
              style={{ width: "50%" }}
            >
              <InputNumber min={0} step={0.01} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item
              name="outputPricePerMTok"
              label={language === "zh" ? "输出价格 / 百万 Token" : "Output / MTok"}
              rules={[{ required: true }]}
              style={{ width: "50%" }}
            >
              <InputNumber min={0} step={0.01} style={{ width: "100%" }} />
            </Form.Item>
          </Space.Compact>
          <Form.Item
            name="cacheReadPricePerMTok"
            label={language === "zh" ? "缓存命中价格 / 百万 Token" : "Cache Hit / MTok"}
            rules={[{ required: true }]}
          >
            <InputNumber min={0} step={0.01} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="tags" label={t("policy")} rules={[{ required: true }]}>
            <Select
              mode="multiple"
              options={modelPolicies.map((policy) => ({
                label: formatModelPolicy(policy),
                value: policy,
              }))}
            />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key">
            <Input.Password
              placeholder={
                language === "zh"
                  ? desktopSecrets
                    ? "保存后写入系统钥匙串；前端状态只保留脱敏标记"
                    : "仅用于本次保存/测试；本地状态只保留脱敏标记"
                  : desktopSecrets
                    ? "Saved to the system keychain; frontend state keeps only a masked marker"
                    : "Used only for this save/test; only a masked marker is stored"
              }
            />
          </Form.Item>
          <Form.Item name="enabled" valuePropName="checked">
            <Switch /> <Typography.Text>{t("enabled")}</Typography.Text>
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
