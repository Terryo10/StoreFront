import { ApiError, createHttpClient, type HttpClient } from './client'
import { mockApprove, mockLogin, mockProbe, mockPull, mockPush } from './mock'
import {
  approvalResponseSchema,
  loginResponseSchema,
  lookupResponseSchema,
  productPageSchema,
  stocktakeListSchema,
  syncPullResponseSchema,
  syncPushResponseSchema,
  type ApiProduct,
  type ApiStocktake,
  type ApprovalResponse,
  type LoginResponse,
  type PullOutcome,
  type SyncPushRequest,
  type SyncPushResponse,
} from './types'
import type { ApiMode } from '@/db/types'
import type { Role } from '@/lib/permissions'
import { loadToken } from '@/services/secure-token'

export { ApiError }

interface ApiConfig {
  mode: ApiMode
  baseUrl: string
}

let config: ApiConfig = {
  mode: import.meta.env.VITE_API_MODE === 'live' ? 'live' : 'mock',
  baseUrl: import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000',
}
let client: HttpClient | null = null
let unauthorizedHandler: (() => void) | null = null

export function configureApi(next: ApiConfig) {
  config = { ...next }
  client = null
}

export function getApiConfig(): ApiConfig {
  return config
}

export function setUnauthorizedHandler(handler: () => void) {
  unauthorizedHandler = handler
}

function http(): HttpClient {
  if (!client) {
    client = createHttpClient({
      baseUrl: config.baseUrl,
      getToken: loadToken,
      onUnauthorized: () => unauthorizedHandler?.(),
    })
  }
  return client
}

const isMock = () => config.mode === 'mock'

/** Integration inventory shown in Settings and Sync. "assumed" means not verified against a real server. */
export interface IntegrationStatus {
  id: string
  label: string
  endpoint: string
  state: 'mocked' | 'live (assumed contract)' | 'not available'
}

export function integrationStatus(): IntegrationStatus[] {
  const live = (endpoint: string, label: string, id: string): IntegrationStatus => ({
    id,
    label,
    endpoint,
    state: isMock() ? 'mocked' : 'live (assumed contract)',
  })
  return [
    live('POST /api/v1/auth/login', 'Sign in (Sanctum token)', 'auth'),
    live('POST /api/v1/auth/approve', 'Supervisor approval', 'approve'),
    live('GET /api/v1/products', 'Catalogue download', 'products'),
    live('GET /api/v1/products/lookup', 'Barcode lookup fallback', 'lookup'),
    live('POST /api/v1/sync/push', 'Event push', 'push'),
    {
      id: 'pull',
      label: 'Incremental sync pull',
      endpoint: 'GET /api/v1/sync/pull',
      state: isMock() ? 'mocked' : 'live (assumed contract)',
    },
    live('GET /api/v1/stocktakes', 'Stocktake assignments', 'stocktakes'),
    { id: 'enrol', label: 'Device enrolment', endpoint: 'none yet', state: 'not available' },
    { id: 'fiscal', label: 'Fiscal device', endpoint: 'extension point only', state: 'not available' },
  ]
}

/**
 * Connectivity is decided by contacting the server, not by navigator.onLine.
 * Laravel 11 ships GET /up as a health route; any HTTP response means the host is reachable.
 */
export async function probeServer(timeoutMs = 4000): Promise<{ reachable: boolean; detail: string; latencyMs: number | null }> {
  const started = performance.now()
  if (isMock()) {
    const ok = await mockProbe()
    return { reachable: ok, detail: ok ? 'Mock server' : 'Mock server set to unreachable', latencyMs: ok ? Math.round(performance.now() - started) : null }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${config.baseUrl.replace(/\/$/, '')}/up`, { cache: 'no-store', signal: controller.signal })
    return { reachable: true, detail: `HTTP ${res.status}`, latencyMs: Math.round(performance.now() - started) }
  } catch (err) {
    return { reachable: false, detail: controller.signal.aborted ? 'Timed out' : err instanceof Error ? err.message : 'Unreachable', latencyMs: null }
  } finally {
    clearTimeout(timer)
  }
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  if (isMock()) return mockLogin(email, password)
  return http().request('/api/v1/auth/login', {
    method: 'POST',
    body: { email, password, device_name: 'zw-pos-till' },
    schema: loginResponseSchema,
    auth: false,
  })
}

export async function logout(): Promise<void> {
  if (isMock()) return
  try {
    await http().request('/api/v1/auth/logout', { method: 'POST', timeoutMs: 4000 })
  } catch {
    /* Local sign-out proceeds regardless; the token is discarded locally. */
  }
}

export async function requestApproval(email: string, pin: string, action: string, required: Role[]): Promise<ApprovalResponse> {
  if (isMock()) return mockApprove(email, pin, required)
  return http().request('/api/v1/auth/approve', {
    method: 'POST',
    body: { email, pin, action },
    schema: approvalResponseSchema,
    timeoutMs: 6000,
  })
}

export async function fetchAllProducts(onPage?: (page: number, last: number) => void): Promise<ApiProduct[]> {
  if (isMock()) throw new ApiError('Mock mode uses the local demo catalogue', 0, 'mock')
  const all: ApiProduct[] = []
  for (let page = 1; page < 500; page++) {
    const res = await http().request(`/api/v1/products?per_page=500&page=${page}`, { schema: productPageSchema })
    all.push(...res.data)
    const last = res.meta?.last_page ?? page
    onPage?.(page, last)
    if (page >= last || res.data.length === 0) break
  }
  return all
}

export async function lookupBarcodeRemote(barcode: string): Promise<ApiProduct | null> {
  if (isMock()) return null
  const res = await http().request(`/api/v1/products/lookup?barcode=${encodeURIComponent(barcode)}`, {
    schema: lookupResponseSchema,
    timeoutMs: 3000,
    retries: 0,
  })
  return res.data
}

export async function pushEvents(request: SyncPushRequest): Promise<SyncPushResponse> {
  if (isMock()) return mockPush(request)
  return http().request('/api/v1/sync/push', {
    method: 'POST',
    body: request,
    schema: syncPushResponseSchema,
    retries: 0,
    timeoutMs: 20_000,
  })
}

export async function pullChanges(checkpoint: string | null): Promise<PullOutcome> {
  if (isMock()) return mockPull()
  try {
    const res = await http().request(`/api/v1/sync/pull${checkpoint ? `?checkpoint=${encodeURIComponent(checkpoint)}` : ''}`, {
      schema: syncPullResponseSchema,
    })
    return { available: true, products: res.products, checkpoint: res.checkpoint ?? null }
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 405 || err.status === 501)) {
      return { available: false, reason: `GET /api/v1/sync/pull is not implemented on the server (HTTP ${err.status}).` }
    }
    throw err
  }
}

export async function fetchStocktakes(): Promise<ApiStocktake[] | null> {
  if (isMock()) return null
  const res = await http().request('/api/v1/stocktakes', { schema: stocktakeListSchema })
  return res.data
}

export async function startStocktakeRemote(id: string): Promise<void> {
  if (isMock()) return
  await http().request(`/api/v1/stocktakes/${encodeURIComponent(id)}/start`, { method: 'POST', retries: 0 })
}
