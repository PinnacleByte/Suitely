import { Invoice } from '@/lib/types'
import { formatIST } from '@/lib/formatDate'
import { formatMoney, CurrencyCode } from '@/lib/currency'

// Opens a print window for an invoice, rendered entirely from its frozen
// snapshot (not live folio data) so a re-print always matches what the guest
// originally received — even if charges/payments/currency changed since.
// Amounts format in the snapshot's own currency code for the same reason.
// Shared by the folio panel and the /dashboard/invoices list; kept as a
// standalone helper because the markup is too large to duplicate safely.
export function printInvoice(invoice: Invoice) {
  const win = window.open('', '_blank', 'width=460,height=640')
  if (!win) return

  const snap = invoice.snapshot
  const cur = snap.currency as CurrencyCode
  const fmt = (n: number) => formatMoney(n, { currency: cur })

  const lineRows = snap.lines
    .map((l) => `<div class="line"><span>${l.description}</span><span>${fmt(l.amount)}</span></div>`)
    .join('')

  const voidBanner = invoice.status === 'void' ? '<div class="void">VOID</div>' : ''

  win.document.write(`
    <html>
      <head>
        <title>${invoice.invoice_number}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; color: #111; position: relative; }
          h1 { font-size: 18px; margin: 0 0 2px; }
          .num { font-size: 13px; color: #444; margin: 0 0 2px; font-weight: bold; }
          .muted { color: #666; font-size: 12px; margin: 0 0 16px; }
          .line { display: flex; justify-content: space-between; font-size: 14px; margin: 4px 0; }
          .total { display: flex; justify-content: space-between; font-weight: bold; font-size: 15px;
            border-top: 1px solid #ccc; padding-top: 8px; margin-top: 8px; }
          .printed { color: #999; font-size: 11px; margin-top: 24px; }
          .void { position: absolute; top: 120px; left: 50%; transform: translateX(-50%) rotate(-18deg);
            font-size: 72px; color: rgba(220,0,0,0.18); font-weight: bold; letter-spacing: 6px; pointer-events: none; }
        </style>
      </head>
      <body>
        ${voidBanner}
        <h1>Suitely — Invoice</h1>
        <p class="num">${invoice.invoice_number}</p>
        <p class="muted">
          ${snap.guest_name} · Room ${snap.room_number}<br />
          ${snap.check_in_date} &rarr; ${snap.check_out_date}<br />
          Issued ${formatIST(snap.issued_at)}
        </p>
        ${lineRows}
        <div class="total"><span>Total</span><span>${fmt(snap.total)}</span></div>
        <div class="line"><span>Paid</span><span>${fmt(-snap.amount_paid)}</span></div>
        <div class="total"><span>Balance Due</span><span>${fmt(snap.balance_due)}</span></div>
        <p class="printed">Printed ${formatIST(new Date().toISOString())}</p>
      </body>
    </html>
  `)
  win.document.close()
  win.focus()
  win.print()
}
