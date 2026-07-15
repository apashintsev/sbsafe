process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
throw new Error("PRIVATE_KEY не передан. Запустите скрипт через bat-файл.");
}
const { ethers } = require("./ethers.js");

// ================== CONFIG ==================

const ETHERSCAN_API_KEY = "4BHY9629UBX4G51UGWWFR8M3EXEAMF297S";
const NETWORK = "sepolia";

const SAFE_ADDRESS = "0xfc60C1e51cD25e15F1F97bAFA4040E0D79c4e1C6";
const GOVERNANCE_PROXY_ADDRESS = "0x01a41bcFc4613637C1f63eE63fD620227C125ce3";

// Treasury Адрес
const MINT_LIMIT_ACCOUNT = "0xfc60C1e51cD25e15F1F97bAFA4040E0D79c4e1C6";

const USE_HUMAN_UNITS = false;
const TOKEN_DECIMALS = 6;
const EXEC_GAS_LIMIT = 130000n;

// ============================================

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const SAFE_ABI = [
  "function nonce() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function approveHash(bytes32 hashToApprove)",
  "function approvedHashes(address owner, bytes32 hash) view returns (uint256)",
  "function getTransactionHash(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 _nonce) view returns (bytes32)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool success)"
];

const GOVERNANCE_ABI = [
  "function setMintLimit(address account,uint256 limit)"
];


function parseLimit(value) {
  if (USE_HUMAN_UNITS) {
    return ethers.parseUnits(value, TOKEN_DECIMALS);
  }
  const n = BigInt(value);
  return n;
}

function prevalidatedSignature(ownerAddress) {
  const r = ethers.zeroPadValue(ownerAddress, 32);
  const s = "0x" + "00".repeat(32);
  const v = "01";

  return r + s.slice(2) + v;
}

function sortAddresses(addresses) {
  return [...addresses].sort((a, b) => {
    const aa = BigInt(a.toLowerCase());
    const bb = BigInt(b.toLowerCase());
    return aa < bb ? -1 : aa > bb ? 1 : 0;
  });
}

function buildPrevalidatedSignatures(ownerAddresses) {
  const sorted = sortAddresses(ownerAddresses);
  return "0x" + sorted.map(addr => prevalidatedSignature(addr).slice(2)).join("");
}

async function buildSafeTx(safe, limit) {
  const governanceInterface = new ethers.Interface(GOVERNANCE_ABI);
  const nonce = await safe.nonce();

  const data = governanceInterface.encodeFunctionData(
    "setMintLimit",
    [MINT_LIMIT_ACCOUNT, limit]
  );

  const txParams = {
    to: GOVERNANCE_PROXY_ADDRESS,
    value: 0n,
    data,
    operation: 0,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: ZERO_ADDRESS,
    refundReceiver: ZERO_ADDRESS,
    nonce
  };

  const safeTxHash = await safe.getTransactionHash(
    txParams.to,
    txParams.value,
    txParams.data,
    txParams.operation,
    txParams.safeTxGas,
    txParams.baseGas,
    txParams.gasPrice,
    txParams.gasToken,
    txParams.refundReceiver,
    txParams.nonce
  );

  return { txParams, safeTxHash };
}

async function getApprovals(safe, owners, safeTxHash) {
  const result = [];

  for (const owner of owners) {
    const approved = await safe.approvedHashes(owner, safeTxHash);
    result.push({
      owner,
      approved: approved !== 0n
    });
  }

  return result;
}

async function printReview({
  mode,
  signerAddress,
  owners,
  threshold,
  txParams,
  safeTxHash,
  limit,
  currentApprovals
}) {
  console.log("==========================================");
  console.log("SET MINT LIMIT REVIEW");
  console.log("==========================================");
  console.log("Mode:", mode);
  console.log("Signer / executor:", signerAddress || "read-only");
  console.log("Network:", NETWORK);
  console.log("Safe:", SAFE_ADDRESS);
  console.log("Governance proxy:", GOVERNANCE_PROXY_ADDRESS);
  console.log("Function:", "setMintLimit(address,uint256)");
  console.log("Mint limit account:", MINT_LIMIT_ACCOUNT);
  console.log("Limit raw:", limit.toString());

  if (USE_HUMAN_UNITS) {
    console.log("Limit human input mode:", "enabled");
    console.log("Token decimals:", TOKEN_DECIMALS.toString());
  }

  console.log("Safe nonce:", txParams.nonce.toString());
  console.log("Calldata:", txParams.data);
  console.log("Expected selector:", ethers.id("setMintLimit(address,uint256)").slice(0, 10));
  console.log("Safe tx hash:", safeTxHash);
  console.log("Owners:", owners);
  console.log("Threshold:", threshold.toString());
  console.log("------------------------------------------");

  if (currentApprovals) {
    console.log("Current on-chain approvals for this exact hash:");

    for (const item of currentApprovals) {
      console.log(
        item.owner,
        item.approved ? "APPROVED" : "not approved"
      );
    }

    const count = currentApprovals.filter(x => x.approved).length;
    console.log("Approved count:", count.toString(), "/", threshold.toString());
  }

  console.log("==========================================");
}

function pickApprovedOwnersForThreshold(approvals, threshold) {
  const approvedOwners = approvals
    .filter(x => x.approved)
    .map(x => x.owner);

  if (BigInt(approvedOwners.length) < threshold) {
    throw new Error(
      `Недостаточно on-chain approvals: ${approvedOwners.length}/${threshold.toString()}`
    );
  }

  return sortAddresses(approvedOwners).slice(0, Number(threshold));
}

