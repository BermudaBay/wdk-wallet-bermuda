// Copyright 2024 Tether Operations Limited
// Copyright 2026 Hyperpool AG
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict'

import { isNativeDepositToken, proveWithinPeriod } from '@bermuda/sdk'
import { TransactionError, TransactionErrorReason } from '@tetherto/wdk-wallet'

import { Contract } from 'ethers'

import { withoutWarnings } from './utils.js'

/** @typedef {import('ethers').HDNodeWallet} HDNodeWallet */
/** @typedef {import('ethers').AuthorizationRequest} AuthorizationRequest */
/** @typedef {import('ethers').Authorization} Authorization */
/** @typedef {import('ethers').AuthorizationLike} AuthorizationLike */

/** @typedef {import('@tetherto/wdk-wallet').IWalletAccount} IWalletAccount */

/** @typedef {import('@tetherto/wdk-wallet').KeyPair} KeyPair */
/** @typedef {import('@tetherto/wdk-wallet').TransactionResult} TransactionResult */
/** @typedef {import('@tetherto/wdk-wallet').TransferResult} TransferResult */
/** @typedef {import('@tetherto/wdk-wallet-evm').WalletAccountEvm} WalletAccountEvm */

/** @typedef {import('@tetherto/wdk-wallet-evm').TypedData} TypedData */
/** @typedef {import('@tetherto/wdk-wallet-evm').EvmTransaction} EvmTransaction */
/** @typedef {import('@tetherto/wdk-wallet-evm').EvmTransferOptions} EvmTransferOptions */
/** @typedef {import('@tetherto/wdk-wallet-evm').EvmWalletConfig} EvmWalletConfig */

/**  @typedef {import('@bermuda/sdk').ISdk} BermudaSdk */
/** @typedef {import('@bermuda/sdk').KeyPair} BermudaKeyPair */
/** @typedef {import('@bermuda/sdk').IDepositOptions} BermudaDepositOptions */
/** @typedef {import('@bermuda/sdk').ITransferOptions} BermudaTransferOptions */
/** @typedef {import('@bermuda/sdk').IWithdrawOptions} BermudaWithdrawOptions */
/** @typedef {import('@bermuda/sdk').IPayload} Payload */

/**
 * @typedef {Object} BermudaDepositParams
 * @property {string} token - The address of the token to deposit, or `NATIVE_DEPOSIT_TOKEN` (the zero address) to deposit the chain's native currency.
 * @property {string} [to] - The Bermuda address of the recipient, defaults to self.
 * @property {number | bigint} [amount] - The amount of tokens to deposit, unless `recipients` are given.
 * @property {string} [memo] - Optional payment memo.
 * @property {Array<{ to: string, amount: number | bigint, memo?: string }>} [recipients] - Optional multiple recipients.
 */

/**
 * @typedef {Object} BermudaTransferParams
 * @property {string} token - The address of the token to transfer.
 * @property {string} [to] - The Bermuda address of the recipient, unless `recipients` are given.
 * @property {number | bigint} [amount] - The amount of tokens to transfer, unless `recipients` are given.
 * @property {string} [memo] - Optional payment memo.
 * @property {Array<{ to: string, amount: number | bigint, memo?: string }>} [recipients] - Optionally multiple recipients.
 */

/**
 * @typedef {Object} BermudaWithdrawParams
 * @property {string} token - The address of the token to withdraw.
 * @property {string} [to] - The Ethereum address of the recipient.
 * @property {number | bigint} amount - The amount of tokens to withdraw.
 */

// The start of the warning the SDK logs when it cannot permit a deposit of a token, before it falls back to the
// allowance the depositor gave the pool.
const PERMIT_FALLBACK_WARNING = 'deposit: EIP-2612 permit unavailable for '

/**
 * Returns whether a warning is the SDK's that it cannot permit a deposit of a token.
 *
 * @param {string} token - The token's address.
 * @returns {(args: unknown[]) => boolean} Whether a warning, given the arguments it is logged with, is that one.
 */
function isPermitFallbackOf (token) {
  const prefix = `${PERMIT_FALLBACK_WARNING}${token}`.toLowerCase()

  return ([message]) => typeof message === 'string' && message.toLowerCase().startsWith(prefix)
}

