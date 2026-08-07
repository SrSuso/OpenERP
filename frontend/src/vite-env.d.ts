/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin. Empty/unset means same origin (dev uses the Vite proxy). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
