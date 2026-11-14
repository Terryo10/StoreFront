import { db } from '@/db/schema'
import { ensureSeeded } from '@/db/seed'

export async function resetDb() {
  await db.delete()
  await db.open()
  await ensureSeeded()
}
