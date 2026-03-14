/**
 * Celo service — wraps viem for all blockchain interactions
 * Network: Alfajores testnet (chainId 44787)
 */

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generatePrivateKey } from 'viem/accounts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Chain Config ─────────────────────────────────────────────────────────────

const celoAlfajores = {
  id: 44787,
  name: 'Celo Alfajores',
  network: 'alfajores',
  nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.CELO_RPC || 'https://alfajores-forno.celo-testnet.org'] }
  },
  blockExplorers: {
    default: { name: 'Celoscan', url: 'https://alfajores.celoscan.io' }
  }
};

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
]);

function loadABI(name) {
  const abiPath = join(__dirname, '../abis', `${name}.json`);
  if (!existsSync(abiPath)) {
    console.warn(`⚠️  ABI not found: ${name}.json — deploy contracts first`);
    return [];
  }
  return JSON.parse(readFileSync(abiPath, 'utf8'));
}

// ─── Clients ─────────────────────────────────────────────────────────────────

export function getPublicClient() {
  return createPublicClient({
    chain: celoAlfajores,
    transport: http(process.env.CELO_RPC || 'https://alfajores-forno.celo-testnet.org')
  });
}

export function getWalletClient(privateKey) {
  const key = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(key);
  return {
    client: createWalletClient({
      account,
      chain: celoAlfajores,
      transport: http(process.env.CELO_RPC || 'https://alfajores-forno.celo-testnet.org')
    }),
    account
  };
}

// ─── Wallet Generation ───────────────────────────────────────────────────────

export function generateWallet() {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { address: account.address, privateKey };
}

// ─── Balance ─────────────────────────────────────────────────────────────────

export async function getCUSDBalance(address) {
  const client = getPublicClient();
  const cusdAddress = process.env.CUSD_ADDRESS || '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1';

  const raw = await client.readContract({
    address: cusdAddress,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [address]
  });

  return {
    raw,
    formatted: parseFloat(formatUnits(raw, 18)).toFixed(2),
    display: `${parseFloat(formatUnits(raw, 18)).toFixed(2)} cUSD`
  };
}

export async function getCELOBalance(address) {
  const client = getPublicClient();
  const raw = await client.getBalance({ address });
  return { raw, formatted: parseFloat(formatUnits(raw, 18)).toFixed(4) };
}

// ─── Transfer ────────────────────────────────────────────────────────────────

export async function sendCUSD({ fromPrivateKey, toAddress, amountCusd, memo = '' }) {
  const cusdAddress = process.env.CUSD_ADDRESS || '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1';
  const { client, account } = getWalletClient(fromPrivateKey);
  const amountWei = parseUnits(String(amountCusd), 18);

  const hash = await client.writeContract({
    account,
    address: cusdAddress,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [toAddress, amountWei]
  });

  return { txHash: hash, explorerUrl: `https://alfajores.celoscan.io/tx/${hash}` };
}

export async function approveCUSD({ fromPrivateKey, spenderAddress, amountCusd }) {
  const cusdAddress = process.env.CUSD_ADDRESS || '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1';
  const { client, account } = getWalletClient(fromPrivateKey);
  const amountWei = parseUnits(String(amountCusd), 18);

  const hash = await client.writeContract({
    account,
    address: cusdAddress,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spenderAddress, amountWei]
  });

  return { txHash: hash };
}

// ─── SplitPayment Contract ───────────────────────────────────────────────────

export async function splitEqualOnChain({ fromPrivateKey, recipients, totalAmountCusd, memo = '' }) {
  const splitAddress = process.env.SPLIT_PAYMENT_ADDRESS;
  const cusdAddress = process.env.CUSD_ADDRESS || '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1';
  const abi = loadABI('SplitPayment');
  const { client, account } = getWalletClient(fromPrivateKey);
  const totalWei = parseUnits(String(totalAmountCusd), 18);

  // Approve the split contract to spend cUSD
  await approveCUSD({ fromPrivateKey, spenderAddress: splitAddress, amountCusd: totalAmountCusd });

  const hash = await client.writeContract({
    account,
    address: splitAddress,
    abi,
    functionName: 'splitEqual',
    args: [cusdAddress, recipients, totalWei, memo]
  });

  return { txHash: hash, explorerUrl: `https://alfajores.celoscan.io/tx/${hash}` };
}

// ─── EsusuCircle Contract ────────────────────────────────────────────────────

export async function contributeToCircle({ fromPrivateKey, contractCircleId, contributionCusd }) {
  const esusuAddress = process.env.ESUSU_CIRCLE_ADDRESS;
  const cusdAddress = process.env.CUSD_ADDRESS || '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1';
  const abi = loadABI('EsusuCircle');
  const { client, account } = getWalletClient(fromPrivateKey);

  // Approve first
  await approveCUSD({ fromPrivateKey, spenderAddress: esusuAddress, amountCusd: contributionCusd });

  const hash = await client.writeContract({
    account,
    address: esusuAddress,
    abi,
    functionName: 'contribute',
    args: [BigInt(contractCircleId)]
  });

  return { txHash: hash, explorerUrl: `https://alfajores.celoscan.io/tx/${hash}` };
}

// ─── Transaction Receipt ─────────────────────────────────────────────────────

export async function waitForTransaction(txHash) {
  const client = getPublicClient();
  const receipt = await client.waitForTransactionReceipt({ hash: txHash });
  return {
    status: receipt.status === 'success' ? 'confirmed' : 'failed',
    blockNumber: Number(receipt.blockNumber),
    gasUsed: receipt.gasUsed.toString()
  };
}

export function getExplorerUrl(txHash) {
  return `https://alfajores.celoscan.io/tx/${txHash}`;
}
