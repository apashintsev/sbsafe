export const SAFE_ABI = [
  'function nonce() view returns (uint256)',
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function approveHash(bytes32 hashToApprove)',
  'function approvedHashes(address owner, bytes32 hash) view returns (uint256)',
  'function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns (bytes32)',
  'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool success)',
] as const

export const GOVERNANCE_ABI = [
  'function setMintLimit(address account,uint256 limit)',
  'function actualMintLimit(address actor) view returns (uint256)',
] as const
