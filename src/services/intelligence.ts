import { getUserSettings } from './settings';

type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface AiConfig {
  provider: string;
  model: string;
  endpoint?: string;
  apiKey?: string;
}

export interface AiCompletion {
  provider: string;
  model: string;
  content: string;
}

interface AiOverrides {
  provider?: string;
  model?: string;
  endpoint?: string;
  apiKey?: string;
}

export async function resolveAiConfig(userId: string, overrides: AiOverrides = {}): Promise<AiConfig> {
  const settings = await getUserSettings(userId);
  const provider = normalizeProvider(overrides.provider || settings.aiProvider || process.env.AI_PROVIDER || 'ollama');
  const model = overrides.model || settings.aiModel || providerDefaultModel(provider);
  const endpoint = overrides.endpoint || settings.aiEndpoint || providerDefaultEndpoint(provider);
  const apiKey = overrides.apiKey || settings.aiApiKey || providerApiKey(provider);

  return { provider, model, endpoint, apiKey };
}

export async function completeWithUserSettings(
  userId: string,
  messages: ChatMessage[],
  overrides: AiOverrides = {}
): Promise<AiCompletion> {
  const config = await resolveAiConfig(userId, overrides);
  const content = await complete(messages, config);
  return { provider: config.provider, model: config.model, content };
}

export async function complete(messages: ChatMessage[], config: AiConfig): Promise<string> {
  if (!config.model) {
    throw new Error('AI model is required');
  }

  if (config.provider === 'ollama') {
    return completeOllama(messages, config);
  }

  if (['openai', 'openai-compatible', 'openrouter'].includes(config.provider)) {
    return completeOpenAiCompatible(messages, config);
  }

  throw new Error(`Unsupported AI provider: ${config.provider}`);
}

export async function listModels(config: AiConfig): Promise<string[]> {
  if (config.provider === 'ollama') {
    const endpoint = (config.endpoint || providerDefaultEndpoint('ollama')).replace(/\/api\/(generate|chat)$/, '/api/tags');
    const data = await getJson(endpoint, {});
    if (!Array.isArray(data.models)) return [];
    return data.models.map((model: any) => model.name).filter((name: unknown): name is string => typeof name === 'string');
  }

  if (['openai', 'openai-compatible', 'openrouter'].includes(config.provider)) {
    if ((config.provider === 'openai' || config.provider === 'openrouter') && !config.apiKey) {
      throw new Error(`${config.provider} API key is not configured`);
    }
    const headers: Record<string, string> = {};
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    const endpoint = (config.endpoint || providerDefaultEndpoint(config.provider)).replace(/\/chat\/completions$/, '/models');
    const data = await getJson(endpoint, headers);
    if (!Array.isArray(data.data)) return [];
    return data.data.map((model: any) => model.id).filter((id: unknown): id is string => typeof id === 'string');
  }

  throw new Error(`Unsupported AI provider: ${config.provider}`);
}

export function extractJsonObject(text: string): unknown {
  const cleaned = stripCodeFence(text.trim());
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const jsonText = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(jsonText);
}

export function stripCodeFence(text: string): string {
  let out = text.trim();
  if (out.startsWith('```json')) out = out.slice(7);
  else if (out.startsWith('```')) out = out.slice(3);
  if (out.endsWith('```')) out = out.slice(0, -3);
  return out.trim();
}

export function availableProviders(): Array<{ provider: string; requiresApiKey: boolean; defaultEndpoint: string }> {
  return [
    { provider: 'ollama', requiresApiKey: false, defaultEndpoint: providerDefaultEndpoint('ollama') },
    { provider: 'openai', requiresApiKey: true, defaultEndpoint: providerDefaultEndpoint('openai') },
    { provider: 'openai-compatible', requiresApiKey: false, defaultEndpoint: providerDefaultEndpoint('openai-compatible') },
    { provider: 'openrouter', requiresApiKey: true, defaultEndpoint: providerDefaultEndpoint('openrouter') },
  ];
}

function normalizeProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === 'custom') return 'openai-compatible';
  return normalized;
}

function providerDefaultModel(provider: string): string {
  if (provider === 'openai') return process.env.OPENAI_MODEL || 'gpt-4o-mini';
  if (provider === 'openrouter') return process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
  return process.env.OLLAMA_MODEL || 'llama3';
}

function providerDefaultEndpoint(provider: string): string {
  if (provider === 'openai') return process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1/chat/completions';
  if (provider === 'openrouter') return process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1/chat/completions';
  if (provider === 'openai-compatible') return process.env.AI_ENDPOINT || 'http://127.0.0.1:1234/v1/chat/completions';
  return process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/generate';
}

function providerApiKey(provider: string): string | undefined {
  if (provider === 'openai') return process.env.OPENAI_API_KEY;
  if (provider === 'openrouter') return process.env.OPENROUTER_API_KEY;
  return process.env.AI_API_KEY;
}

async function completeOllama(messages: ChatMessage[], config: AiConfig): Promise<string> {
  const endpoint = config.endpoint || providerDefaultEndpoint('ollama');
  const prompt = messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n');
  const body = endpoint.endsWith('/api/chat')
    ? { model: config.model, messages, stream: false }
    : { model: config.model, prompt, stream: false };

  const data = await postJson(endpoint, body, {});
  const content = data.response || data.message?.content;
  if (typeof content !== 'string') {
    throw new Error('Ollama response did not include text content');
  }
  return content;
}

async function completeOpenAiCompatible(messages: ChatMessage[], config: AiConfig): Promise<string> {
  if ((config.provider === 'openai' || config.provider === 'openrouter') && !config.apiKey) {
    throw new Error(`${config.provider} API key is not configured`);
  }

  const headers: Record<string, string> = {};
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const data = await postJson(config.endpoint || providerDefaultEndpoint(config.provider), {
    model: config.model,
    messages,
    temperature: 0.2,
  }, headers);

  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('LLM response did not include text content');
  }
  return content;
}

async function postJson(endpoint: string, body: unknown, headers: Record<string, string>): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`LLM request failed with ${response.status}: ${text.slice(0, 500)}`);
    }

    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timeout);
  }
}

async function getJson(endpoint: string, headers: Record<string, string>): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json', ...headers },
      signal: controller.signal,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Model list request failed with ${response.status}: ${text.slice(0, 500)}`);
    }

    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timeout);
  }
}
