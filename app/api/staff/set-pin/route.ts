import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { hashPin } from '@/lib/pin'

// Admin/manager-only: set or reset a staffer's identity-confirmation PIN
// (staff_pins table, used by app/api/confirm-identity). Mirrors the auth
// pattern in app/api/staff/create/route.ts — this route keeps full caller
// auth rigor since it's a rare, deliberate admin action, not the
// high-frequency confirm-identity gate.

async function authorizeCaller(request: NextRequest) {
  const supabaseAdmin = getSupabaseAdmin()
  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  if (!token) {
    return { error: NextResponse.json({ error: 'Missing authorization token' }, { status: 401 }), orgId: null }
  }

  const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token)
  if (callerError || !callerData.user) {
    return { error: NextResponse.json({ error: 'Invalid session' }, { status: 401 }), orgId: null }
  }

  const { data: callerProfile } = await supabaseAdmin
    .from('users')
    .select('org_id, role')
    .eq('id', callerData.user.id)
    .single()

  if (!callerProfile) {
    return { error: NextResponse.json({ error: 'Caller profile not found' }, { status: 403 }), orgId: null }
  }

  if (callerProfile.role !== 'admin' && callerProfile.role !== 'manager') {
    return {
      error: NextResponse.json({ error: 'Only admins or managers can manage staff PINs' }, { status: 403 }),
      orgId: null,
    }
  }

  return { error: null, orgId: callerProfile.org_id as string }
}

export async function POST(request: NextRequest) {
  const auth = await authorizeCaller(request)
  if (auth.error) return auth.error
  const { orgId } = auth
  const supabaseAdmin = getSupabaseAdmin()

  const body = await request.json()
  const { userId, pin } = body as { userId?: string; pin?: string }

  if (!userId || !pin) {
    return NextResponse.json({ error: 'userId and pin are required' }, { status: 400 })
  }
  if (!/^\d{4}$/.test(pin)) {
    return NextResponse.json({ error: 'PIN must be exactly 4 digits' }, { status: 400 })
  }

  const { data: staffer } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('id', userId)
    .eq('org_id', orgId)
    .single()

  if (!staffer) {
    return NextResponse.json({ error: 'That staff member is not part of this hotel.' }, { status: 403 })
  }

  const { error: upsertError } = await supabaseAdmin.from('staff_pins').upsert(
    {
      user_id: userId,
      org_id: orgId,
      pin_hash: hashPin(pin),
      failed_attempts: 0,
      locked_until: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}

export async function GET(request: NextRequest) {
  const auth = await authorizeCaller(request)
  if (auth.error) return auth.error
  const { orgId } = auth
  const supabaseAdmin = getSupabaseAdmin()

  const { data: pins } = await supabaseAdmin
    .from('staff_pins')
    .select('user_id')
    .eq('org_id', orgId)

  const hasPin: Record<string, boolean> = {}
  for (const row of pins || []) {
    hasPin[row.user_id] = true
  }

  return NextResponse.json({ hasPin })
}
