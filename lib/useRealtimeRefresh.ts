'use client'

import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

// Every dashboard page/component loads its own data once on mount and never
// learns about writes made elsewhere (documented "no shared/global client
// state" limitation) — e.g. the navbar's QuickCheckInOut not showing a
// reservation created on the Reservations page until a hard reload. This
// subscribes to Postgres changes on the given tables, scoped to the current
// org, and re-runs the caller's loader whenever a row is inserted/updated/
// deleted — including from another browser tab or terminal.
export function useRealtimeRefresh(tables: string[], onChange: () => void) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const orgId = localStorage.getItem('orgId')
    if (!orgId) return

    // Supabase reuses an existing channel object for an identical topic
    // string instead of creating a new one — two components subscribing to
    // the same table set (e.g. the navbar's QuickCheckInOut and a detail
    // page both watching reservations+rooms) would otherwise collide on the
    // same already-subscribed channel and throw when calling .on() on it.
    // A random suffix guarantees every hook instance gets its own channel.
    const channel = supabase.channel(
      `realtime:${tables.join(',')}:${orgId}:${crypto.randomUUID()}`
    )
    tables.forEach((table) => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `org_id=eq.${orgId}` },
        () => onChangeRef.current()
      )
    })
    channel.subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join(',')])
}
