import { Statement } from '@/lib/accounts'
import { formatIST } from '@/lib/formatDate'
import { formatMoney, CurrencyCode } from '@/lib/currency'

// Opens a print window for a period Profit & Loss statement, rendered from a
// computed Statement object (lib/accounts.ts) in the org's currency. Unlike
// invoices/payslips there's no frozen snapshot table — a statement is
// generated on demand from live data, so a re-print reflects the data as it
// stands. Mirrors lib/printInvoice.ts / lib/printPayslip.ts.
export function printStatement(statement: Statement, orgName: string) {
  const win = window.open('', '_blank', 'width=720,height=900')
  if (!win) return

  const cur = statement.currency as CurrencyCode
  const fmt = (n: number) => formatMoney(n, { currency: cur })

  const revenueLines = statement.revenue.lines
    .map(
      (l) =>
        `<div class="line"><span>${escapeHtml(l.guest)} · Room ${escapeHtml(l.room)} · ${l.nights} nt${l.nights === 1 ? '' : 's'}</span><span>${fmt(l.total)}</span></div>`
    )
    .join('')

  const revenueCats = statement.revenue.byCategory
    .map((c) => `<div class="line sub"><span>${escapeHtml(c.label)}</span><span>${fmt(c.amount)}</span></div>`)
    .join('')

  const expenseCats = statement.expenses.byCategory
    .map(
      (c) =>
        `<div class="line"><span>${escapeHtml(c.label)}${c.key === 'payroll' ? ' <em>(from payroll)</em>' : ''}</span><span>${fmt(c.amount)}</span></div>`
    )
    .join('')

  const expenseDetail = statement.expenses.lines.length
    ? `<div class="section-title">Operating expenses (itemized)</div>` +
      statement.expenses.lines
        .map(
          (l) =>
            `<div class="line sub"><span>${escapeHtml(l.date)} · ${escapeHtml(l.categoryLabel)} — ${escapeHtml(l.description)}${l.vendor ? ` · ${escapeHtml(l.vendor)}` : ''}</span><span>${fmt(l.amount)}</span></div>`
        )
        .join('')
    : ''

  const net = statement.net
  const netColor = net >= 0 ? '#047857' : '#b91c1c'
  const netLabel = net >= 0 ? 'Net Profit' : 'Net Loss'

  win.document.write(`
    <html>
      <head>
        <title>Financial Statement — ${escapeHtml(statement.label)}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 28px; color: #111; max-width: 640px; margin: 0 auto; }
          h1 { font-size: 20px; margin: 0 0 2px; }
          .muted { color: #666; font-size: 12px; margin: 0 0 20px; }
          .section-title { font-size: 12px; font-weight: bold; color: #444; margin: 20px 0 6px;
            text-transform: uppercase; letter-spacing: 0.03em; border-bottom: 1px solid #eee; padding-bottom: 4px; }
          .line { display: flex; justify-content: space-between; font-size: 13px; margin: 4px 0; gap: 16px; }
          .line span:last-child { white-space: nowrap; font-variant-numeric: tabular-nums; }
          .line.sub { color: #666; font-size: 12px; padding-left: 12px; }
          .line em { color: #999; font-style: italic; }
          .total { display: flex; justify-content: space-between; font-weight: bold; font-size: 15px;
            border-top: 1px solid #ccc; padding-top: 8px; margin-top: 8px; }
          .note { color: #666; font-size: 11px; margin-top: 4px; }
          .grand { display: flex; justify-content: space-between; font-weight: bold; font-size: 22px;
            border-top: 2px solid #333; padding-top: 12px; margin-top: 16px; }
          .printed { color: #999; font-size: 11px; margin-top: 28px; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(orgName)} — Financial Statement</h1>
        <p class="muted">
          Profit &amp; Loss · ${escapeHtml(statement.label)}<br />
          ${statement.from} &rarr; ${statement.to}
        </p>

        <div class="section-title">Revenue (earned) — by reservation</div>
        ${revenueLines || '<div class="line"><span>No reservations in this period</span><span>' + fmt(0) + '</span></div>'}
        <div class="section-title">Revenue by category</div>
        ${revenueCats}
        <div class="total"><span>Total Revenue (earned)</span><span>${fmt(statement.revenue.total)}</span></div>
        <p class="note">Cash received this period: ${fmt(statement.revenue.received)} · Outstanding on these stays: ${fmt(statement.revenue.outstanding)}</p>

        <div class="section-title">Expenses — by category</div>
        ${expenseCats || '<div class="line"><span>No expenses in this period</span><span>' + fmt(0) + '</span></div>'}
        <div class="total"><span>Total Expenses</span><span>${fmt(statement.expenses.total)}</span></div>
        ${expenseDetail}

        <div class="grand" style="color: ${netColor};"><span>${netLabel}</span><span>${fmt(net)}</span></div>

        <p class="printed">Generated ${formatIST(new Date().toISOString())} · accrual basis (revenue recognized by stay date)</p>
      </body>
    </html>
  `)
  win.document.close()
  win.focus()
  win.print()
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
