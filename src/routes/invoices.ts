import { Router } from 'express';
import { query, transaction } from '../db';
import { authMiddleware, AuthenticatedRequest } from '../middleware';
import { calculateInvoiceTotals, generateInvoiceNumber } from '../utils';

const router = Router();

router.use(authMiddleware);

router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const status = req.query.status as string | undefined;
    const userId = req.user!.id;
    let sql = 'SELECT * FROM invoices WHERE user_id = $1 ORDER BY created_at DESC';
    const params: any[] = [userId];
    if (status) {
      sql = 'SELECT * FROM invoices WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC';
      params.push(status);
    }
    const result = await query(sql, params);
    const countRes = await query('SELECT COUNT(*)::int as total FROM invoices WHERE user_id = $1', [userId]);
    const total = countRes.rows[0]?.total || 0;
    res.json({ data: result.rows, pagination: { page: 1, limit: total, total, totalPages: 1 } });
  } catch (err) { next(err); }
});

router.get('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await query('SELECT * FROM invoices WHERE id = $1 AND user_id = $2', [req.params.id, req.user!.id]);
    if (result.rowCount === 0) { res.status(404).json({ error: 'Invoice not found' }); return; }
    const invoice = result.rows[0];
    const linesResult = await query('SELECT * FROM invoice_line_items WHERE invoice_id = $1 ORDER BY sort_order', [req.params.id]);
    const transactionsResult = await query('SELECT * FROM transactions WHERE invoice_id = $1 ORDER BY transaction_date DESC', [req.params.id]);
    res.json({ ...invoice, line_items: linesResult.rows, transactions: transactionsResult.rows });
  } catch (err) { next(err); }
});

router.get('/next/number', async (req: AuthenticatedRequest, res, next) => {
  try {
    const prefix = (req.query.prefix as string) || 'INV';
    const autoIncrement = req.query.autoIncrement !== 'false';
    const invoiceNumber = await generateInvoiceNumber(prefix, autoIncrement, req.user!.id);
    res.json({ invoiceNumber });
  } catch (err) { next(err); }
});

