import { Router } from 'express';
import { query, transaction } from '../db';
import { applyUuidValidation, authMiddleware, AuthenticatedRequest } from '../middleware';
import { calculateInvoiceTotals, generateInvoiceNumber } from '../utils';
import { writeAudit } from '../lib/audit';

const router = Router();

router.use(authMiddleware);
applyUuidValidation(router, ['id']);

router.get('/', async (req: AuthenticatedRequest, res, next) => {
  try {
    const status = req.query.status as string | undefined;
    const userId = req.user!.id;
    let sql = 'SELECT * FROM invoices WHERE user_id = $1 ORDER BY created_at DESC';
    let countSql = 'SELECT COUNT(*)::int as total FROM invoices WHERE user_id = $1';
    const params: any[] = [userId];
    const countParams: any[] = [userId];
    if (status) {
      sql = 'SELECT * FROM invoices WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC';
      params.push(status);
      countSql = 'SELECT COUNT(*)::int as total FROM invoices WHERE user_id = $1 AND status = $2';
      countParams.push(status);
    }
    const result = await query(sql, params);
    const countRes = await query(countSql, countParams);
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

    await writeAudit({
      userId,
      entityType: 'invoice',
      entityId: invoice.id,
      action: 'create',
      newValues: invoice,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

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

    await writeAudit({
      userId,
      entityType: 'invoice',
      entityId: invoice.id,
      action: 'update',
      oldValues: existing.rows[0],
      newValues: invoice,
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    res.json(invoice);
  } catch (err) { next(err); }
});

router.post('/:id/send', async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await query("UPDATE invoices SET status = 'sent', sent_at = NOW(), updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id", [req.params.id, req.user!.id]);
    if (result.rowCount === 0) { res.status(404).json({ error: 'Invoice not found' }); return; }
    await writeAudit({
      userId: req.user!.id,
      entityType: 'invoice',
      entityId: req.params.id,
      action: 'send',
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });
    res.json({ success: true, status: 'sent' });
  } catch (err) { next(err); }
});

router.patch('/:id/paid', async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await query("UPDATE invoices SET status = 'paid', amount_paid = total_amount, amount_due = 0, paid_at = NOW(), updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *", [req.params.id, req.user!.id]);
    if (result.rowCount === 0) { res.status(404).json({ error: 'Invoice not found' }); return; }
    await writeAudit({
      userId: req.user!.id,
      entityType: 'invoice',
      entityId: req.params.id,
      action: 'mark_paid',
      newValues: result.rows[0],
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

router.get('/:id/pdf', async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await query(
      `SELECT i.*, c.name as client_name, c.email as client_email, c.company_name as client_company,
              c.vat_number as client_vat, c.address as client_address, c.phone as client_phone
       FROM invoices i
       LEFT JOIN clients c ON c.id = i.client_id
       WHERE i.id = $1 AND i.user_id = $2`,
      [req.params.id, req.user!.id]
    );
    if (result.rowCount === 0) { res.status(404).json({ error: 'Invoice not found' }); return; }
    const invoice = result.rows[0];

    const linesResult = await query('SELECT * FROM invoice_line_items WHERE invoice_id = $1 ORDER BY sort_order', [req.params.id]);
    const userResult = await query('SELECT first_name, last_name, company_name, vat_number, address, phone FROM users WHERE id = $1', [req.user!.id]);
    const user = userResult.rows[0] || {};

    const html = generateInvoiceHtml(invoice, linesResult.rows, user);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req: AuthenticatedRequest, res, next) => {
  try {
    const result = await query('DELETE FROM invoices WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.user!.id]);
    if (result.rowCount === 0) { res.status(404).json({ error: 'Invoice not found' }); return; }
    await writeAudit({
      userId: req.user!.id,
      entityType: 'invoice',
      entityId: req.params.id,
      action: 'delete',
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });
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
        'INSERT INTO transactions (user_id, invoice_id, type, amount, transaction_date, payment_method, reference, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [req.user!.id, req.params.id, 'payment', amount, new Date().toISOString().slice(0, 10), payment_method || null, reference || null, notes || null]
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

    await writeAudit({
      userId: req.user!.id,
      entityType: 'invoice',
      entityId: req.params.id,
      action: 'payment',
      newValues: { amount, payment_method, reference },
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    res.status(201).json({ success: true });
  } catch (err) { next(err); }
});

export default router;

function generateInvoiceHtml(invoice: any, lines: any[], user: any): string {
  const formatCurrency = (v: string | number) => `£${(parseFloat(String(v)) || 0).toFixed(2)}`;
  const formatDate = (d: string) => d ? new Date(d).toLocaleDateString('en-GB') : '-';
  const address = (addr: any) => {
    if (!addr) return '';
    if (typeof addr === 'string') try { addr = JSON.parse(addr); } catch { return addr; }
    return [addr.line1, addr.line2, addr.city, addr.postcode, addr.country].filter(Boolean).join('<br>');
  };

  const lineRows = lines.map((li, i) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee;">${i + 1}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;">${li.description || ''}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${li.quantity || 1}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${formatCurrency(li.unit_price)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${formatCurrency(li.amount)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Invoice ${invoice.invoice_number}</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 40px; color: #222; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
    .brand h1 { margin: 0 0 4px; }
    .meta { text-align: right; }
    .meta p { margin: 2px 0; }
    .columns { display: flex; gap: 40px; margin-bottom: 32px; }
    .box { flex: 1; }
    .box h3 { margin: 0 0 8px; font-size: 14px; text-transform: uppercase; color: #666; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th { text-align: left; padding: 8px; border-bottom: 2px solid #ccc; font-size: 12px; text-transform: uppercase; color: #666; }
    td { padding: 8px; }
    .totals { width: 320px; margin-left: auto; }
    .totals td { padding: 6px 8px; }
    .totals tr:last-child td { font-weight: 700; border-top: 2px solid #222; }
    .footer { margin-top: 40px; font-size: 12px; color: #666; }
    @media print { body { margin: 20px; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="brand">
      <h1>${user.company_name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Invoice'}</h1>
      <p>${address(user.address)}</p>
      ${user.phone ? `<p>${user.phone}</p>` : ''}
      ${user.vat_number ? `<p>VAT: ${user.vat_number}</p>` : ''}
    </div>
    <div class="meta">
      <h1>Invoice ${invoice.invoice_number}</h1>
      <p><strong>Status:</strong> ${invoice.status}</p>
      <p><strong>Issue date:</strong> ${formatDate(invoice.issue_date)}</p>
      <p><strong>Due date:</strong> ${formatDate(invoice.due_date)}</p>
    </div>
  </div>

  <div class="columns">
    <div class="box">
      <h3>Bill to</h3>
      <p><strong>${invoice.client_name || invoice.client_company || 'Client'}</strong></p>
      <p>${address(invoice.client_address)}</p>
      ${invoice.client_email ? `<p>${invoice.client_email}</p>` : ''}
      ${invoice.client_vat ? `<p>VAT: ${invoice.client_vat}</p>` : ''}
    </div>
    <div class="box">
      <h3>Notes</h3>
      <p>${invoice.notes || ''}</p>
    </div>
  </div>

  <table>
    <thead>
      <tr><th>#</th><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit price</th><th style="text-align:right">Amount</th></tr>
    </thead>
    <tbody>
      ${lineRows || '<tr><td colspan="5" style="color:#999;">No line items</td></tr>'}
    </tbody>
  </table>

  <table class="totals">
    <tr><td>Subtotal</td><td style="text-align:right">${formatCurrency(invoice.subtotal)}</td></tr>
    ${parseFloat(invoice.discount_amount) > 0 ? `<tr><td>Discount</td><td style="text-align:right">-${formatCurrency(invoice.discount_amount)}</td></tr>` : ''}
    ${parseFloat(invoice.cis_amount) > 0 ? `<tr><td>CIS</td><td style="text-align:right">-${formatCurrency(invoice.cis_amount)}</td></tr>` : ''}
    ${parseFloat(invoice.tax_amount) > 0 ? `<tr><td>Tax</td><td style="text-align:right">${formatCurrency(invoice.tax_amount)}</td></tr>` : ''}
    ${parseFloat(invoice.retention_amount) > 0 ? `<tr><td>Retention</td><td style="text-align:right">-${formatCurrency(invoice.retention_amount)}</td></tr>` : ''}
    <tr><td>Total</td><td style="text-align:right">${formatCurrency(invoice.total_amount)}</td></tr>
    <tr><td>Paid</td><td style="text-align:right">${formatCurrency(invoice.amount_paid)}</td></tr>
    <tr><td>Due</td><td style="text-align:right">${formatCurrency(invoice.amount_due)}</td></tr>
  </table>

  <div class="footer">
    ${invoice.terms ? `<p><strong>Terms:</strong> ${invoice.terms}</p>` : ''}
    <p>Generated by InvoiceSmart</p>
  </div>
</body>
</html>`;
}
