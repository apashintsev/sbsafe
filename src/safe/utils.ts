import { Interface, zeroPadValue } from 'ethers'
import { GOVERNANCE_ABI } from '../abi'
import { ZERO_ADDRESS } from '../config'

const governanceInterface = new Interface(GOVERNANCE_ABI)

export type SafeTxParams = {
  to: string
  value: bigint
  data: string
  operation: number
  safeTxGas: bigint
  baseGas: bigint
  gasPrice: bigint
  gasToken: string
  refundReceiver: string
  nonce: bigint
}

export type OwnerApproval = {
  owner: string
  approved: boolean
}

export function encodeSetMintLimit(account: string, limit: bigint): string {
  return governanceInterface.encodeFunctionData('setMintLimit', [account, limit])
}

export function buildSafeTxParams(args: {
  governanceProxy: string
  mintLimitAccount: string
  limit: bigint
  nonce: bigint
}): SafeTxParams {
  return {
    to: args.governanceProxy,
    value: 0n,
    data: encodeSetMintLimit(args.mintLimitAccount, args.limit),
    operation: 0,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: ZERO_ADDRESS,
    refundReceiver: ZERO_ADDRESS,
    nonce: args.nonce,
  }
}

function prevalidatedSignature(ownerAddress: string): string {
  const r = zeroPadValue(ownerAddress, 32)
  const s = '0x' + '00'.repeat(32)
  const v = '01'
  return r + s.slice(2) + v
}

export function sortAddresses(addresses: readonly string[]): string[] {
  return [...addresses].sort((a, b) => {
    const aa = BigInt(a.toLowerCase())
    const bb = BigInt(b.toLowerCase())
    return aa < bb ? -1 : aa > bb ? 1 : 0
  })
}

export function buildPrevalidatedSignatures(ownerAddresses: readonly string[]): string {
  const sorted = sortAddresses(ownerAddresses)
  return '0x' + sorted.map((addr) => prevalidatedSignature(addr).slice(2)).join('')
}

export function pickApprovedOwnersForThreshold(
  approvals: OwnerApproval[],
  threshold: bigint,
): string[] {
  const approvedOwners = approvals.filter((x) => x.approved).map((x) => x.owner)

  if (BigInt(approvedOwners.length) < threshold) {
    throw new Error(
      `Недостаточно on-chain approvals: ${approvedOwners.length}/${threshold.toString()}`,
    )
  }

  return sortAddresses(approvedOwners).slice(0, Number(threshold))
}

export function parseLimitInput(
  value: string,
  mode: 'raw' | 'human',
  decimals: number,
): bigint {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('Укажите лимит')
  }

  if (mode === 'raw') {
    if (!/^\d+$/.test(trimmed)) {
      throw new Error('Лимит (raw) должен быть целым числом без пробелов')
    }
    return BigInt(trimmed)
  }

  const normalized = trimmed.replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error('Некорректный формат human-лимита')
  }

  const [whole, fraction = ''] = normalized.split('.')
  if (fraction.length > decimals) {
    throw new Error(`Слишком много знаков после запятой (макс. ${decimals})`)
  }

  const paddedFraction = fraction.padEnd(decimals, '0')
  return BigInt(`${whole}${paddedFraction}`)
}

export function formatRawLimit(value: bigint, decimals: number, human: boolean): string {
  if (!human) return value.toString()
  const negative = value < 0n
  const abs = negative ? -value : value
  const raw = abs.toString().padStart(decimals + 1, '0')
  const whole = raw.slice(0, -decimals) || '0'
  const fraction = raw.slice(-decimals).replace(/0+$/, '')
  const formatted = fraction ? `${whole}.${fraction}` : whole
  return negative ? `-${formatted}` : formatted
}
