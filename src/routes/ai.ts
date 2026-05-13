import { Router } from 'express';
import { query } from '../db';
import { authMiddleware, AuthenticatedRequest } from '../middleware';

const router = Router();
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434/api/generate';
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || 'llama3';

// POST /api/ai/chat — proxy chat to Ollama
router.post('/chat', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { message, model = DEFAULT_MODEL } = req.body;
    if (!message) { res.status(400).json({ error: 'Missing message' }); return; }
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: message, stream: false }),
    });
    if (!response.ok) { res.status(502).json({ error: 'Ollama unavailable' }); return; }
    const data = await response.json() as { response?: string };
    res.json({ response: data.response || '' });
  } catch (err: any) {
    console.error('AI chat error:', err);
    res.status(500).json({ error: 'AI service unavailable', message: err.message });
  }
});

// POST /api/ai/generate-invoice
router.post('/generate-invoice', authMiddleware, async (req: AuthenticatedRequest, res) => {
  try {
    const { description, model = DEFAULT_MODEL } = req.body;
    if (!description) { res.status(400).json({ error: 'Missing description' }); return; }
    const prompt = `Generate an invoice JSON for ${description}. Return ONLY valid JSON with: clientName, items (array of {description, quantity, unitPrice}), issueDate, dueDate, taxRate.`;
    const response = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
    });
    if (!response.ok) { res.status(502).json({ error: 'Ollama unavailable' }); return; }
    const raw = await response.json() as { response?: string };
    let jsonStr = (raw.response || '').trim();
    if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
    if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
    if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
    jsonStr = jsonStr.trim();
    let parsed;
    try { parsed = JSON.parse(jsonStr); } catch { parsed = { raw: jsonStr }; }
    res.json({ invoice: parsed });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/ai/summarize-pl
router.get('/summarize-pl', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const [invRes, txnRes] = await Promise.all([
      query(`SELECT COALESCE(SUM(total_amount),0)::numeric as revenue FROM invoices WHERE user_id = $1 AND status = 'paid'`, [userId]),
      query(`SELECT COALESCE(SUM(amount),0)::numeric as expenses FROM transactions WHERE user_id = $1 AND type = 'expense'`, [userId]),
    ]);
    const revenue = parseFloat(invRes.rows[0]?.revenue || '0');
    const expenses = parseFloat(txnRes.rows[0]?.expenses || '0');
    const profit = revenue - expenses;
    const summary = `Revenue: £${revenue.toFixed(2)}, Expenses: £${expenses.toFixed(2)}, Net Profit: £${profit.toFixed(2)}`;
    res.json({
      summary,
      recommendations: [
        { type: 'general', title: 'P&L Summary', description: summary, actionableStep: 'Review spending categories in Reports' },
      ],
      riskAssessment: profit >= 0 ? 'Healthy' : 'Loss detected — review expenses',
    });
  } catch (err) { next(err); }
});

// GET /api/ai/who-owes-me
router.get('/who-owes-me', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const result = await query(`
      SELECT c.id, c.name, c.email, i.invoice_number, i.total_amount, i.amount_due, i.status
      FROM clients c
      JOIN invoices i ON i.client_id = c.id
      WHERE c.user_id = $1 AND i.amount_due > 0 AND i.status IN ('sent', 'partial', 'draft')
      ORDER BY c.name, i.due_date ASC
    `, [userId]);
    const grouped: Record<string, any> = {};
    result.rows.forEach((row: any) => {
      if (!grouped[row.id]) {
        grouped[row.id] = { clientId: row.id, clientName: row.name, amount: 0, invoices: [] };
      }
      grouped[row.id].amount += parseFloat(row.amount_due);
      grouped[row.id].invoices.push({ id: row.invoice_number, total_amount: row.total_amount, amount_due: row.amount_due, status: row.status });
    });
    res.json({ clients: Object.values(grouped) });
  } catch (err) { next(err); }
});

// GET /api/ai/tax-advice
router.get('/tax-advice', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const [vatRes, profitRes] = await Promise.all([
      query(`SELECT COALESCE(SUM(tax_amount),0)::numeric as total FROM invoices WHERE user_id = $1`, [userId]),
      query(`SELECT COALESCE(SUM(total_amount),0)::numeric as revenue, COALESCE(SUM(amount_paid),0)::numeric as paid FROM invoices WHERE user_id = $1 AND status = 'paid'`, [userId]),
    ]);
    const vatDue = parseFloat(vatRes.rows[0]?.total || '0');
    const revenue = parseFloat(profitRes.rows[0]?.revenue || '0');
    const tips = [
      'Keep all receipts for 6 years for HMRC compliance',
      'Consider VAT Flat Rate Scheme if turnover is under £150,000',
    ];
    const risks = revenue > 85000 ? ['VAT threshold exceeded — ensure VAT registration'] : [];
    if (vatDue > 0) risks.push(`Estimated VAT due: £${vatDue.toFixed(2)}`);
    res.json({ tips, risks, opportunities: ['Explore capital allowances for equipment purchases', 'Review quarterly reporting to avoid penalties'] });
  } catch (err) { next(err); }
});

// GET /api/ai/audit-invoice/:id
router.get('/audit-invoice/:id', authMiddleware, async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const invRes = await query(`SELECT * FROM invoices WHERE id = $1 AND user_id = $2`, [req.params.id, userId]);
    if (invRes.rowCount === 0) { res.status(404).json({ error: 'Invoice not found' }); return; }
    const invoice = invRes.rows[0];
    const linesRes = await query(`SELECT * FROM invoice_line_items WHERE invoice_id = $1`, [req.params.id]);
    const items = linesRes.rows;
    const issues: any[] = [];
    if (!invoice.client_id) issues.push({ id: 'no-client', issue: 'No client linked', suggestedDescription: 'Select a client for this invoice' });
    if (!invoice.due_date) issues.push({ id: 'no-due', issue: 'Missing due date', suggestedDescription: 'Set a payment deadline' });
    if (items.length === 0) issues.push({ id: 'no-items', issue: 'No line items', suggestedDescription: 'Add at least one line item' });
    res.json({
      taxCompliance: invoice.tax_rate > 0 ? ['VAT applied correctly'] : ['Zero-rated invoice — verify with tax rules'],
      cisVatImplications: invoice.cis_rate > 0 ? [`CIS deduction at ${invoice.cis_rate}% applied`] : ['No CIS deduction on this invoice'],
      lineItemSuggestions: issues,
      generalFeedback: ['Invoice audit complete'],
    });
  } catch (err) { next(err); }
});

export default router;
