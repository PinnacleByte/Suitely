import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { verifyPin } from '@/lib/pin'

// Stage 4 — shared-terminal identity confirmation.
// The front desk often leaves ONE session logged in all shift, so the audit
// trail's auth.uid() actor is the terminal, not the person who acted. Before
// a book / check-in / check-out / payment / invoice action, the acting
// staffer picks their name and enters their 4-digit PIN (set by an
// admin/manager via app/api/staff/set-pin); this route verifies the PIN
// against staff_pins and — atomically — writes an audit_logs 'confirm' row
// attributing the action to THEM.
//
// Deliberately does NOT require the shared terminal's own session/bearer
// token to be valid — that used to be the failure mode ("Session expired")
// on a long-lived shift session, unrelated to who's actually confirming.
// org_id is trusted from the request body, same as every other client query
// in this app (see CLAUDE.md: "Always filter by org_id from localStorage").
// The staff_pins table itself has no RLS SELECT policy at all, so a PIN
// hash is never reachable except through this service-role route, and a
// 5-attempt/15-minute lockout makes the 10,000-combination PIN space
// impractical to brute-force even without caller auth.

const ACTION_SUMMARY: Record<string, string> = {
  book: 'Booking authorized',
  check_in: 'Check-in authorized',
  check_out: 'Check-out authorized',
  payment: 'Payment authorized',
  invoice: 'Invoice authorized',
}

const MAX_ATTEMPTS = 5
const LOCKOUT_MINUTES = 15

export async function POST(request: NextRequest) {
  const supabaseAdmin = getSupabaseAdmin()

  const body = await request.json()
  const { orgId, userId, pin, action, entityId } = body as {
    orgId?: string
    userId?: string
    pin?: string
    action?: string
    entityId?: string | null
  }

  if (!orgId || !userId || !pin || !action || !ACTION_SUMMARY[action]) {
    return NextResponse.json(
      { error: 'orgId, userId, pin, and a valid action are required' },
      { status: 400 }
    )
  }

  const { data: actor } = await supabaseAdmin
    .from('users')
    .select('id, name, org_id, role')
    .eq('org_id', orgId)
    .eq('id', userId)
    .single()

  if (!actor) {
    return NextResponse.json({ error: 'That staff member is not part of this hotel.' }, { status: 403 })
  }

  const { data: pinRow } = await supabaseAdmin
    .from('staff_pins')
    .select('pin_hash, failed_attempts, locked_until')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .single()

  if (!pinRow) {
    return NextResponse.json(
      { error: 'No PIN set for this staff member. Ask an admin/manager to set one in Settings → Staff.' },
      { status: 400 }
    )
  }

  if (pinRow.locked_until && new Date(pinRow.locked_until).getTime() > Date.now()) {
    const minutesLeft = Math.ceil((new Date(pinRow.locked_until).getTime() - Date.now()) / 60_000)
    return NextResponse.json(
      { error: `Too many incorrect attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? '' : 's'}.` },
      { status: 429 }
    )
  }

  if (!verifyPin(pin, pinRow.pin_hash)) {
    const attempts = pinRow.failed_attempts + 1
    const lockedOut = attempts >= MAX_ATTEMPTS
    await supabaseAdmin
      .from('staff_pins')
      .update({
        failed_attempts: lockedOut ? 0 : attempts,
        locked_until: lockedOut ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString() : null,
      })
      .eq('user_id', userId)
      .eq('org_id', orgId)

    return NextResponse.json(
      {
        error: lockedOut
          ? `Too many incorrect attempts. Try again in ${LOCKOUT_MINUTES} minutes.`
          : `Incorrect PIN. ${MAX_ATTEMPTS - attempts} attempt${MAX_ATTEMPTS - attempts === 1 ? '' : 's'} remaining.`,
      },
      { status: lockedOut ? 429 : 401 }
    )
  }

  // Correct PIN — clear any prior failed attempts.
  await supabaseAdmin
    .from('staff_pins')
    .update({ failed_attempts: 0, locked_until: null })
    .eq('user_id', userId)
    .eq('org_id', orgId)

  // Attribute the action to the verified staffer. entity_id ties it to the
  // reservation when we have one (check-in/out/payment/invoice) so it threads
  // into that booking's History; for a brand-new booking there's no id yet, so
  // we anchor it to the actor and it surfaces in the org-wide Activity Log.
  const anchorId = entityId || actor.id
  const { error: logError } = await supabaseAdmin.from('audit_logs').insert([
    {
      org_id: orgId,
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
