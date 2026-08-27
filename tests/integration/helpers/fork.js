import { network } from 'hardhat'

import initBermudaSdk from '@bermuda/sdk'

import {
  AbiCoder,
  Contract,
  JsonRpcProvider,
  Wallet,
  keccak256,
  parseEther,
  toBeHex,
  zeroPadValue
} from 'ethers'

import { serveRpc } from './rpc-server.js'

/** @typedef {import('ethers').Provider} Provider */

// A fork of plasma-testnet is the only environment where this package's Bermuda
// paths can be driven for real: it is the chain whose SDK config carries a
// `WXPL` wrapped-native token (`testenv` does not), and its pool, tokens and
// verifier are all already deployed.

// keccak256('wdk-wallet-bermuda integration faucet'). Deliberately NOT one of the
// well-known Hardhat development keys: those addresses have real transaction
// histories on public testnets, and a fork inherits the nonce that comes with
// them. It only ever holds fork-local funds, and it must NOT be an account the
// tests exercise — the wallet under test has to own every transaction it sends.
const FAUCET_PRIVATE_KEY = '0xcd4640168078addac4b6af3992ca5cc5029e84377795ca0d0d3310b2de00cc58'

const WRAPPED_NATIVE_ABI = [
  'function deposit() payable',
  'function transfer(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)'
]

/**
 * Resolves the RPC endpoint to fork from.
 *
 * Defaults to the endpoint the installed SDK is built against, rather than a copy
 * pinned in this repository, so an SDK upgrade carries the endpoint with it.
 *
 * @returns {string} The plasma-testnet RPC url.
 */
export function forkUrl () {
  if (process.env.PLASMA_TESTNET_RPC_URL) return process.env.PLASMA_TESTNET_RPC_URL

  return initBermudaSdk('plasma-testnet').config.provider._getConnection().url
}

/**
 * The block the fork is pinned to.
 *
 * Pinned rather than floating so runs are deterministic and EDR can serve the
 * chain from its local fork cache instead of re-fetching state every run.
 *
 * @type {number}
 */
export const FORK_BLOCK_NUMBER = 31_990_000

/**
 * The `network.create()` override that produces the fork.
 *
 * The chain id must be set explicitly: EDR keeps the configured chain id when
 * forking, so without this the node reports 31337 and `chainIdToName` resolves to
 * `testenv` instead of `plasma-testnet`.
 *
 * @returns {Object} The network config override.
 */
export function forkOverride () {
  return {
    type: 'edr-simulated',
    chainId: 9746,
    forking: {
      url: forkUrl(),
      blockNumber: FORK_BLOCK_NUMBER
    }
  }
}

/**
 * Brings up a forked plasma-testnet node and serves it over HTTP JSON-RPC.
 *
 * A block is mined immediately. EDR has no hardfork activation history for chain
 * 9746, so while `latest` is still the fork block it refuses to execute calls
 * against it ("No known hardfork for execution on historical block …"). Mining
 * once moves `latest` past the fork point and the node behaves normally.
 *
 * @returns {Promise<{ hre: Object, url: string, close: () => Promise<void> }>}
 */
export async function startFork () {
  const hre = await network.create({
    network: 'hardhat',
    chainType: 'l1',
    override: forkOverride()
  })

  const rpc = await serveRpc(hre.provider)

  await hre.provider.request({ method: 'hardhat_mine', params: ['0x1'] })

  return {
    hre,
    url: rpc.url,
    close: async () => {
      await rpc.close()
    }
  }
}

/**
 * Credits an address with native funds on the fork.
 *
 * @param {Object} provider - The Hardhat EIP-1193 provider.
 * @param {string} address - The address to credit.
 * @param {bigint} [amount] - The amount of native currency (in wei).
 */
export async function setBalance (provider, address, amount = parseEther('1000')) {
  await provider.request({
    method: 'hardhat_setBalance',
    params: [address, `0x${amount.toString(16)}`]
  })
}

/**
 * Gives an address a wrapped-native (WXPL) balance.
 *
 * The wrapping and the delivery are both done by a faucet account so that the
 * account under test has sent no transactions of its own beforehand. Its nonce
 * would otherwise be one ahead of what ethers reports from its short-lived
 * `eth_getTransactionCount` cache, and the next transaction the wallet signs
 * would be rejected as a duplicate nonce.
 *
 * @param {Object} hardhatProvider - The Hardhat EIP-1193 provider.
 * @param {string} rpcUrl - The JSON-RPC endpoint serving the fork.
 * @param {string} token - The wrapped-native token address.
 * @param {string} recipient - The address to fund.
 * @param {bigint} amount - The token amount (in base units).
 */
