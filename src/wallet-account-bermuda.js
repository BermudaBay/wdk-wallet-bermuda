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

import WalletAccountEvm from '@tetherto/wdk-wallet-evm'

/** @typedef {import('ethers').HDNodeWallet} HDNodeWallet */
/** @typedef {import('ethers').AuthorizationRequest} AuthorizationRequest */
/** @typedef {import('ethers').Authorization} Authorization */
/** @typedef {import('ethers').AuthorizationLike} AuthorizationLike */

/** @typedef {import('@tetherto/wdk-wallet').IWalletAccount} IWalletAccount */

/** @typedef {import('@tetherto/wdk-wallet').KeyPair} KeyPair */
/** @typedef {import('@tetherto/wdk-wallet').TransactionResult} TransactionResult */
/** @typedef {import('@tetherto/wdk-wallet').TransferResult} TransferResult */

/** @typedef {import('./wallet-account-read-only-evm.js').TypedData} TypedData */
/** @typedef {import('./wallet-account-read-only-evm.js').EvmTransaction} EvmTransaction */
/** @typedef {import('./wallet-account-read-only-evm.js').EvmTransferOptions} EvmTransferOptions */
/** @typedef {import('./wallet-account-read-only-evm.js').EvmWalletConfig} EvmWalletConfig */

/**  @typedef {import('@bermuda/sdk').ISdk} BermudaSdk */
/** @typedef {import('@bermuda/sdk').KeyPair} BermudaKeyPair */
/** @typedef {import('@bermuda/sdk').IDepositOptions} BermudaDepositOptions */
/** @typedef {import('@bermuda/sdk').ITransferOptions} BermudaTransferOptions */
/** @typedef {import('@bermuda/sdk').IWithdrawOptions} BermudaWithdrawOptions */
/** @typedef {import('@bermuda/sdk').IPayload} Payload */

/**
 * @typedef {Object} BermudaDepositParams
 * @property {string} token - The address of the token to deposit.
 * @property {string} to - The Bermuda address of the recipient, defaults to self.
 * @property {number | bigint} amount - The amount of tokens to approve to the spender.
 * @property {string} note - Optional transaction note.
 * @property {Array<{ to: string, amount: number | bigint, note?: string }>} recipients - Optional multiple recipients.
 */

/**
 * @typedef {Object} BermudaTransferParams
 * @property {string} token - The address of the token to transfer.
 * @property {string} to - The Bermuda address of the recipient.
 * @property {number | bigint} amount - The amount of tokens to transfer.
 * @property {string} note - Optional transaction note.
 * @property {Array<{ to: string, amount: number | bigint, note?: string }>} recipients - Optionally multiple recipients.
 */

/**
 * @typedef {Object} BermudaWithdrawParams
 * @property {string} token - The address of the token to withdraw.
 * @property {string} to - The Ethereum address of the recipient.
 * @property {number | bigint} amount - The amount of tokens to withdraw.
 */

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
     * The account.
     *
     * @protected
     * @type {HDNodeWallet}
     */
    this._ethereumWallet = ethereumWallet

    /**
     * The Bermuda key pair.
     *
     * @protected
     * @type {BermudaKeyPair}
     */
    this._bermudaKeyPair = bermudaKeyPair
  }

  /**
   * Get the Bermuda address.
   */
  getAddress() {
    this._bermudaKeyPair.address()
  }

  /**
   * The account's address.
   *
   * @type {string}
   */
  get address () {
    return this._address
  }

  /**
   * Returns the account balance for a specific token.
   *
   * @param {string} tokenAddress - The smart contract address of the token.
   * @returns {Promise<bigint>} The token balance (in base unit).
   */
  async getTokenBalance (tokenAddress) {
    return await this._bermuda.balance(this._bermudaKeyPair, [tokenAddress]).then(balances => balances[tokenAddress])
  }

  /**
   * Returns the account balances for multiple tokens.
   *
   * @param {string[]} tokenAddresses - The smart contract addresses of the tokens.
   * @returns {Promise<Record<string, bigint>>} A mapping of token addresses to their balances (in base units).
   */
  async getTokenBalances (tokenAddresses) {
    return await this._bermuda.balance(this._bermudaKeyPair, tokenAddresses)
  }

  /**
   * Shield funds.
   * 
   * @param {BermudaDepositParams} params 
   * @param {BermudaDepositOptions} options 
   * @returns Transaction hash
   */
  async deposit(params, options) {
    params.signer = this._ethereumWallet

    if (!params.to && !params.recipients) {
      params.to = this._bermudaKeyPair.address()
    }

    const payload = await this._bermuda.deposit(params, options)

    if (options.fee) {
      return await this._bermuda.relay(payload)
    } else {
      return this._ethereumWallet.sendTransaction(payload).then(res => res.hash)
    }
  }

  /**
   * Transfer shielded funds.
   * 
   * @param {BermudaTransferParams} params 
   * @param {BermudaTransferOptions} options
   * @returns Transaction hash
   */
  async transfer(params, options) {
    params.spender = this._bermudaKeyPair

    const payload = await this._bermuda.transfer(params, options)

    return await this._bermuda.relay(payload)
  }

  /**
   * Unshield funds.
   * 
   * @param {BermudaWithdrawParams} params 
   * @param {BermudaWithdrawOptions} options
   * @returns Transaction hash
   */
  async withdraw(params, options) {
    params.spender = this._bermudaKeyPair

    const payload = await this._bermuda.transfer(params, options)

    return await this._bermuda.relay(payload)
  } 

  /**
   * Disposes the wallet account, erasing the private key from the memory.
   */
  dispose () {
    this._ethereumWallet.dispose()
    this._bermudaKeyPair.privkey = null
    this._bermudaKeyPair.x25519.secretKey.fill(0)
  }
}
