import { Router } from 'express';
import { query } from '../db';
import { authMiddleware, AuthenticatedRequest } from '../middleware';
import {
  ChatMessage,
  availableProviders,
  assertEndpointAllowed,
  completeWithUserSettings,
  extractJsonObject,
  isSupportedProvider,
  listModels,
  resolveAiConfig,
} from '../services/intelligence';

const router = Router();
router.use(authMiddleware);

router.get('/config', async (req: AuthenticatedRequest, res, next) => {
  try {
    const config = await resolveAiConfig(req.user!.id);
    res.json({
      provider: config.provider,
      model: config.model,
      endpoint: config.endpoint,
      hasApiKey: Boolean(config.apiKey),
      providers: availableProviders(),
    });
  } catch (err) { next(err); }
});

router.put('/config', async (req: AuthenticatedRequest, res, next) => {
  try {
    const updates = pickAiConfigUpdates(req.body);
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No AI config fields provided' });
      return;
    }
    if (updates.aiProvider && !isSupportedProvider(updates.aiProvider)) {
      res.status(400).json({ error: `Unsupported AI provider: ${updates.aiProvider}` });
      return;
    }
    if (updates.aiEndpoint) {
      assertEndpointAllowed(updates.aiEndpoint);
    }

    for (const [key, value] of Object.entries(updates)) {
      await query(
        `INSERT INTO settings (user_id, key, value) VALUES ($1,$2,$3)
         ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [req.user!.id, key, value]
      );
    }

    const config = await resolveAiConfig(req.user!.id);
    res.json({
      provider: config.provider,
      model: config.model,
      endpoint: config.endpoint,
      hasApiKey: Boolean(config.apiKey),
      providers: availableProviders(),
    });
  } catch (err) { next(err); }
});

router.post('/test', async (req: AuthenticatedRequest, res, next) => {
  try {
    const completion = await completeWithUserSettings(req.user!.id, [
      { role: 'system', content: 'You are a concise health check for an invoice app AI service.' },
      { role: 'user', content: 'Reply with a short sentence confirming the model is ready.' },
    ], aiOverrides(req.body));
    res.json({ ok: true, provider: completion.provider, model: completion.model, response: completion.content });
  } catch (err: any) {
    res.status(502).json({ ok: false, error: 'AI provider request failed', message: err.message });
  }
});

router.get('/models', async (req: AuthenticatedRequest, res) => {
  try {
    const config = await resolveAiConfig(req.user!.id, aiOverrides(req.query));
    const models = await listModels(config);
    res.json({ provider: config.provider, endpoint: config.endpoint, models });
  } catch (err: any) {
    res.status(502).json({ error: 'Could not list AI models', message: err.message });
  }
});

router.post('/chat', async (req: AuthenticatedRequest, res) => {
  try {
    const messages = normalizeMessages(req.body);
    if (messages.length === 0) { res.status(400).json({ error: 'Missing message' }); return; }

    const completion = await completeWithUserSettings(req.user!.id, [
      { role: 'system', content: 'You are InvoiceSmart, an accounting assistant for invoices, expenses, VAT, CIS, and client payments. Be practical and concise.' },
      ...messages,
    ], aiOverrides(req.body));

    res.json({ response: completion.content, provider: completion.provider, model: completion.model });
  } catch (err: any) {
    console.error('AI chat error:', err);
    res.status(502).json({ error: 'AI service unavailable', message: err.message });
  }
});

router.post('/generate-invoice', async (req: AuthenticatedRequest, res) => {
  try {
    const { description } = req.body;
    if (!description || typeof description !== 'string') {
      res.status(400).json({ error: 'Missing description' });
      return;
    }

    const completion = await completeWithUserSettings(req.user!.id, [
      { role: 'system', content: 'Return only valid JSON. Do not include markdown or commentary.' },
      {
        role: 'user',
        content: [
          'Generate an invoice draft from this description.',
          'Required JSON fields: clientName, items, issueDate, dueDate, taxRate, notes.',
          'items must be an array of objects with description, quantity, unitPrice.',
          `Description: ${description}`,
        ].join('\n'),
      },
    ], aiOverrides(req.body));

    let invoice: unknown;
    try {
      invoice = extractJsonObject(completion.content);
    } catch {
      res.status(422).json({ error: 'Generated response is not valid JSON', raw: completion.content });
      return;
    }
    if (typeof invoice !== 'object' || invoice === null || Array.isArray(invoice)) {
      res.status(422).json({ error: 'Generated JSON is not a valid invoice object', raw: completion.content });
      return;
    }

    res.json({ invoice, provider: completion.provider, model: completion.model });
  } catch (err: any) {
    res.status(502).json({ error: 'AI service unavailable', message: err.message });
  }
});

router.get('/summarize-pl', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const [invRes, txnRes, catRes] = await Promise.all([
      query(`SELECT COALESCE(SUM(amount_paid),0)::numeric as revenue FROM invoices WHERE user_id = $1 AND status = 'paid'`, [userId]),
      query(`SELECT COALESCE(SUM(amount),0)::numeric as expenses FROM transactions WHERE user_id = $1 AND type = 'expense'`, [userId]),
      query(`SELECT category, COALESCE(SUM(amount),0)::numeric as total FROM transactions WHERE user_id = $1 AND type = 'expense' GROUP BY category ORDER BY total DESC LIMIT 5`, [userId]),
    ]);
    const revenue = parseFloat(invRes.rows[0]?.revenue || '0');
    const expenses = parseFloat(txnRes.rows[0]?.expenses || '0');
    const profit = revenue - expenses;
    const categories = catRes.rows.map((row: any) => ({ category: row.category || 'Uncategorized', amount: parseFloat(row.total || '0') }));
    const fallback = fallbackPlSummary(revenue, expenses, profit);
    const insight = await optionalJsonInsight(userId, [
      { role: 'system', content: 'Return only JSON with keys summary, recommendations, riskAssessment.' },
      { role: 'user', content: `Analyze this P&L context: ${JSON.stringify({ revenue, expenses, profit, categories })}` },
    ], fallback);
    res.json({ ...insight.payload, metrics: { revenue, expenses, profit, categories }, ai: insight.ai });
  } catch (err) { next(err); }
});

router.get('/who-owes-me', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const result = await query(`
      SELECT c.id, c.name, c.email, i.invoice_number, i.total_amount, i.amount_due, i.status, i.due_date
      FROM clients c
      JOIN invoices i ON i.client_id = c.id
      WHERE c.user_id = $1 AND i.amount_due > 0 AND i.status IN ('sent', 'partial', 'draft')
      ORDER BY c.name, i.due_date ASC
    `, [userId]);
    const grouped: Record<string, any> = {};
    result.rows.forEach((row: any) => {
      if (!grouped[row.id]) {
        grouped[row.id] = { clientId: row.id, clientName: row.name, email: row.email, amount: 0, invoices: [] };
      }
      grouped[row.id].amount += parseFloat(row.amount_due);
      grouped[row.id].invoices.push({ id: row.invoice_number, total_amount: row.total_amount, amount_due: row.amount_due, status: row.status, due_date: row.due_date });
    });
    res.json({ clients: Object.values(grouped) });
  } catch (err) { next(err); }
});

router.get('/tax-advice', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const [vatRes, paidRes, expenseRes] = await Promise.all([
      query(`SELECT COALESCE(SUM(tax_amount),0)::numeric as total FROM invoices WHERE user_id = $1`, [userId]),
      query(`SELECT COALESCE(SUM(amount_paid),0)::numeric as paid FROM invoices WHERE user_id = $1 AND status = 'paid'`, [userId]),
      query(`SELECT COALESCE(SUM(amount),0)::numeric as expenses FROM transactions WHERE user_id = $1 AND type = 'expense'`, [userId]),
    ]);
    const vatDue = parseFloat(vatRes.rows[0]?.total || '0');
    const paidRevenue = parseFloat(paidRes.rows[0]?.paid || '0');
    const expenses = parseFloat(expenseRes.rows[0]?.expenses || '0');
    const fallback = fallbackTaxAdvice(vatDue, paidRevenue);
    const insight = await optionalJsonInsight(userId, [
      { role: 'system', content: 'Return only JSON with keys tips, risks, opportunities. Use UK small-business context, but do not present legal advice as certainty.' },
      { role: 'user', content: `Give tax workflow guidance for: ${JSON.stringify({ vatDue, paidRevenue, expenses })}` },
    ], fallback);
    res.json({ ...insight.payload, metrics: { vatDue, paidRevenue, expenses }, ai: insight.ai });
  } catch (err) { next(err); }
});

router.get('/audit-invoice/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const invRes = await query(`SELECT * FROM invoices WHERE id = $1 AND user_id = $2`, [req.params.id, userId]);
    if (invRes.rowCount === 0) { res.status(404).json({ error: 'Invoice not found' }); return; }
    const invoice = invRes.rows[0];
    const linesRes = await query(`SELECT * FROM invoice_line_items WHERE invoice_id = $1 ORDER BY sort_order`, [req.params.id]);
    const items = linesRes.rows;
    const fallback = fallbackInvoiceAudit(invoice, items);
    const insight = await optionalJsonInsight(userId, [
      { role: 'system', content: 'Return only JSON with keys taxCompliance, cisVatImplications, lineItemSuggestions, generalFeedback.' },
      { role: 'user', content: `Audit this invoice for workflow, tax, CIS/VAT, and line item issues: ${JSON.stringify({ invoice, items })}` },
    ], fallback);
    res.json({ ...insight.payload, ai: insight.ai });
  } catch (err) { next(err); }
});

function aiOverrides(body: any): { provider?: string; model?: string; endpoint?: string; apiKey?: string } {
  return {
    provider: typeof body?.provider === 'string' ? body.provider : undefined,
    model: typeof body?.model === 'string' ? body.model : undefined,
    endpoint: typeof body?.endpoint === 'string' ? body.endpoint : undefined,
    apiKey: typeof body?.apiKey === 'string' ? body.apiKey : undefined,
  };
}

function pickAiConfigUpdates(body: any): Record<string, string> {
  const updates: Record<string, string> = {};
  if (typeof body?.provider === 'string') updates.aiProvider = body.provider;
  if (typeof body?.aiProvider === 'string') updates.aiProvider = body.aiProvider;
  if (typeof body?.model === 'string') updates.aiModel = body.model;
  if (typeof body?.aiModel === 'string') updates.aiModel = body.aiModel;
  if (typeof body?.endpoint === 'string') updates.aiEndpoint = body.endpoint;
  if (typeof body?.aiEndpoint === 'string') updates.aiEndpoint = body.aiEndpoint;
  if (typeof body?.apiKey === 'string' && body.apiKey !== '********') updates.aiApiKey = body.apiKey;
  if (typeof body?.aiApiKey === 'string' && body.aiApiKey !== '********') updates.aiApiKey = body.aiApiKey;
  return updates;
}

function normalizeMessages(body: any): ChatMessage[] {
  if (Array.isArray(body?.messages)) {
    return body.messages
      .filter((message: any) => ['system', 'user', 'assistant'].includes(message?.role) && typeof message?.content === 'string')
      .map((message: any) => ({ role: message.role, content: message.content }));
  }
  if (typeof body?.message === 'string') {
    return [{ role: 'user', content: body.message }];
  }
  return [];
}

async function optionalJsonInsight(userId: string, messages: ChatMessage[], fallback: any): Promise<{ payload: any; ai: any }> {
  try {
    const completion = await completeWithUserSettings(userId, messages);
    const payload = extractJsonObject(completion.content);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('Insight response was not a JSON object');
    }
    return { payload, ai: { source: 'llm', provider: completion.provider, model: completion.model } };
  } catch (err: any) {
    return { payload: fallback, ai: { source: 'fallback', error: err.message } };
  }
}

function fallbackPlSummary(revenue: number, expenses: number, profit: number) {
  const summary = `Revenue: GBP ${revenue.toFixed(2)}, Expenses: GBP ${expenses.toFixed(2)}, Net Profit: GBP ${profit.toFixed(2)}`;
  return {
    summary,
    recommendations: [
      { type: 'general', title: 'P&L Summary', description: summary, actionableStep: 'Review top expense categories and overdue invoices.' },
    ],
    riskAssessment: profit >= 0 ? 'Healthy' : 'Loss detected - review expenses and outstanding payments.',
  };
}

function fallbackTaxAdvice(vatDue: number, paidRevenue: number) {
  const risks = paidRevenue > 85000 ? ['VAT threshold may be exceeded - confirm registration status.'] : [];
  if (vatDue > 0) risks.push(`Estimated VAT tracked on invoices: GBP ${vatDue.toFixed(2)}.`);
  return {
    tips: ['Keep receipts and invoice records organized for tax review.', 'Review VAT treatment before filing.'],
    risks,
    opportunities: ['Categorize expenses consistently.', 'Review quarterly reporting before deadlines.'],
  };
}

function fallbackInvoiceAudit(invoice: any, items: any[]) {
  const issues: any[] = [];
  if (!invoice.client_id) issues.push({ id: 'no-client', issue: 'No client linked', suggestedDescription: 'Select a client for this invoice.' });
  if (!invoice.due_date) issues.push({ id: 'no-due-date', issue: 'Missing due date', suggestedDescription: 'Set a payment deadline.' });
  if (items.length === 0) issues.push({ id: 'no-line-items', issue: 'No line items', suggestedDescription: 'Add at least one billable line item.' });
  return {
    taxCompliance: invoice.tax_rate > 0 ? ['VAT/tax amount is present; verify rate against the selected tax rule.'] : ['No tax rate applied; verify whether the invoice is zero-rated or exempt.'],
    cisVatImplications: invoice.cis_rate > 0 ? [`CIS deduction at ${invoice.cis_rate}% is applied.`] : ['No CIS deduction on this invoice.'],
    lineItemSuggestions: issues,
    generalFeedback: issues.length > 0 ? ['Invoice needs attention before sending.'] : ['Invoice audit complete.'],
  };
}

export default router;
