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
import { useI18n } from "../i18n";
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
  tags: ModelPolicy[];
  apiKey?: string;
  enabled: boolean;
};

const providerKinds: ProviderConfig["kind"][] = [
  "openai-compatible",
  "anthropic",
  "gemini",
  "deepseek",
  "qwen",
  "kimi",
  "zhipu",
  "ollama",
];

const modelPolicies: ModelPolicy[] = [
  "low_cost",
  "balanced",
  "strong_reasoning",
  "long_context",
  "code_first",
  "privacy_first",
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
  const providers = useAgentStore((state) => state.providers);
  const testProvider = useAgentStore((state) => state.testProvider);
  const saveProvider = useAgentStore((state) => state.saveProvider);
  const [form] = Form.useForm<ProviderFormValue>();
  const [editingProvider, setEditingProvider] = useState<ProviderConfig | undefined>();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [testingProviderId, setTestingProviderId] = useState<string>();

  const openCreate = () => {
    setEditingProvider(undefined);
    form.setFieldsValue({
      name: "OpenAI Compatible",
      kind: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5",
      contextWindow: 128_000,
      inputPricePerMTok: 1,
      outputPricePerMTok: 5,
      tags: ["balanced"],
      enabled: true,
    });
    setOpen(true);
  };

  const openEdit = (provider: ProviderConfig) => {
    setEditingProvider(provider);
    form.setFieldsValue({
      ...provider,
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
    const provider: ProviderConfig = {
      id: editingProvider?.id ?? makeProviderId(value.name),
      name: value.name,
      kind: value.kind,
      baseUrl: value.baseUrl,
      model: value.model,
      contextWindow: value.contextWindow,
      inputPricePerMTok: value.inputPricePerMTok,
      outputPricePerMTok: value.outputPricePerMTok,
      tags: value.tags,
      enabled: value.enabled,
      maskedKey: maskKey(value.apiKey, editingProvider?.maskedKey),
      status: value.apiKey || connectionChanged ? "untested" : editingProvider?.status ?? "untested",
    };

    setSubmitting(true);

    try {
      saveProvider(provider);

      if (value.apiKey || value.kind === "ollama") {
        await runProviderTest(provider, value.apiKey);
      } else {
        message.success(language === "zh" ? "配置已保存。为了安全，明文 API Key 不会进入本地状态。" : "Provider saved.");
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
              if (provider.kind === "ollama") {
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
              ? "首版通过配置表接入，真实密钥进入系统 Keychain"
              : "This build uses a config table; real secrets are stored in the system Keychain."
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
        scroll={{ x: 980 }}
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
              <Select options={providerKinds.map((kind) => ({ label: kind, value: kind }))} />
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
                  ? "仅用于本次保存/测试；本地状态只保留脱敏标记"
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
