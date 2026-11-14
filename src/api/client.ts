import type {
  Product,
  SyncEnvelope,
  SyncPullResponse,
  SyncPushResponse,
  Stocktake,
} from '@/domain/types'

export class ApiError extends Error {
  status: number
  code?: string
  body?: unknown

  constructor(message: string, status: number, code?: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body
  }
}

export interface ApiClientOptions {
  baseUrl: string
  getToken: () => string | null
  timeoutMs?: number
  maxRetries?: number
  onUnauthorized?: () => void
}

export interface ProductListResponse {
  data: Product[]
  meta?: { total?: number; page?: number }
}

export interface StocktakeListResponse {
  data: Stocktake[]
}

export interface VarianceRow {
  product_id: string
  location_id: string
  expected: string | null
  counted: string | null
  difference: string | null
  percentage: number | null
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

export function createHttpClient(opts: ApiClientOptions) {
  const timeoutMs = opts.timeoutMs ?? 12000
  const maxRetries = opts.maxRetries ?? 2

  async function request<T>(
    path: string,
    init: RequestInit = {},
    retry = 0,
  ): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const token = opts.getToken()
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    if (token) headers.set('Authorization', `Bearer ${token}`)

    try {
      const res = await fetch(`${opts.baseUrl.replace(/\/$/, '')}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
        cache: 'no-store',
      })

      if (res.status === 401) {
        opts.onUnauthorized?.()
        throw new ApiError('Unauthorized', 401, 'unauthorized')
      }

      if (res.status === 409) {
        const body = await safeJson(res)
        throw new ApiError('Conflict', 409, 'conflict', body)
      }

      if (!res.ok) {
        const body = await safeJson(res)
        const message =
          (body as { message?: string })?.message || `HTTP ${res.status}`
        throw new ApiError(message, res.status, undefined, body)
      }

      if (res.status === 204) return undefined as T
      return (await res.json()) as T
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403 || err.status === 422) throw err
        if (err.status === 409) throw err
      }
      const retriable =
        !(err instanceof ApiError) ||
        err.status >= 500 ||
        err.status === 0
      if (retriable && retry < maxRetries) {
        const backoff = 300 * 2 ** retry + Math.floor(Math.random() * 200)
        await sleep(backoff)
        return request<T>(path, init, retry + 1)
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    request,
    listProducts: (q?: string) =>
      request<ProductListResponse>(
        `/api/v1/products${q ? `?q=${encodeURIComponent(q)}` : ''}`,
      ),
    lookupBarcode: (barcode: string) =>
      request<{ data: Product | null }>(
        `/api/v1/products/lookup?barcode=${encodeURIComponent(barcode)}`,
      ),
    listStocktakes: () => request<StocktakeListResponse>('/api/v1/stocktakes'),
    getStocktake: (id: string) => request<{ data: Stocktake }>(`/api/v1/stocktakes/${id}`),
    createStocktake: (body: unknown) =>
      request<{ data: Stocktake }>('/api/v1/stocktakes', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    startStocktake: (id: string) =>
      request<{ data: Stocktake }>(`/api/v1/stocktakes/${id}/start`, { method: 'POST' }),
    submitStocktake: (id: string) =>
      request<{ data: Stocktake }>(`/api/v1/stocktakes/${id}/submit`, { method: 'POST' }),
    approveStocktake: (id: string) =>
      request<{ data: Stocktake }>(`/api/v1/stocktakes/${id}/approve`, { method: 'POST' }),
    postStocktake: (id: string) =>
      request<{ data: Stocktake }>(`/api/v1/stocktakes/${id}/post`, { method: 'POST' }),
    getVariances: (id: string) =>
      request<{ data: VarianceRow[] }>(`/api/v1/stocktakes/${id}/variances`),
    pushSync: (envelope: SyncEnvelope) =>
      request<SyncPushResponse>('/api/v1/sync/push', {
        method: 'POST',
        body: JSON.stringify(envelope),
      }),
    pullSync: (checkpoint?: string | null) =>
      request<SyncPullResponse>(
        `/api/v1/sync/pull${checkpoint ? `?checkpoint=${encodeURIComponent(checkpoint)}` : ''}`,
      ),
  }
}

async function safeJson(res: Response) {
  try {
    return await res.json()
  } catch {
    return null
  }
}

export type HttpClient = ReturnType<typeof createHttpClient>
