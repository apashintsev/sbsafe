import { isAddress } from 'ethers'

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export const EXEC_GAS_LIMIT = 130_000n

export const TOKEN_DECIMALS = 6

export const CHAINS = {
  1: {
    id: 1,
    name: 'Ethereum',
    hex: '0x1',
  },
  11155111: {
    id: 11155111,
    name: 'Sepolia',
    hex: '0xaa36a7',
  },
} as const

export type SupportedChainId = keyof typeof CHAINS

export function isSupportedChainId(chainId: number): chainId is SupportedChainId {
  return chainId === 1 || chainId === 11155111
}

function optionalAddress(value: string | undefined): string | null {
  if (!value?.trim()) return null
  return isAddress(value.trim()) ? value.trim() : null
}

export function getEnvDefaults() {
  return {
    safeAddress: optionalAddress(import.meta.env.VITE_SAFE_ADDRESS),
    governanceProxy: optionalAddress(import.meta.env.VITE_GOVERNANCE_PROXY_ADDRESS),
    mintLimitAccount: optionalAddress(import.meta.env.VITE_MINT_LIMIT_ACCOUNT),
  }
}

export function getExplorerTxUrl(chainId: number, hash: string): string | null {
  if (chainId === 1) return `https://etherscan.io/tx/${hash}`
  if (chainId === 11155111) return `https://sepolia.etherscan.io/tx/${hash}`
  return null
}

export function getExplorerAddressUrl(chainId: number, address: string): string | null {
  if (chainId === 1) return `https://etherscan.io/address/${address}`
  if (chainId === 11155111) return `https://sepolia.etherscan.io/address/${address}`
  return null
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function tryChecksum(value: string): string | null {
  if (!isAddress(value.trim())) return null
  return value.trim()
}
