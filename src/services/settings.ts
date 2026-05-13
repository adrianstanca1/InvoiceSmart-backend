import { query } from '../db';

export interface AppSettings {
  aiProvider: string;
  aiModel: string;
  aiEndpoint: string;
  aiApiKey?: string;
  invoicePrefix: string;
  autoIncrement: boolean;
  defaultCurrency: string;
  defaultTaxRate: number;
  defaultTerms: string;
  defaultPaymentGateway: string;
  theme: string;
  notificationsEnabled: boolean;
  emailNotifications: boolean;
}

export const defaultSettings: AppSettings = {
  aiProvider: process.env.AI_PROVIDER || 'ollama',
  aiModel: process.env.AI_MODEL || process.env.OLLAMA_MODEL || 'llama3',
  aiEndpoint: process.env.AI_ENDPOINT || '',
  invoicePrefix: 'INV-',
  autoIncrement: true,
  defaultCurrency: 'GBP',
  defaultTaxRate: 20,
  defaultTerms: 'Payment due within 30 days.',
  defaultPaymentGateway: 'none',
  theme: 'system',
  notificationsEnabled: true,
  emailNotifications: false,
};

export async function getUserSettings(userId: string): Promise<AppSettings> {
  const result = await query('SELECT key, value FROM settings WHERE user_id = $1', [userId]);
  const stored: Record<string, unknown> = {};
  result.rows.forEach((row: { key: string; value: string | null }) => {
    stored[row.key] = parseSettingValue(row.value);
  });

  return { ...defaultSettings, ...stored } as AppSettings;
}

function parseSettingValue(value: string | null): unknown {
  if (value == null) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