async function approveMode({ safe, wallet, owners, threshold, txParams, safeTxHash, limit }) {
  const isOwner = owners
    .map(a => a.toLowerCase())
    .includes(wallet.address.toLowerCase());

  if (!isOwner) {
    throw new Error("Введённый PRIVATE_KEY не принадлежит owner'у Safe");
  }

  const approvals = await getApprovals(safe, owners, safeTxHash);

  await printReview({
    mode: "approveHash on-chain",
    signerAddress: wallet.address,
    owners,
    threshold,
    txParams,
    safeTxHash,
    limit,
    currentApprovals: approvals
  });

  const alreadyApproved = await safe.approvedHashes(wallet.address, safeTxHash);

  if (alreadyApproved !== 0n) {
    console.log("Этот owner уже подписал этот exact Safe tx hash on-chain.");
    return;
  }

  console.log("Sending approveHash...");

  const tx = await safe.approveHash(safeTxHash);

  console.log("approveHash tx sent:", tx.hash);

  const receipt = await tx.wait();

  console.log("approveHash confirmed in block:", receipt.blockNumber);

  const approvalsAfter = await getApprovals(safe, owners, safeTxHash);
  const approvedCount = approvalsAfter.filter(x => x.approved).length;

  console.log("Approvals after tx:", approvedCount.toString(), "/", threshold.toString());
}

async function checkMode({ safe, owners, threshold, txParams, safeTxHash, limit }) {
  const approvals = await getApprovals(safe, owners, safeTxHash);

  await printReview({
    mode: "check approvals",
    signerAddress: null,
    owners,
    threshold,
    txParams,
    safeTxHash,
    limit,
    currentApprovals: approvals
  });
}

async function executeMode({ provider, safe, wallet, owners, threshold, txParams, safeTxHash, limit }) {
  const approvals = await getApprovals(safe, owners, safeTxHash);

  await printReview({
    mode: "execute",
    signerAddress: wallet.address,
    owners,
    threshold,
    txParams,
    safeTxHash,
    limit,
    currentApprovals: approvals
  });

  const approvedOwnersForExecution = pickApprovedOwnersForThreshold(approvals, threshold);

  console.log("Using approved owners for signatures:");
  console.log(approvedOwnersForExecution);

  const signatures = buildPrevalidatedSignatures(approvedOwnersForExecution);

  console.log("Signatures length bytes:", (signatures.length - 2) / 2);

  console.log("=== DEBUG: direct eth_call as Safe ===");

  try {
    const directCallResult = await provider.call({
      from: SAFE_ADDRESS,
      to: txParams.to,
      data: txParams.data,
      value: txParams.value
    });

    console.log("Direct call as Safe would succeed:", directCallResult);
  } catch (e) {
    console.error("Direct call as Safe would REVERT.");
    console.error("Проверьте права Safe на setMintLimit и параметры account/limit.");
    console.error(e);
    process.exit(1);
  }

  console.log("=== DEBUG: estimateGas execTransaction ===");

  try {
    const estimated = await safe.execTransaction.estimateGas(
      txParams.to,
      txParams.value,
      txParams.data,
      txParams.operation,
      txParams.safeTxGas,
      txParams.baseGas,
      txParams.gasPrice,
      txParams.gasToken,
      txParams.refundReceiver,
      signatures
    );

    console.log("Estimated gas:", estimated.toString());
  } catch (e) {
    console.error("execTransaction estimateGas failed.");
    console.error("Если ошибка GS013 — чаще всего откатился внутренний вызов setMintLimit.");
    console.error(e);
    process.exit(1);
  }

  console.log("Sending execTransaction...");

  const tx = await safe.execTransaction(
    txParams.to,
    txParams.value,
    txParams.data,
    txParams.operation,
    txParams.safeTxGas,
    txParams.baseGas,
    txParams.gasPrice,
    txParams.gasToken,
    txParams.refundReceiver,
    signatures,
    {
      gasLimit: EXEC_GAS_LIMIT
    }
  );

  console.log("execTransaction sent:", tx.hash);

  const receipt = await tx.wait();

  console.log("Confirmed in block:", receipt.blockNumber);
  console.log("Receipt status:", receipt.status.toString());

  if (receipt.status === 1) {
    console.log("SUCCESS: setMintLimit executed through Safe");
  } else {
    console.log("FAILED: transaction reverted");
  }
}

async function main() {
  const mode = process.argv[2];
  const limitInput = process.argv[3];

  if (!["approve", "check", "execute"].includes(mode)) {
    throw new Error("Usage: node safe_set_mint_limit_menu.js approve|check|execute <LIMIT>");
  }

  if (!limitInput) {
    throw new Error("LIMIT не передан");
  }

  const limit = parseLimit(limitInput);
  const provider = new ethers.EtherscanProvider(NETWORK, ETHERSCAN_API_KEY);
  const net = await provider.getNetwork();

  console.log("Connected network:", net.name, net.chainId.toString());

  let wallet = null;
  let signerOrProvider = provider;

  if (mode !== "check") {
    wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    signerOrProvider = wallet;
  }

  const safe = new ethers.Contract(SAFE_ADDRESS, SAFE_ABI, signerOrProvider);

  const owners = await safe.getOwners();
  const threshold = await safe.getThreshold();

  const { txParams, safeTxHash } = await buildSafeTx(safe, limit);

  if (mode === "approve") {
    await approveMode({ safe, wallet, owners, threshold, txParams, safeTxHash, limit });
    return;
  }

  if (mode === "check") {
    await checkMode({ safe, owners, threshold, txParams, safeTxHash, limit });
    return;
  }

  if (mode === "execute") {
    await executeMode({ provider, safe, wallet, owners, threshold, txParams, safeTxHash, limit });
    return;
  }
}

main().catch((err) => {
  console.error("ERROR:", err);
  process.exit(1);
});