router.post('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const { client_id, status, issue_date, due_date, notes, terms, tax_rate, discount_rate, retention_rate, cis_rate, line_items } = req.body;
    const prefix = req.body.invoice_prefix || 'INV';
    const autoIncrement = req.body.auto_increment !== false;
    const invoiceNumber = await generateInvoiceNumber(prefix, autoIncrement, userId);

    const totals = calculateInvoiceTotals(line_items || [], tax_rate || 0, discount_rate || 0, retention_rate || 0, cis_rate || 0);

    const invoiceResult = await query(
      `INSERT INTO invoices (user_id, client_id, invoice_number, status, issue_date, due_date, subtotal, tax_rate, tax_amount, discount_rate, discount_amount, retention_rate, retention_amount, cis_rate, cis_amount, total_amount, amount_paid, amount_due, notes, terms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [userId, client_id || null, invoiceNumber, status || 'draft', issue_date || null, due_date || null,
       totals.subtotal, tax_rate || 0, totals.taxAmount, discount_rate || 0, totals.discountAmount,
       retention_rate || 0, totals.retentionAmount, cis_rate || 0, totals.cisAmount,
       totals.totalAmount, 0, totals.totalAmount, notes || null, terms || null]
    );
    const invoice = invoiceResult.rows[0];

    if (line_items && line_items.length > 0) {
      for (let i = 0; i < line_items.length; i++) {
        const li = line_items[i];
        await query(
          'INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order) VALUES ($1,$2,$3,$4,$5,$6)',
          [invoice.id, li.description, li.quantity || 1, li.unit_price || 0, (li.quantity || 0) * (li.unit_price || 0), i]
        );
      }
    }

    res.status(201).json(invoice);
  } catch (err) { next(err); }
});

router.put('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const { client_id, status, issue_date, due_date, notes, terms, tax_rate, discount_rate, retention_rate, cis_rate, line_items } = req.body;
    const existing = await query('SELECT * FROM invoices WHERE id = $1 AND user_id = $2', [req.params.id, userId]);
    if (existing.rowCount === 0) { res.status(404).json({ error: 'Invoice not found' }); return; }

    const totals = calculateInvoiceTotals(line_items || [], tax_rate || 0, discount_rate || 0, retention_rate || 0, cis_rate || 0);
    const updated = await query(
      `UPDATE invoices SET client_id = $1, status = $2, issue_date = $3, due_date = $4, subtotal = $5, tax_rate = $6, tax_amount = $7, discount_rate = $8, discount_amount = $9, retention_rate = $10, retention_amount = $11, cis_rate = $12, cis_amount = $13, total_amount = $14, amount_due = $15, notes = $16, terms = $17, updated_at = NOW() WHERE id = $18 RETURNING *`,
      [client_id || null, status || existing.rows[0].status, issue_date || existing.rows[0].issue_date, due_date || existing.rows[0].due_date,
       totals.subtotal, tax_rate || 0, totals.taxAmount, discount_rate || 0, totals.discountAmount,
       retention_rate || 0, totals.retentionAmount, cis_rate || 0, totals.cisAmount,
       totals.totalAmount, totals.totalAmount - existing.rows[0].amount_paid, notes || existing.rows[0].notes, terms || existing.rows[0].terms, req.params.id]
    );
    const invoice = updated.rows[0];

    if (line_items && Array.isArray(line_items)) {
      await query('DELETE FROM invoice_line_items WHERE invoice_id = $1', [req.params.id]);
      for (let i = 0; i < line_items.length; i++) {
        const li = line_items[i];
        await query(
          'INSERT INTO invoice_line_items (invoice_id, description, quantity, unit_price, amount, sort_order) VALUES ($1,$2,$3,$4,$5,$6)',
          [req.params.id, li.description, li.quantity || 1, li.unit_price || 0, (li.quantity || 0) * (li.unit_price || 0), i]
        );
      }
    }

    res.json(invoice);
  } catch (err) { next(err); }
});

router.post('/:id/send', async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await query("UPDATE invoices SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id", [req.params.id, req.user!.id]);
    if (result.rowCount === 0) { res.status(404).json({ error: 'Invoice not found' }); return; }
    res.json({ success: true, status: 'sent' });
  } catch (err) { next(err); }
});

router.patch('/:id/paid', async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await query("UPDATE invoices SET status = 'paid', amount_paid = total_amount, amount_due = 0, paid_at = NOW(), updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *", [req.params.id, req.user!.id]);
    if (result.rowCount === 0) { res.status(404).json({ error: 'Invoice not found' }); return; }
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

router.get('/:id/pdf', async (_req: AuthenticatedRequest, res) => {
  res.json({ url: 'https://demo.pdf' });
});

router.delete('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await query('DELETE FROM invoices WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.user!.id]);
    if (result.rowCount === 0) { res.status(404).json({ error: 'Invoice not found' }); return; }
    res.status(204).send();
  } catch (err) { next(err); }
});

router.post('/:id/payments', async (req: AuthenticatedRequest, res, next) => {
  try {
    const { amount, payment_method, reference, notes } = req.body;
    if (!amount || amount <= 0) { res.status(400).json({ error: 'Invalid amount' }); return; }
    const invoiceRes = await query('SELECT * FROM invoices WHERE id = $1 AND user_id = $2', [req.params.id, req.user!.id]);
    if (invoiceRes.rowCount === 0) { res.status(404).json({ error: 'Invoice not found' }); return; }
    const invoice = invoiceRes.rows[0];

    await transaction(async (client) => {
      await client.query(
        'INSERT INTO transactions (invoice_id, type, amount, transaction_date, payment_method, reference, notes) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [req.params.id, 'payment', amount, new Date().toISOString().slice(0, 10), payment_method || null, reference || null, notes || null]
      );
      const newPaid = (parseFloat(invoice.amount_paid) || 0) + parseFloat(amount);
      const newDue = parseFloat(invoice.total_amount) - newPaid;
      let newStatus = invoice.status;
      if (newDue <= 0) newStatus = 'paid';
      else if (newPaid > 0) newStatus = 'partial';
      await client.query(
        'UPDATE invoices SET amount_paid = $1, amount_due = $2, status = $3, updated_at = NOW() WHERE id = $4',
        [newPaid, Math.max(0, newDue), newStatus, req.params.id]
      );
    });

    res.status(201).json({ success: true });
  } catch (err) { next(err); }
});

export default router;
