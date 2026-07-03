// Hotel staff are based in India; always display timestamps in IST
// regardless of the viewing device's own timezone/locale settings.
export function formatIST(dateString: string): string {
  return new Date(dateString).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

// Today's date in IST as YYYY-MM-DD, to match against DATE columns
// (check_in_date, shift_date, etc.) without UTC/local off-by-one issues.
export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

// Same as todayIST(), but for an arbitrary timestamp (e.g. an audit log's
// created_at) — used to group timestamped records by their IST calendar day.
export function dateIST(dateString: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(dateString))
}
