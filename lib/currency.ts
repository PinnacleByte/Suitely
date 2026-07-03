// Per-org currency formatting.
//
// Each organization stores its own `currency` code (organizations.currency).
// The active org's code is mirrored into localStorage at login (see
// AuthContext), the same way orgId already is, so any component can format
// money without threading the org object down through props. Prices always
// render after their page's data has loaded, by which point the code is set;
// if it's somehow missing we fall back to USD rather than showing a bare number.

export type CurrencyCode =
  | 'USD'
  | 'EUR'
  | 'GBP'
  | 'INR'
  | 'AED'
  | 'AUD'
  | 'CAD'
  | 'SGD'

export const CURRENCIES: Record<
  CurrencyCode,
  { label: string; symbol: string; locale: string }
> = {
  USD: { label: 'US Dollar ($)', symbol: '$', locale: 'en-US' },
  EUR: { label: 'Euro (€)', symbol: '€', locale: 'en-IE' },
  GBP: { label: 'British Pound (£)', symbol: '£', locale: 'en-GB' },
  INR: { label: 'Indian Rupee (₹)', symbol: '₹', locale: 'en-IN' },
  AED: { label: 'UAE Dirham (AED)', symbol: 'AED ', locale: 'en-AE' },
  AUD: { label: 'Australian Dollar (A$)', symbol: 'A$', locale: 'en-AU' },
  CAD: { label: 'Canadian Dollar (C$)', symbol: 'C$', locale: 'en-CA' },
  SGD: { label: 'Singapore Dollar (S$)', symbol: 'S$', locale: 'en-SG' },
}

export const DEFAULT_CURRENCY: CurrencyCode = 'USD'

// The org's currency code, read from localStorage (set at login).
export function getCurrencyCode(): CurrencyCode {
  if (typeof window === 'undefined') return DEFAULT_CURRENCY
  const stored = localStorage.getItem('currency')
  return stored && stored in CURRENCIES ? (stored as CurrencyCode) : DEFAULT_CURRENCY
}

// Formats an amount in the active org's currency, e.g. 1234.5 -> "$1,234.50".
// Negatives render as "-$1,234.50" (folio discounts/credits rely on this).
// Pass { decimals: 0 } for whole-currency figures like the dashboard totals.
// Pass { currency } to format in a specific code regardless of the active
// org — used when printing an invoice from its frozen snapshot, so a later
// org currency change never rewrites an already-issued invoice.
export function formatMoney(
  amount: number,
  options: { decimals?: number; currency?: CurrencyCode } = {}
): string {
  const { decimals = 2, currency } = options
  const code = currency && currency in CURRENCIES ? currency : getCurrencyCode()
  const { symbol, locale } = CURRENCIES[code]
  const formatted = Math.abs(amount).toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return `${amount < 0 ? '-' : ''}${symbol}${formatted}`
}
