/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_MODE?: string
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface BarcodeDetectorResult {
  rawValue: string
}

interface BarcodeDetector {
  detect: (source: CanvasImageSource) => Promise<BarcodeDetectorResult[]>
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetector
  getSupportedFormats?: () => Promise<string[]>
}

interface Window {
  BarcodeDetector?: BarcodeDetectorConstructor
}
