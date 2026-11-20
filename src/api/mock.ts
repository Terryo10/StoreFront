import { ApiError } from './client'
import type { ApiUser, ApprovalResponse, LoginResponse, PullOutcome, SyncPushRequest, SyncPushResponse, SyncResult } from './types'
import type { Role } from '@/lib/permissions'

/*
 * MOCK SERVER. Stands in for the Laravel API so the till runs without a backend.
 * It is deliberately strict: it deduplicates by event_id like a correct server should,
 * and it can inject the failures the real network will produce.
 */

export const MOCK_FAULTS = [
  'none',
  'offline',
  'http401',
  'http403',
  'http409',
  'reject422',
  'drop_response',
  'duplicate_results',
  'slow',
] as const
export type MockFault = (typeof MOCK_FAULTS)[number]

export const MOCK_FAULT_LABELS: Record<MockFault, string> = {
  none: 'Healthy server',
  offline: 'Server unreachable',
  http401: '401 on push (token expired)',
  http403: '403 on push (not allowed)',
  http409: '409 conflict on push',
  reject422: '422 reject every event',
  drop_response: 'Server stores events, response lost',
  duplicate_results: 'Duplicate results in response',
  slow: 'Slow server (4 s)',
}

export interface DemoUser extends ApiUser {
  password: string
  pin: string | null
}

export const DEMO_USERS: DemoUser[] = [
  { id: 'u-cashier', name: 'Tendai Moyo', email: 'cashier@demo.local', role: 'cashier', password: 'demo', pin: null },
  { id: 'u-super', name: 'Rudo Chikore', email: 'supervisor@demo.local', role: 'supervisor', password: 'demo', pin: '1234' },
  { id: 'u-manager', name: 'Farai Ncube', email: 'manager@demo.local', role: 'manager', password: 'demo', pin: '4321' },
  { id: 'u-counter', name: 'Blessing Dube', email: 'counter@demo.local', role: 'counter', password: 'demo', pin: null },
]

const STATE_KEY = 'pos.mockServer'

interface MockState {
  fault: MockFault
  acknowledged: string[]
}

function readState(): MockState {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (raw) return { fault: 'none', acknowledged: [], ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { fault: 'none', acknowledged: [] }
}

let state: MockState = readState()
let pushCalls = 0

function persist() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state))
  } catch {
    /* storage blocked; mock state stays in memory */
  }
}

const listeners = new Set<() => void>()
export function subscribeMock(fn: () => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export function getMockFault(): MockFault {
  return state.fault
}

export function setMockFault(fault: MockFault) {
  state = { ...state, fault }
  persist()
  listeners.forEach((l) => l())
}

/** Number of distinct events the mock server has accepted (logical deliveries). */
export function mockDeliveredCount(): number {
  return state.acknowledged.length
}

export function mockPushCallCount(): number {
  return pushCalls
}

export function resetMockServer() {
  state = { fault: 'none', acknowledged: [] }
  pushCalls = 0
  persist()
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
const latency = () => delay(state.fault === 'slow' ? 4000 : 60 + Math.random() * 90)

function unreachable(): never {
  throw new ApiError('Server unreachable (mock offline)', 0, 'network')
}

export async function mockProbe(): Promise<boolean> {
  await delay(30)
  return state.fault !== 'offline'
}

export async function mockLogin(email: string, password: string): Promise<LoginResponse> {
  await latency()
  if (state.fault === 'offline') unreachable()
  const user = DEMO_USERS.find((u) => u.email.toLowerCase() === email.trim().toLowerCase())
  if (!user || user.password !== password) {
    throw new ApiError('Email or password is incorrect', 422, 'validation')
  }
  return { token: `mock-${user.id}-${Date.now()}`, user: toApiUser(user) }
}

/**
 * Mock supervisor approval works offline on purpose so the flow can be demonstrated.
 * The live adapter calls the server; see BACKEND_GAPS.md for the offline approval gap.
 */
export async function mockApprove(email: string, pin: string, required: Role[]): Promise<ApprovalResponse> {
  await delay(80)
  const user = DEMO_USERS.find((u) => u.email.toLowerCase() === email.trim().toLowerCase())
  if (!user || !user.pin || user.pin !== pin) return { approved: false, message: 'Approver email or PIN is incorrect' }
  if (!required.includes(user.role)) return { approved: false, message: `${user.name} cannot approve this action` }
  return { approved: true, approver: toApiUser(user) }
}

export async function mockPush(request: SyncPushRequest): Promise<SyncPushResponse> {
  pushCalls += 1
  await latency()
  const fault = state.fault
  if (fault === 'offline') unreachable()
  if (fault === 'http401') throw new ApiError('Unauthenticated.', 401, 'unauthorized')
  if (fault === 'http403') throw new ApiError('This device is not allowed to sync.', 403, 'forbidden')
  if (fault === 'http409') throw new ApiError('Conflicting events for this device sequence.', 409, 'conflict')

  const seen = new Set(state.acknowledged)
  const results: SyncResult[] = []
  for (const ev of request.events) {
    if (fault === 'reject422') {
      results.push({ event_id: ev.event_id, status: 'rejected', error: { code: 'validation', message: 'The payload.total field is invalid. (mock 422)' } })
      continue
    }
    const duplicate = seen.has(ev.event_id)
    seen.add(ev.event_id)
    results.push({ event_id: ev.event_id, status: 'acknowledged', duplicate })
  }
  state = { ...state, acknowledged: [...seen] }
  persist()

  if (fault === 'drop_response') unreachable()
  if (fault === 'duplicate_results') return { results: [...results, ...results] }
  return { results }
}

export async function mockPull(): Promise<PullOutcome> {
  await latency()
  if (state.fault === 'offline') unreachable()
  return { available: false, reason: 'Mock mode: the catalogue comes from the local demo seed. Sync pull is not simulated.' }
}

function toApiUser(user: DemoUser): ApiUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role }
}
