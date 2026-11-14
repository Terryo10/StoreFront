import { createHttpClient, type HttpClient } from './client'
import { mockPullSync, mockPushSync } from './mock'
import { db } from '@/db/schema'
import type { SyncEnvelope, SyncPullResponse, SyncPushResponse } from '@/domain/types'

let liveClient: HttpClient | null = null
let onUnauthorized: (() => void) | null = null

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler
}

async function getModeAndUrl() {
  const settings = await db.settings.get('app')
  return {
    mode: settings?.apiMode ?? (import.meta.env.VITE_API_MODE as 'mock' | 'live') ?? 'mock',
    baseUrl: settings?.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000',
  }
}

async function getLiveClient(): Promise<HttpClient> {
  const { baseUrl } = await getModeAndUrl()
  const session = await db.session.get('session')
  liveClient = createHttpClient({
    baseUrl,
    getToken: () => session?.token ?? null,
    onUnauthorized: () => onUnauthorized?.(),
  })
  return liveClient
}

export async function pushSync(envelope: SyncEnvelope): Promise<SyncPushResponse> {
  const { mode } = await getModeAndUrl()
  if (mode === 'mock') return mockPushSync(envelope)
  const client = await getLiveClient()
  return client.pushSync(envelope)
}

export async function pullSync(checkpoint?: string | null): Promise<SyncPullResponse> {
  const { mode } = await getModeAndUrl()
  if (mode === 'mock') return mockPullSync()
  try {
    const client = await getLiveClient()
    return await client.pullSync(checkpoint)
  } catch (err) {
    return {
      implemented: false,
      checkpoint: null,
      changes: [],
      message:
        err instanceof Error
          ? `Pull failed: ${err.message}`
          : 'Pull failed — endpoint likely unimplemented.',
    }
  }
}

export async function getApiFacade() {
  const { mode, baseUrl } = await getModeAndUrl()
  return { mode, baseUrl, live: mode === 'live' ? await getLiveClient() : null }
}
