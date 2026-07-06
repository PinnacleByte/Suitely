import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Returns a currently-valid access token straight from the auth client,
// refreshing first if it's missing or about to expire. Use this for the
// Authorization header on calls to our own /api routes — NOT a React-context
// session snapshot. `lib/AuthContext.tsx` deliberately ignores some auth
// re-emits (to avoid unmounting the dashboard on tab-focus/token-refresh), so
// its `session.access_token` can lag behind the client's real, refreshed
// token and get rejected server-side with 401 "Invalid session". Returns null
// when there's no session at all — the caller should prompt a re-login.
export async function getFreshAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  const session = data.session
  if (!session) return null

  // expires_at is unix seconds; refresh proactively if it's within 60s of
  // expiry (or already past), so the server never sees a stale JWT.
  const expiringSoon = session.expires_at ? session.expires_at * 1000 < Date.now() + 60_000 : false
  if (!expiringSoon) return session.access_token

  const { data: refreshed } = await supabase.auth.refreshSession()
  return refreshed.session?.access_token ?? session.access_token
}