/**
 * Returns a payment's parameters with its amounts, and those of its recipients, as bigints, which the SDK computes
 * with.
 *
 * @template {{ amount?: number | bigint, recipients?: Array<{ amount: number | bigint }> }} T
 * @param {T} params - The payment's parameters.
 * @returns {T} The parameters, amounts as bigints.
 */
function withBigIntAmounts (params) {
  const result = { ...params }

  if (params.amount !== undefined) {
    result.amount = BigInt(params.amount)
  }

  if (params.recipients) {
    result.recipients = params.recipients.map(recipient => ({ ...recipient, amount: BigInt(recipient.amount) }))
  }

  return result
}

export default class WalletAccountBermuda {
  /**
   * Creates a new Bermuda EVM wallet account.
   *
   *
   * @param {BermudaSdk} bermudaSdk - The Bermuda SDK.
   * @param {WalletAccountEvm} ethereumWallet - The master Ethereum wallet account.
   * @param {BermudaKeyPair} bermudaKeyPair - The Bermuda key pair.
   */
  constructor (bermudaSdk, ethereumWallet, bermudaKeyPair) {
    /**
     * The Bermuda SDK instance.
     *
     * Only available on Plasma testnet for now.
     *
     * @protected
     * @type {BermudaSdk}
     */
    this._bermuda = bermudaSdk

    /**
     * The master Ethereum account.
     *
     * @protected
     * @type {WalletAccountEvm}
     */
    this._ethereumWallet = ethereumWallet

    /**
     * The Bermuda key pair.
     *
     * @protected
     * @type {BermudaKeyPair}
     */
    this._bermudaKeyPair = bermudaKeyPair

    /** @private */
    this._disposed = false
  }

  /**
   * Get the Bermuda address.
   *
   * @returns {string} The Bermuda address.
   */
  getAddress () {
    return this._bermudaKeyPair.address()
  }

  /**
   * The account's address.
   *
   * @type {string}
   */
  get address () {
    return this._bermudaKeyPair.address()
  }

  /**
   * Returns the account balance for a specific token.
   *
   * Value held in the token's vaulted class counts at what it is worth in the token.
   *
   * @param {string} tokenAddress - The smart contract address of the token.
   * @returns {Promise<bigint>} The token balance (in base unit).
   */
  async getTokenBalance (tokenAddress) {
    const token = tokenAddress.toLowerCase()
    const balances = await this._bermuda.balance(this._bermudaKeyPair, [token])
    return balances[token] ?? 0n
  }

  /**
   * Returns the account balances for multiple tokens.
   *
   * Value held in a token's vaulted class counts at what it is worth in the token.
   *
   * @param {string[]} tokenAddresses - The smart contract addresses of the tokens.
   * @returns {Promise<Record<string, bigint>>} A mapping of token addresses to their balances (in base units).
   */
  async getTokenBalances (tokenAddresses) {
    const tokens = tokenAddresses.map(a => a.toLowerCase())

    // The SDK reads every token of the chain when asked for none.
    if (tokens.length === 0) {
      return {}
    }

    const balances = await this._bermuda.balance(this._bermudaKeyPair, tokens)
    const result = {}
    for (const token of tokens) {
      result[token] = balances[token] ?? 0n
    }
    return result
  }

  /**
   * Adapts the Ethereum account's signer to the ethers signer shape the
   * Bermuda SDK expects.
   *
   * `@tetherto/wdk-wallet-evm` keeps its key material behind an `ISignerEvm`,
   * whose `signTypedData` takes a single `{ domain, types, message }` object,
   * while the SDK calls the positional ethers signature. The provider is
   * attached so the SDK can resolve the chain id and read contracts through
   * the signer.
   *
   * @protected
   * @returns {Object} An ethers-compatible signer.
   */
  _getEthersSigner () {
    const signer = this._ethereumWallet._signer

    return {
      provider: this._bermuda.config.provider,
      getAddress: () => this._ethereumWallet.getAddress(),
      signMessage: message => signer.sign(message),
      signTypedData: (domain, types, message) => signer.signTypedData({ domain, types, message })
    }
  }

