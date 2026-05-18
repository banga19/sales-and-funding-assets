/// <reference types="vite/client" />
/// <reference types="vite" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_API_TIMEOUT:    string;
  readonly VITE_API_TARGET:     string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
