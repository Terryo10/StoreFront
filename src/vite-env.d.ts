/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_MODE?: 'mock' | 'live'
  readonly VITE_API_BASE_URL?: string
  readonly VITE_DEFAULT_ZWG_RATE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