  /**
   * Shield funds.
   *
   * The deposit recipient defaults to this Bermuda account. Pass `NATIVE_DEPOSIT_TOKEN` as the token to deposit the
   * chain's native currency, which the pool wraps.
   *
   * The deposit is sent by the master Ethereum account, so the wallet's `transactionMaxFee` caps its network fee, and
   * that of the approval sent first for the wrapped native token, which supports no permits. The deposit fees the pool
   * charges (its protocol fee, and the compliance engine's one-off lifetime fee) come on top of the amount, in the
   * deposited token, and are not capped; the approval covers them too.
   *
   * Before anything is sent, the master Ethereum account must hold what the deposit pays: its amount and fees, in the
   * deposited token, or in the native currency for `NATIVE_DEPOSIT_TOKEN`.
   *
   * @param {BermudaDepositParams} params - The deposit's parameters.
   * @param {BermudaDepositOptions} [options] - The deposit's options.
   * @returns {Promise<string>} The transaction hash.
   * @throws {TransactionError} If the master Ethereum account holds less than the deposit pays, with the reason
   * `INSUFFICIENT_BALANCE`. Nothing is sent then.
   */
  async deposit (params, options = {}) {
    const selfAddress = this._bermudaKeyPair.address()

    const depositParams = { ...withBigIntAmounts(params), signer: this._getEthersSigner() }

    if (!depositParams.to && !depositParams.recipients) {
      depositParams.to = selfAddress
    }

    const opts = { ...options }
    if (depositParams.to === selfAddress || depositParams.recipients?.some(r => r.to === selfAddress)) {
      opts.topup = this._bermudaKeyPair
    }

    // The pool pulls the deposit's funds, fees included, from the master Ethereum account. The SDK signs an EIP-2612
    // permit for that when the allowance falls short, which WXPL (WETH9) does not support, so it is approved here
    // instead, once the deposit tells how much the pool pulls. The SDK's warning that it falls back to the allowance
    // is expected then, and dropped.
    const isWrappedNative =
      this._bermuda.config.WXPL &&
      params.token.toLowerCase() === this._bermuda.config.wrappedNativeToken.toLowerCase()

    const payload = isWrappedNative
      ? await withoutWarnings(isPermitFallbackOf(params.token), () => this._bermuda.deposit(depositParams, opts))
      : await this._bermuda.deposit(depositParams, opts)

    // Checked before anything is sent: a deposit the account cannot pay would otherwise only fail once sent, after its
    // approval, when the pool cannot pull the funds. WXPL (WETH9) refuses without a reason, which ethers reports as
    // missing revert data.
    await this._requireFunds(params.token, payload.depositFees.spend)

    let nonce

    if (isWrappedNative) {
      nonce = await this._approvePool(payload.depositFees.spend)
    }

    // A proof carries the period it was made in, which the pool refuses once a new one has begun, so it is made again
    // for the period of the submission.
    return await proveWithinPeriod({
      prove: async attempt => attempt === 0 ? payload : await payload.reprove(),
      submit: async ({ to, data, value }) => {
        const transaction = { to, data, value: value ?? 0n }

        if (nonce !== undefined) {
          transaction.nonce = nonce
        }

        const { hash } = await this._ethereumWallet.sendTransaction(transaction)

        return hash
      }
    })
  }

  /**
   * Transfer shielded funds.
   *
   * The transfer is submitted by a relayer, so neither the wallet's `transferMaxFee` nor its `transactionMaxFee`
   * applies. A relay fee is only charged if `options.relayFee` is set (together with `options.relayer`), and is paid
   * out of the shielded balance, in the transferred token, as is the pool's transfer fee if it charges one.
   *
   * @param {BermudaTransferParams} params - The transfer's parameters.
   * @param {BermudaTransferOptions} [options] - The transfer's options.
   * @returns {Promise<string>} The transaction hash.
   */
  async transfer (params, options = {}) {
    const payload = await this._bermuda.transfer({ ...withBigIntAmounts(params), spender: this._bermudaKeyPair }, options)

    return await this._bermuda.relay(payload)
  }