export async function fundWrappedNative (hardhatProvider, rpcUrl, token, recipient, amount) {
  const provider = new JsonRpcProvider(rpcUrl)

  try {
    const faucet = new Wallet(FAUCET_PRIVATE_KEY, provider)

    await setBalance(hardhatProvider, faucet.address, amount + parseEther('100'))

    const contract = new Contract(token, WRAPPED_NATIVE_ABI, faucet)

    // Nonces are assigned explicitly. ethers caches `eth_getTransactionCount`
    // briefly, so two transactions sent in quick succession would otherwise both
    // be signed at the same nonce and the second rejected.
    const nonce = await provider.getTransactionCount(faucet.address)

    await (await contract.deposit({ value: amount, nonce })).wait()
    await (await contract.transfer(recipient, amount, { nonce: nonce + 1 })).wait()
  } finally {
    provider.destroy()
  }
}

/**
 * Reads an ERC-20 balance through a plain provider.
 *
 * @param {string} rpcUrl - The JSON-RPC endpoint serving the fork.
 * @param {string} token - The token address.
 * @param {string} address - The holder.
 * @returns {Promise<bigint>} The balance (in base units).
 */
export async function tokenBalanceOf (rpcUrl, token, address) {
  const provider = new JsonRpcProvider(rpcUrl)

  try {
    return await new Contract(token, WRAPPED_NATIVE_ABI, provider).balanceOf(address)
  } finally {
    provider.destroy()
  }
}

/**
 * Reads an ERC-20 allowance through a plain provider.
 *
 * @param {string} rpcUrl - The JSON-RPC endpoint serving the fork.
 * @param {string} token - The token address.
 * @param {string} owner - The owner.
 * @param {string} spender - The spender.
 * @returns {Promise<bigint>} The allowance (in base units).
 */
export async function allowanceOf (rpcUrl, token, owner, spender) {
  const provider = new JsonRpcProvider(rpcUrl)

  try {
    return await new Contract(token, WRAPPED_NATIVE_ABI, provider).allowance(owner, spender)
  } finally {
    provider.destroy()
  }
}

/**
 * Gives an address an ERC-20 balance by writing the token's balance slot.
 *
 * Used for tokens with no faucet on the forked chain. The slot index is a
 * property of the deployed token's storage layout, so it is passed in by the
 * caller rather than guessed here.
 *
 * @param {Object} hardhatProvider - The Hardhat EIP-1193 provider.
 * @param {string} token - The token address.
 * @param {number} slot - The index of the `balanceOf` mapping in storage.
 * @param {string} holder - The address to credit.
 * @param {bigint} amount - The balance to write (in base units).
 */
export async function setTokenBalance (hardhatProvider, token, slot, holder, amount) {
  const key = keccak256(
    AbiCoder.defaultAbiCoder().encode(['address', 'uint256'], [holder, slot])
  )

  await hardhatProvider.request({
    method: 'hardhat_setStorageAt',
    params: [token, key, zeroPadValue(toBeHex(amount), 32)]
  })
}

/**
 * The storage slot holding USDT0's `balanceOf` mapping on plasma-testnet.
 *
 * Determined by probing the deployed contract; see `setTokenBalance`.
 *
 * @type {number}
 */
export const USDT0_BALANCE_SLOT = 1

/**
 * Sets an ERC-20 allowance by writing the token's allowance slot.
 *
 * Used to stand in for an approval the holder made in an earlier session. Writing
 * storage rather than sending an `approve` keeps the account under test at nonce
 * zero, so the transactions the code under test signs are its first.
 *
 * @param {Object} hardhatProvider - The Hardhat EIP-1193 provider.
 * @param {string} token - The token address.
 * @param {number} slot - The index of the `allowance` mapping in storage.
 * @param {string} owner - The token holder.
 * @param {string} spender - The approved spender.
 * @param {bigint} amount - The allowance to write (in base units).
 */
export async function setTokenAllowance (hardhatProvider, token, slot, owner, spender, amount) {
  const coder = AbiCoder.defaultAbiCoder()

  const inner = keccak256(coder.encode(['address', 'uint256'], [owner, slot]))
  const key = keccak256(coder.encode(['address', 'bytes32'], [spender, inner]))

  await hardhatProvider.request({
    method: 'hardhat_setStorageAt',
    params: [token, key, zeroPadValue(toBeHex(amount), 32)]
  })
}

/**
 * The storage slot holding USDT0's `allowance` mapping on plasma-testnet.
 *
 * @type {number}
 */
export const USDT0_ALLOWANCE_SLOT = 2
