import type { SyncEnvelope, SyncPushResponse, SyncResult } from '@/domain/types'
import { db } from '@/db/schema'

export type MockFault = 'none' | 'network' | 'conflict' | 'reject' | 'auth'

let fault: MockFault = 'none'
let pushCallCount = 0

export function setMockFault(next: MockFault) {
  fault = next
}

export function getMockFault() {
  return fault
}

export function getMockPushCallCount() {
  return pushCallCount
}

export function resetMockPushCallCount() {
  pushCallCount = 0
}

/**
 * Fault-injectable mock for /sync/push and related endpoints.
 * Never silently marks local changes as server-synchronized without an explicit result.
 */
export async function mockPushSync(envelope: SyncEnvelope): Promise<SyncPushResponse> {
  pushCallCount += 1
  await delay(120 + Math.random() * 180)

  if (fault === 'network') {
    throw new Error('Mock network failure')
  }
  if (fault === 'auth') {
    const err = new Error('Unauthorized') as Error & { status: number }
    err.status = 401
    throw err
  }

  const results: SyncResult[] = []
  for (const ev of envelope.events) {
    if (fault === 'conflict') {
      results.push({
        event_id: ev.event_id,
        status: 'rejected',
        error: { code: 'conflict', message: 'Mock 409: multi-counter conflict (server not authoritative yet)' },
      })
      continue
    }
    if (fault === 'reject') {
      results.push({
        event_id: ev.event_id,
        status: 'rejected',
        error: { code: 'validation', message: 'Mock 422: quantity rejected by server rules' },
      })
      continue
    }
    results.push({
      event_id: ev.event_id,
      status: 'acknowledged',
      result: { duplicate: false },
    })
  }

  return { results }
}

export async function mockPullSync() {
  await db.syncMetadata.update('device', {
    lastPullAttemptAt: new Date().toISOString(),
    lastPullDetail: 'Server pull not available — mock mode placeholder.',
    pullAvailable: false,
  })
  return {
    implemented: false,
    checkpoint: null,
    changes: [],
    message: 'GET /api/v1/sync/pull is not implemented on the server scaffold.',
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
