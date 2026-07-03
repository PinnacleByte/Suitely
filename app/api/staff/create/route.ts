import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export async function POST(request: NextRequest) {
  const supabaseAdmin = getSupabaseAdmin()
  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  if (!token) {
    return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 })
  }

  const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token)
  if (callerError || !callerData.user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  // Look up the caller's own org/role server-side — never trust org_id from the request body.
  const { data: callerProfile, error: profileError } = await supabaseAdmin
    .from('users')
    .select('org_id, role')
    .eq('id', callerData.user.id)
    .single()

  if (profileError || !callerProfile) {
    return NextResponse.json({ error: 'Caller profile not found' }, { status: 403 })
  }

  if (callerProfile.role !== 'admin' && callerProfile.role !== 'manager') {
    return NextResponse.json({ error: 'Only admins or managers can add staff' }, { status: 403 })
  }

  const body = await request.json()
  const { name, email, password, role } = body as {
    name?: string
    email?: string
    password?: string
    role?: string
  }

  if (!name || !email || !password || !role) {
    return NextResponse.json({ error: 'Name, email, password, and role are required' }, { status: 400 })
  }

  if (!['admin', 'manager', 'staff'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
  }

  const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (createError || !newUser.user) {
    return NextResponse.json({ error: createError?.message || 'Failed to create account' }, { status: 400 })
  }

  const { error: insertError } = await supabaseAdmin.from('users').insert([
    {
      id: newUser.user.id,
      org_id: callerProfile.org_id,
      email,
      name,
      role,
    },
  ])

  if (insertError) {
    // Roll back the orphaned auth account if the profile row couldn't be created.
    await supabaseAdmin.auth.admin.deleteUser(newUser.user.id)
    return NextResponse.json({ error: insertError.message }, { status: 400 })
  }

  return NextResponse.json({ id: newUser.user.id })
}
