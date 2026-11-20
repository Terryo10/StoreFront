import type { z } from 'zod'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly body: unknown

  constructor(message: string, status: number, code: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.body = body
  }

  get isNetwork() {
    return this.status === 0
  }
}

export interface HttpClientOptions {
  baseUrl: string
  getToken: () => Promise<string | null>
  onUnauthorized?: () => void
  timeoutMs?: number
}

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  schema?: z.ZodType<T>
  /** Retries apply to network failures, timeouts, 429 and 5xx. Never to 4xx client errors. */
  retries?: number
  timeoutMs?: number
  auth?: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function retryDelay(attempt: number, baseMs = 400, capMs = 8000): number {
  const exp = Math.min(capMs, baseMs * 2 ** attempt)
  return Math.floor(exp / 2 + Math.random() * (exp / 2))
}

export function createHttpClient(opts: HttpClientOptions) {
  const base = opts.baseUrl.replace(/\/$/, '')

  async function request<T>(path: string, options: RequestOptions<T> = {}): Promise<T> {
    const { method = 'GET', body, schema, retries = method === 'GET' ? 2 : 0, auth = true } = options
    const timeoutMs = options.timeoutMs ?? opts.timeoutMs ?? 12_000

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const headers = new Headers({ Accept: 'application/json' })
        if (body !== undefined) headers.set('Content-Type', 'application/json')
        if (auth) {
          const token = await opts.getToken()
          if (token) headers.set('Authorization', `Bearer ${token}`)
        }

        let res: Response
        try {
          res = await fetch(`${base}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
            cache: 'no-store',
          })
        } catch (err) {
          const aborted = controller.signal.aborted
          throw new ApiError(
            aborted ? `Server did not respond within ${Math.round(timeoutMs / 1000)}s` : 'Server unreachable',
            0,
            aborted ? 'timeout' : 'network',
            err instanceof Error ? err.message : undefined,
          )
        }

        const data = res.status === 204 ? null : await safeJson(res)

        if (res.status === 401) {
          opts.onUnauthorized?.()
          throw new ApiError('Session expired or not signed in', 401, 'unauthorized', data)
        }
        if (!res.ok) {
          const message = (data as { message?: string } | null)?.message ?? `HTTP ${res.status}`
          const code =
            res.status === 403 ? 'forbidden' : res.status === 404 ? 'not_found' : res.status === 409 ? 'conflict' : res.status === 422 ? 'validation' : res.status === 429 ? 'rate_limited' : 'server_error'
          throw new ApiError(message, res.status, code, data)
        }

        if (!schema) return data as T
        const parsed = schema.safeParse(data)
        if (!parsed.success) {
          throw new ApiError(`Unexpected response shape from ${path}: ${parsed.error.issues[0]?.message ?? 'invalid'}`, res.status, 'contract', data)
        }
        return parsed.data
      } catch (err) {
        const retriable = err instanceof ApiError && (err.status === 0 || err.status === 429 || err.status >= 500)
        if (!retriable || attempt >= retries) throw err
        await sleep(retryDelay(attempt))
      } finally {
        clearTimeout(timer)
      }
    }
  }

  return { request, baseUrl: base }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

export type HttpClient = ReturnType<typeof createHttpClient>
