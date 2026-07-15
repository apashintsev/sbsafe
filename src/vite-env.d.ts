/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SAFE_ADDRESS?: string
  readonly VITE_GOVERNANCE_PROXY_ADDRESS?: string
  readonly VITE_MINT_LIMIT_ACCOUNT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface Window {
  ethereum?: import('ethers').Eip1193Provider & {
    isMetaMask?: boolean
    on?: (event: string, handler: (...args: unknown[]) => void) => void
    removeListener?: (event: string, handler: (...args: unknown[]) => void) => void
    request?: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  }
}
