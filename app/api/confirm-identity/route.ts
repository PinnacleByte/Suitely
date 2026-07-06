import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

// Stage 4 — shared-terminal identity confirmation.
// The front desk often leaves ONE session logged in all shift, so the audit
// trail's auth.uid() actor is the terminal, not the person who acted. Before a
// book / check-in / check-out / payment / invoice action, the acting staffer
// picks their name and enters their password; this route verifies that
// password against Supabase Auth and — atomically, from the same verified
// email — writes an audit_logs 'confirm' row attributing the action to THEM.
//
// Verification uses a throwaway server-side client (never the browser session,
// so the shared login is untouched). Because the actor is derived from the
// verified email (not a client-supplied id), you can't pin an action on a
// colleague without knowing their password.

const ACTION_SUMMARY: Record<string, string> = {
  book: 'Booking authorized',
  check_in: 'Check-in authorized',
  check_out: 'Check-out authorized',
  payment: 'Payment authorized',
  invoice: 'Invoice authorized',
}

export async function POST(request: NextRequest) {
  const supabaseAdmin = getSupabaseAdmin()
  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  if (!token) {
    return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 })
  }

  // Who's driving the terminal (the shared session). Used only to scope the
  // confirmation to this hotel — never trusted as the actor. The client sends
  // a freshly-refreshed token (getFreshAccessToken in lib/supabase.ts), so a
  // rejection here means the login genuinely expired — re-login required.
  const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token)
  if (callerError || !callerData.user) {
    return NextResponse.json({ error: 'Session expired — please sign in again.' }, { status: 401 })
  }

  const { data: callerProfile } = await supabaseAdmin
    .from('users')
    .select('org_id')
    .eq('id', callerData.user.id)
    .single()

  if (!callerProfile) {
    return NextResponse.json({ error: 'Caller profile not found' }, { status: 403 })
  }

  const body = await request.json()
  const { email, password, action, entityId } = body as {
    email?: string
    password?: string
    action?: string
    entityId?: string | null
  }

  if (!email || !password || !action || !ACTION_SUMMARY[action]) {
    return NextResponse.json({ error: 'email, password, and a valid action are required' }, { status: 400 })
  }

  // The acting staffer must belong to THIS hotel.
  const { data: actor } = await supabaseAdmin
    .from('users')
    .select('id, name, org_id, role')
    .eq('org_id', callerProfile.org_id)
    .eq('email', email)
    .single()

  if (!actor) {
    return NextResponse.json({ error: 'That staff member is not part of this hotel.' }, { status: 403 })
  }

  // Verify the password on an isolated client so the browser's shared session
  // is never touched. A successful sign-in proves the staffer's identity.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const verifier = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: signIn, error: signInError } = await verifier.auth.signInWithPassword({
    email,
    password,
  })
  // Discard the throwaway session immediately.
  await verifier.auth.signOut()

  if (signInError || !signIn.user || signIn.user.id !== actor.id) {
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 })
  }

  // Attribute the action to the verified staffer. entity_id ties it to the
  // reservation when we have one (check-in/out/payment/invoice) so it threads
  // into that booking's History; for a brand-new booking there's no id yet, so
  // we anchor it to the actor and it surfaces in the org-wide Activity Log.
  const anchorId = entityId || actor.id
  const { error: logError } = await supabaseAdmin.from('audit_logs').insert([
    {
      org_id: callerProfile.org_id,
      entity_type: 'confirmation',
      entity_id: anchorId,
      action: 'confirm',
      actor_user_id: actor.id,
      actor_name: actor.name,
      snapshot: { action, entity_id: entityId || null, role: actor.role },
      summary: ACTION_SUMMARY[action],
      // actor_name already renders as "by <name>"; keep details role-only so
      // it isn't redundant. Reads e.g. "Check-out authorized (staff) by Burhan".
      details: `(${actor.role})`,
    },
  ])

  if (logError) {
    return NextResponse.json({ error: logError.message }, { status: 400 })
  }

  return NextResponse.json({ userId: actor.id, name: actor.name })
}
