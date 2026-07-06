import { PayrollRun } from '@/lib/types'
import { formatIST } from '@/lib/formatDate'
import { formatMoney, CurrencyCode } from '@/lib/currency'

// Opens a print window for a finalized/paid payroll run, rendered entirely
// from its frozen snapshot (not live compensation/attendance data) so a
// re-print always matches what was actually paid — even if attendance or
// the staffer's rate changed since. Mirrors lib/printInvoice.ts.
export function printPayslip(run: PayrollRun) {
  if (!run.snapshot) return
  const win = window.open('', '_blank', 'width=460,height=640')
  if (!win) return

  const snap = run.snapshot
  const cur = snap.currency as CurrencyCode
  const fmt = (n: number) => formatMoney(n, { currency: cur })

  const dayRows = snap.days
    .filter((d) => d.amount !== (snap.pay_type === 'fixed' ? snap.daily_rate : null) || d.status !== 'present')
    .map(
      (d) =>
        `<div class="line"><span>${d.date} — ${d.status.replace('_', ' ')}${d.pay_override ? ` (${d.pay_override})` : ''}</span><span>${fmt(d.amount)}</span></div>`
    )
    .join('')

  const adjustmentRows = snap.adjustments
    .map((a) => `<div class="line"><span>${a.description}</span><span>${fmt(a.amount)}</span></div>`)
    .join('')

  const paidBanner = run.status === 'paid' ? '<div class="paid">PAID</div>' : ''

  win.document.write(`
    <html>
      <head>
        <title>Payslip — ${snap.staff_name}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #111; position: relative; }
          h1 { font-size: 18px; margin: 0 0 2px; }
          .muted { color: #666; font-size: 12px; margin: 0 0 16px; }
          .section-title { font-size: 12px; font-weight: bold; color: #444; margin: 16px 0 4px; text-transform: uppercase; }
          .line { display: flex; justify-content: space-between; font-size: 13px; margin: 3px 0; }
          .total { display: flex; justify-content: space-between; font-weight: bold; font-size: 15px;
            border-top: 1px solid #ccc; padding-top: 8px; margin-top: 8px; }
          .grand { display: flex; justify-content: space-between; font-weight: bold; font-size: 20px;
            border-top: 2px solid #333; padding-top: 10px; margin-top: 10px; color: #047857; }
          .printed { color: #999; font-size: 11px; margin-top: 24px; }
          .paid { position: absolute; top: 120px; left: 50%; transform: translateX(-50%) rotate(-18deg);
            font-size: 60px; color: rgba(4,120,87,0.18); font-weight: bold; letter-spacing: 6px; pointer-events: none; }
        </style>
      </head>
      <body>
        ${paidBanner}
        <h1>Suitely — Payslip</h1>
        <p class="muted">
          ${snap.staff_name} · ${snap.pay_type === 'fixed' ? 'Fixed salary' : 'Hourly'} · ${fmt(snap.rate)}${snap.pay_type === 'hourly' ? '/hr' : '/mo'}<br />
          Period: ${snap.period_start} &rarr; ${snap.period_end}<br />
          Finalized ${formatIST(snap.finalized_at)}
        </p>
        <div class="section-title">Attendance (non-standard days)</div>
        ${dayRows || '<div class="line"><span>Every day paid in full</span><span></span></div>'}
        <div class="total"><span>Base Pay</span><span>${fmt(snap.base_pay)}</span></div>
        ${adjustmentRows ? `<div class="section-title">Adjustments</div>${adjustmentRows}` : ''}
        <div class="grand"><span>Gross Pay</span><span>${fmt(snap.gross_pay)}</span></div>
        <p class="printed">Printed ${formatIST(new Date().toISOString())}</p>
      </body>
    </html>
  `)
  win.document.close()
  win.focus()
  win.print()
}
