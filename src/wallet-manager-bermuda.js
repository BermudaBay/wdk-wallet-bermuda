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

import WalletManager from '@tetherto/wdk-wallet'
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'

import { BrowserProvider, JsonRpcProvider, hexlify } from 'ethers'

import WalletAccountBermuda from './wallet-account-bermuda.js'
import { chainIdToName } from './utils.js'
import initBermudaSdk from '@bermuda/sdk'

/** @typedef {import('ethers').Provider} Provider */

/** @typedef {import("@tetherto/wdk-wallet").FeeRates} FeeRates */

/**  @typedef {import('@bermuda/sdk').ISdk} BermudaSdk */

/**
 * @typedef {Object} BermudaWalletConfig
 * @property {string | Eip1193Provider} [provider] - The url of the rpc provider, or an instance of a class that implements eip-1193.
 * @property {number | bigint} [transferMaxFee] - The maximum fee amount for transfer operations.
 * @property {string} [utxoCache] - Filepath for persisting UTXO cache across sessions.
 * @property {Object} [fs] - node:fs or equivalent.
 */

export default class WalletManagerBermuda extends WalletManager {
  /**
   * Multiplier for normal fee rate calculations (in %).
   *
   * @protected
   * @type {bigint}
   */
  static _FEE_RATE_NORMAL_MULTIPLIER = 110n

  /**
   * Multiplier for fast fee rate calculations (in %).
   *
   * @protected
   * @type {bigint}
   */
  static _FEE_RATE_FAST_MULTIPLIER = 200n

  /**
   * Creates a new Bermuda wallet manager for EVM blockchains.
   *
   * @param {string | Uint8Array} seed The wallet's [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) seed phrase
   * @param {BermudaWalletConfig} [config] - The configuration object.
   */
  constructor (seed, config = {}) {
    super(seed, config)

    /**
     * The evm wallet configuration.
     *
     * @protected
     * @type {BermudaWalletConfig}
     */
    this._config = config

    const { provider } = config

    if (provider) {
      /**
       * An ethers provider to interact with a node of the blockchain.
       *
       * @protected
       * @type {Provider | undefined}
       */
      this._provider = typeof provider === 'string'
        ? new JsonRpcProvider(provider)
        : new BrowserProvider(provider)
    }
  }

  /**
   * Returns the Bermuda account, derived with the indicated EVM wallet's private key as seed.
   *
   * The indices allow for a vast array of Bermuda sub accounts all controlled by given EVM seed wallet.
   *
   * @param {number} [bip44AccountIndex] - The index of the Ethereum account to use as master of the returned Bermuda account (default: 0).
   * @param {number} [bermudaAccountIndex] - The index of the Bermuda account to derive (default: 0).
   * @returns {Promise<WalletAccountBermuda>} The Bermuda account.
   */
  async getBermudaAccount (bip44AccountIndex = 0, bermudaAccountIndex = 0) {
    if (bermudaAccountIndex < 0) throw Error('Account index must not be negative')
    if (!this._provider) throw Error('Missing provider')
    const chainId = await this._provider.getNetwork().then(network => network.chainId)
    const sdkOverrides = {}
    if (this._config.utxoCache) {
      sdkOverrides.utxoCache = this._config.utxoCache
      sdkOverrides.fs = this._config.fs
    }
    const bermuda = initBermudaSdk(chainIdToName(chainId), sdkOverrides)
    await bermuda._.initBbSync() // FIXME
    const ethereumWallet = await this.getAccountByPath(`0'/0/${bip44AccountIndex}`)
    const bermudaAccount = await bermuda.account({ seed: hexlify(ethereumWallet.keyPair.privateKey), id: bermudaAccountIndex })
    return new WalletAccountBermuda(bermuda, ethereumWallet, bermudaAccount)
  }

  /**
   * Returns the wallet account at a specific index (see [BIP-44](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki)).
   *
   * @example
   * // Returns the account with derivation path m/44'/60'/0'/0/1
   * const account = await wallet.getAccount(1);
   * @param {number} [index] - The index of the account to get (default: 0).
   * @returns {Promise<WalletAccountEvm>} The account.
   */
  async getAccount (index = 0) {
    return await this.getAccountByPath(`0'/0/${index}`)
  }

  /**
   * Returns the wallet account at a specific BIP-44 derivation path.
   *
   * @example
   * // Returns the account with derivation path m/44'/60'/0'/0/1
   * const account = await wallet.getAccountByPath("0'/0/1");
   * @param {string} path - The derivation path (e.g. "0'/0/0").
   * @returns {Promise<WalletAccountEvm>} The account.
   */
  async getAccountByPath (path) {
    if (!this._accounts[path]) {
      const account = new WalletAccountEvm(this.seed, path, this._config)

      this._accounts[path] = account
    }

    return this._accounts[path]
  }

  /**
   * Returns the current fee rates.
   *
   * @returns {Promise<FeeRates>} The fee rates (in weis).
   */
  async getFeeRates () {
    if (!this._provider) {
      throw new Error('The wallet must be connected to a provider to get fee rates.')
    }

    const data = await this._provider.getFeeData()

    const feeRate = data.maxFeePerGas || data.gasPrice

    return {
      normal: feeRate * WalletManagerBermuda._FEE_RATE_NORMAL_MULTIPLIER / 100n,
      fast: feeRate * WalletManagerBermuda._FEE_RATE_FAST_MULTIPLIER / 100n
    }
  }
}