  /**
   * Unshield funds.
   *
   * The withdrawal recipient defaults to the address of the master Ethereum
   * account.
   *
   * The withdrawal is submitted by a relayer, so neither the wallet's `transferMaxFee` nor its `transactionMaxFee`
   * applies. Its fees are paid out of the shielded balance, in the withdrawn token: the pool's protocol withdrawal fee,
   * plus a relay fee if `options.relayFee` is set (together with `options.relayer`).
   *
   * @param {BermudaWithdrawParams} params - The withdrawal's parameters.
   * @param {BermudaWithdrawOptions} [options] - The withdrawal's options.
   * @returns {Promise<string>} The transaction hash.
   */
  async withdraw (params, options = {}) {
    const withdrawParams = { ...withBigIntAmounts(params), spender: this._bermudaKeyPair }

    if (!withdrawParams.to) {
      withdrawParams.to = this._ethereumWallet.address
    }

    const payload = await this._bermuda.withdraw(withdrawParams, options)

    return await this._bermuda.relay(payload)
  }

  /**
   * True if the account has been disposed.
   *
   * @type {boolean}
   */
  get disposed () {
    return this._disposed
  }

  /**
   * Disposes the wallet account, erasing the Bermuda private keys from the memory.
   *
   * The master Ethereum account is left untouched: it belongs to the wallet manager (or to whoever passed it to the
   * constructor), and other Bermuda accounts derived from it may still be using it.
   */
  dispose () {
    if (this._disposed) return

    this._bermudaKeyPair.privkey = null
    this._bermudaKeyPair.xwing.secretKey.fill(0)

    this._disposed = true
  }

  /**
   * Throws unless the master Ethereum account holds what a deposit pays the pool, in the deposited token, or in the
   * native currency for `NATIVE_DEPOSIT_TOKEN`. The deposit's network fee is not counted.
   *
   * @private
   * @param {string} token - The deposited token's address, or `NATIVE_DEPOSIT_TOKEN`.
   * @param {bigint} amount - What the deposit pays the pool, its amount and fees (in base units).
   * @returns {Promise<void>}
   * @throws {TransactionError} If the account holds less, with the reason `INSUFFICIENT_BALANCE`.
   */
  async _requireFunds (token, amount) {
    const isNative = isNativeDepositToken(token)

    const balance = isNative
      ? await this._ethereumWallet.getBalance()
      : await this._ethereumWallet.getTokenBalance(token)

    if (balance >= amount) {
      return
    }

    const currency = isNative ? 'the native currency' : `token ${token}`

    // Depositing the wrapped native token pulls the token: an account that holds the native currency deposits that.
    const hint = token.toLowerCase() === this._bermuda.config.wrappedNativeToken?.toLowerCase()
      ? ' To shield the native currency instead, deposit NATIVE_DEPOSIT_TOKEN.'
      : ''

    throw new TransactionError(
      `The deposit pays the pool ${amount} of ${currency} (its amount and fees, in base units), but the Ethereum ` +
        `account ${this._ethereumWallet.address} holds ${balance}.${hint}`,
      { reason: TransactionErrorReason.INSUFFICIENT_BALANCE }
    )
  }

  /**
   * Approves the pool to pull an amount of the wrapped native token from the master Ethereum account, unless it may
   * already, and waits for the approval to be mined.
   *
   * The transaction that follows the approval is sent at the next nonce explicitly: ethers briefly caches the
   * account's transaction count, so it would otherwise be signed at the nonce the approval has just used.
   *
   * @private
   * @param {bigint} amount - The amount (in base units).
   * @returns {Promise<number | undefined>} The nonce to send the next transaction at, if an approval was sent.
   */
  async _approvePool (amount) {
    const { provider, pool, wrappedNativeToken } = this._bermuda.config
    const poolAddress = await pool.getAddress()
    const tokenContract = new Contract(wrappedNativeToken, this._bermuda.ERC20_ABI, { provider })

    const allowance = await tokenContract.allowance(this._ethereumWallet.address, poolAddress)

    if (allowance >= amount) {
      return undefined
    }

    // The Ethereum account is not an ethers runner, so the approval is encoded here and broadcast through the
    // account itself.
    const data = tokenContract.interface.encodeFunctionData('approve', [poolAddress, amount])
    const { hash } = await this._ethereumWallet.sendTransaction({ to: wrappedNativeToken, data })

    await provider.waitForTransaction(hash)

    const { nonce } = await provider.getTransaction(hash)

    return nonce + 1
  }
}
