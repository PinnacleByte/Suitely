import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'

// Hashing for the shared-terminal identity confirmation PIN (staff_pins
// table). Uses Node's built-in crypto (scrypt) so no dependency (bcrypt/etc)
// needs to be added to this project.

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(pin, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPin(pin: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const candidate = scryptSync(pin, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}
