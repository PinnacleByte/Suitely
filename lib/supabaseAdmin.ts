import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Server-only client using the service role key. Never import this from a
// 'use client' component — it must only be used inside app/api/** route
// handlers, where it can bypass RLS to provision staff accounts.
//
// Built lazily (not at module load) so the env var is only required when a
// route actually uses it, rather than during Next's build-time page-data
// collection for every route module.
let cachedClient: SupabaseClient | null = null

export function getSupabaseAdmin(): SupabaseClient {
  if (cachedClient) return cachedClient

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Missing Supabase service role environment variables')
  }

  cachedClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
  return cachedClient
}
