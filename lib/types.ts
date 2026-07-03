export type Organization = {
  id: string
  name: string
  slug: string
  created_at: string
}

export type User = {
  id: string
  org_id: string
  email: string
  name: string
  role: 'admin' | 'manager' | 'staff'
  created_at: string
}

export type Room = {
  id: string
  org_id: string
  room_number: string
  room_type_id: string
  status: 'available' | 'occupied' | 'cleaning' | 'maintenance'
  created_at: string
}

export type RoomType = {
  id: string
  org_id: string
  name: string
  description: string
  base_price: number
  max_guests: number
  extra_guest_fee: number
  created_at: string
}

export type Reservation = {
  id: string
  org_id: string
  room_id: string
  guest_name: string
  guest_email: string
  guest_phone: string
  check_in_date: string
  check_out_date: string
  total_price: number
  status: 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled'
  guest_count: number | null
  guest_id_type: string | null
  guest_id_number: string | null
  created_at: string
}

// An occupant beyond the lead guest already captured on the reservation
// itself (guest_name/guest_id_type/guest_id_number) — one row per
// additional person staying in the room, each with their own ID.
export type ReservationGuest = {
  id: string
  org_id: string
  reservation_id: string
  name: string
  id_type: string | null
  id_number: string | null
  created_at: string
}

export type ReservationCharge = {
  id: string
  org_id: string
  reservation_id: string
  description: string
  amount: number
  category: 'service' | 'damage' | 'discount' | 'tax' | 'other'
  created_at: string
}

export type Item = {
  id: string
  org_id: string
  name: string
  price: number
  created_at: string
}

export type StaffSchedule = {
  id: string
  org_id: string
  user_id: string
  shift_date: string
  start_time: string
  end_time: string
  position: string
  notes: string | null
  created_at: string
}

export type MaintenanceLog = {
  id: string
  org_id: string
  room_id: string | null
  title: string
  description: string
  status: 'open' | 'in_progress' | 'completed'
  priority: 'low' | 'medium' | 'high'
  created_at: string
  completed_at: string | null
}

export type AuditLog = {
  id: string
  org_id: string
  entity_type: string
  entity_id: string
  action: 'create' | 'update' | 'delete'
  actor_user_id: string | null
  actor_name: string
  snapshot: Record<string, unknown>
  summary: string | null
  details: string | null
  created_at: string
}
