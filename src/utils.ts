import { query } from './db';

export interface InvoiceLineItemInput {
  quantity: number;
  unit_price: number;
}

export interface InvoiceTotals {
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmount: number;
  retentionAmount: number;
  cisAmount: number;
  totalAmount: number;
}

// Advisory lock key space for invoice number generation.
// Hash the userId + prefix into a 64-bit bigint safe for pg_advisory_lock.
function advisoryLockKey(userId: string, prefix: string): number {
  let hash = 0;
  const str = userId + ':' + prefix;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  // Force positive and within 31-bit safe int range
  return Math.abs(hash) % 2_147_483_647;
}

export async function generateInvoiceNumber(
  prefix: string,
  autoIncrement: boolean,
  userId: string
): Promise<string> {
  if (!autoIncrement) {
    return `${prefix}-${Date.now()}`;
  }

  // Use a per-user+prefix advisory lock to prevent race conditions.
  const lockId = advisoryLockKey(userId, prefix);
  await query('SELECT pg_advisory_lock($1)', [lockId]);

  try {
    const result = await query(
      `SELECT COUNT(*)::int AS count FROM invoices WHERE user_id = $1 AND invoice_number LIKE $2`,
      [userId, `${prefix}-%`]
    );

    const count = result.rows[0]?.count || 0;
    const nextNumber = count + 1;
    const paddedNumber = nextNumber.toString().padStart(4, '0');

    return `${prefix}-${paddedNumber}`;
  } finally {
    // Always release the lock, even on error.
    await query('SELECT pg_advisory_unlock($1)', [lockId]).catch(() => {});
  }
}

export function calculateInvoiceTotals(
  lineItems: InvoiceLineItemInput[],
  taxRate: number,
  discountRate: number,
  retentionRate: number,
  cisRate: number
): InvoiceTotals {
  const subtotal = lineItems.reduce((sum, item) => {
    const lineTotal = (item.quantity || 0) * (item.unit_price || 0);
    return sum + lineTotal;
  }, 0);

  const discountAmount = subtotal * (discountRate / 100);
  const taxableAmount = subtotal - discountAmount;
  const taxAmount = taxableAmount * (taxRate / 100);
  const retentionAmount = taxableAmount * (retentionRate / 100);
  const cisAmount = taxableAmount * (cisRate / 100);
  const totalAmount = taxableAmount + taxAmount - retentionAmount - cisAmount;

  return {
    subtotal: round2(subtotal),
    discountAmount: round2(discountAmount),
    taxableAmount: round2(taxableAmount),
    taxAmount: round2(taxAmount),
    retentionAmount: round2(retentionAmount),
    cisAmount: round2(cisAmount),
    totalAmount: round2(totalAmount),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function validateVAT(vatNumber: string): boolean {
  if (!vatNumber || typeof vatNumber !== 'string') {
    return false;
  }

  const cleaned = vatNumber.replace(/[\s\.\-]/g, '').toUpperCase();

  if (cleaned.length < 3) {
    return false;
  }

  const countryCode = cleaned.substring(0, 2);
  const numberPart = cleaned.substring(2);

  const euPatterns: Record<string, RegExp> = {
    GB: /^(GD|HA)?\d{3,11}$/,
    AT: /^U\d{8}$/,
    BE: /^0\d{9}$/,
    BG: /^\d{9,10}$/,
    CY: /^\d{8}[A-Z]$/,
    CZ: /^\d{8,10}$/,
    DE: /^\d{9}$/,
    DK: /^\d{8}$/,
    EE: /^\d{9}$/,
    EL: /^\d{9}$/,
    ES: /^[A-Z]\d{7,8}[A-Z]$|^\d{8}[A-Z]$/,
    FI: /^\d{8}$/,
    FR: /^[A-Z]{2}\d{9}$|^\d{11}$/,
    HR: /^\d{11}$/,
    HU: /^\d{8}$/,
    IE: /^\d{7}[A-Z]{1,2}$/,
    IT: /^\d{11}$/,
    LT: /^\d{9,12}$/,
    LU: /^\d{8}$/,
    LV: /^\d{11}$/,
    MT: /^\d{8}$/,
    NL: /^\d{9}B\d{2}$/,
    PL: /^\d{10}$/,
    PT: /^\d{9}$/,
    RO: /^\d{2,10}$/,
    SE: /^\d{12}$/,
    SI: /^\d{8}$/,
    SK: /^\d{10}$/,
  };

  const pattern = euPatterns[countryCode];
  if (pattern && pattern.test(numberPart)) {
    return true;
  }

  const genericPattern = /^[A-Z]{2}[A-Z0-9]{2,13}$/;
  if (genericPattern.test(cleaned)) {
    return true;
  }

  return false;
}
