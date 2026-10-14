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

import { ProviderRequiredError, ValueError, WdkError } from '@tetherto/wdk-wallet'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'

import { hexlify } from 'ethers'

import WalletAccountBermuda from './wallet-account-bermuda.js'
import { chainIdToName } from './utils.js'
import initBermudaSdk from '@bermuda/sdk'

/** @typedef {import('@tetherto/wdk-wallet').FeeRates} FeeRates */

/** @typedef {import('@tetherto/wdk-wallet-evm').EvmWalletConfig} EvmWalletConfig */

/**  @typedef {import('@bermuda/sdk').ISdk} BermudaSdk */
/** @typedef {import('@bermuda/sdk').IConfigInput} BermudaSdkConfig */

/**
 * @typedef {Object} BermudaConfig
 * @property {string} [utxoCache] - Filepath for persisting UTXO cache across sessions.
 * @property {string} [commitmentEventsCache] - Filepath for persisting the chain state the SDK syncs, the pool's commitment events among it, across sessions (default: derived from the utxo cache's filepath).
 * @property {Object} [fs] - node:fs or equivalent.
 * @property {BermudaSdkConfig} [bermuda] - Options of the Bermuda SDK, applied over its preset for the chain (e.g. `depositClass`, `relayer` or `rpcUrls`). A `provider` or `rpcUrls` given here replaces the wallet's provider for the SDK.
 */

/**
 * The configuration of a Bermuda wallet: the configuration of an evm wallet, plus the Bermuda specific options.
 *
 * The fee caps of the evm configuration are enforced by the evm accounts, so they only bound network fees the wallet
 * pays itself, in weis:
 * - `transferMaxFee` caps the token transfers of the evm accounts (`WalletAccountEvm#transfer`).
 * - `transactionMaxFee` caps the transactions they send (`WalletAccountEvm#sendTransaction`), which include the
 *   deposits of Bermuda accounts and the approvals sent before depositing the wrapped native token.
 *
 * Neither caps the shielded transfers and withdrawals of Bermuda accounts: a relayer submits those, and their relay
 * and protocol fees are paid out of the shielded balance, in the token moved. Nor do they cap a protocol deposit fee,
 * paid in the deposited token.
 *
 * @typedef {EvmWalletConfig & BermudaConfig} BermudaWalletConfig
 */

export default class WalletManagerBermuda extends WalletManagerEvm {
  /**
   * Creates a new Bermuda wallet manager for EVM blockchains.
   *
   * @param {string | Uint8Array} seed The wallet's [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) seed phrase
   * @param {BermudaWalletConfig} [config] - The configuration object.
   * @throws {ValueError} If the seed phrase is invalid.
   */
  constructor (seed, config = {}) {
    // The evm wallet manager rejects an invalid seed phrase with a plain error, so
    // it is checked here first to keep failing with the WDK one.
    if (typeof seed === 'string' && !WalletManagerBermuda.isValidSeedPhrase(seed)) {
      throw new ValueError('Invalid seed phrase.')
    }

    super(seed, config)

    /**
     * The Bermuda wallet configuration.
     *
     * @protected
     * @type {BermudaWalletConfig}
     */
    this._config = config

    /**
     * A map between '<bip-44 account index>/<bermuda account index>' keys and the Bermuda accounts derived so far. The
     * {@link dispose} method disposes all of them, along with the evm accounts.
     *
     * @protected
     * @type {Record<string, WalletAccountBermuda>}
     */
    this._bermudaAccounts = {}

    /**
     * The derivations of Bermuda accounts still in flight, by the same keys, so concurrent requests share one.
     *
     * @private
     * @type {Record<string, Promise<WalletAccountBermuda>>}
     */
    this._pendingBermudaAccounts = {}

    /**
     * True if the default signer was created here from the seed, and so is the wallet's to dispose.
     *
     * @private
     * @type {boolean}
     */
    this._ownsDefaultSigner = typeof seed === 'string' || seed instanceof Uint8Array

    // Not `_disposed`: newer versions of the base wallet manager declare a private
    // property by that name.
    /** @private */
    this._bermudaDisposed = false
  }

  /**
   * Returns the Bermuda account, derived with the indicated EVM wallet's private key as seed.
   *
   * The indices allow for a vast array of Bermuda sub accounts all controlled by given EVM seed wallet. Repeated calls
   * with the same indices return the same account, until it is disposed.
   *
   * @param {number} [bip44AccountIndex] - The index of the Ethereum account to use as master of the returned Bermuda account (default: 0).
   * @param {number} [bermudaAccountIndex] - The index of the Bermuda account to derive (default: 0).
   * @returns {Promise<WalletAccountBermuda>} The Bermuda account.
   * @throws {ValueError} If an index is not a non-negative integer, or if the provider's chain is not supported.
   * @throws {WdkError} If the wallet has been disposed.
   * @throws {ProviderRequiredError} If the wallet is not connected to a provider.
   */
  async getBermudaAccount (bip44AccountIndex = 0, bermudaAccountIndex = 0) {
    for (const index of [bip44AccountIndex, bermudaAccountIndex]) {
      if (!Number.isInteger(index)) {
        throw new ValueError('Account index must be an integer.')
      }

      if (index < 0) {
        throw new ValueError('Account index must not be negative.')
      }
    }

    if (this._bermudaDisposed) {
      throw new WdkError('The wallet has been disposed.')
    }

    if (!this._provider) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to get Bermuda accounts.')
    }

    const key = `${bip44AccountIndex}/${bermudaAccountIndex}`

    const account = this._bermudaAccounts[key]

    if (account && !account.disposed) {
      return account
    }

    this._pendingBermudaAccounts[key] ??= this._deriveBermudaAccount(key, bip44AccountIndex, bermudaAccountIndex)
      .finally(() => {
        delete this._pendingBermudaAccounts[key]
      })

    return await this._pendingBermudaAccounts[key]
  }

  /**
   * Returns the current fee rates.
   *
   * @returns {Promise<FeeRates>} The fee rates (in weis).
   * @throws {ProviderRequiredError} If the wallet is not connected to a provider.
   */
  async getFeeRates () {
    if (!this._provider) {
      throw new ProviderRequiredError('The wallet must be connected to a provider to get fee rates.')
    }

    return await super.getFeeRates()
  }

  /**
   * True if the wallet has been disposed.
   *
   * @type {boolean}
   */
  get disposed () {
    return this._bermudaDisposed
  }

  /**
   * Disposes all the wallet accounts, the Bermuda accounts included, erasing their private keys from the memory.
   */
  dispose () {
    if (this._bermudaDisposed) return

    super.dispose()

    for (const account of Object.values(this._bermudaAccounts)) {
      account.dispose()
    }

    this._bermudaAccounts = {}

    // Newer versions of the base wallet manager no longer dispose the default
    // signer. The one created from the seed holds the root key, so it is erased
    // here regardless; a signer passed in by the caller remains theirs.
    if (this._ownsDefaultSigner) {
      this._defaultSigner?.dispose()

      this._defaultSigner = undefined
    }

    this._bermudaDisposed = true
  }

  /**
   * Derives a Bermuda account and caches it under the given key.
   *
   * @private
   * @param {string} key - The account's key in the cache.
   * @param {number} bip44AccountIndex - The index of the Ethereum account to use as master of the Bermuda account.
   * @param {number} bermudaAccountIndex - The index of the Bermuda account to derive.
   * @returns {Promise<WalletAccountBermuda>} The Bermuda account.
   */
  async _deriveBermudaAccount (key, bip44AccountIndex, bermudaAccountIndex) {
    const chainId = await this._provider.getNetwork().then(network => network.chainId)
    const chainName = chainIdToName(chainId)
    const bermuda = initBermudaSdk(chainName, this._getBermudaSdkConfig(chainId))

    // For a chain it has no preset for, the SDK builds its configuration from the given options
    // alone, with no pool, and the account would only fail once used.
    if (!bermuda.config.pool) {
      throw new ValueError(`The Bermuda SDK has no deployment on chain ${chainName} (chain id ${chainId}).`)
    }

    const ethereumWallet = await this.getAccountByPath(`0'/0/${bip44AccountIndex}`)
    const bermudaKeyPair = await bermuda.account({ seed: hexlify(ethereumWallet.keyPair.privateKey), id: bermudaAccountIndex })
    const account = new WalletAccountBermuda(bermuda, ethereumWallet, bermudaKeyPair)

    // The wallet may have been disposed while the account was being derived: the
    // account must then neither be handed out nor outlive the wallet's secrets.
    if (this._bermudaDisposed) {
      account.dispose()

      throw new WdkError('The wallet has been disposed.')
    }

    this._bermudaAccounts[key] = account

    return account
  }

  /**
   * Returns the options the Bermuda SDK is created with, over its preset for the chain.
   *
   * The SDK reads the chain through the wallet's provider. Urls are handed over as urls, so that the SDK builds its own
   * pool of RPC nodes on them: the pool splits the log queries a node refuses as too wide, which the SDK's first sync
   * of a pool's history needs, and spaces out requests. An EIP-1193 provider is handed over as the wallet wraps it,
   * and the SDK uses it as it is. The `bermuda` options are applied last.
   *
   * The chain id is handed over too: the SDK's preset for the chain carries the same, and without a preset the SDK
   * would fail to build a configuration at all rather than one without a deployment.
   *
   * @private
   * @param {bigint} chainId - The id of the chain the wallet's provider is connected to.
   * @returns {BermudaSdkConfig} The options.
   */
  _getBermudaSdkConfig (chainId) {
    const { provider, utxoCache, commitmentEventsCache, fs, bermuda = {} } = this._config

    const config = { chainId }

    if (bermuda.provider === undefined && bermuda.rpcUrls === undefined) {
      if (typeof provider === 'string') {
        config.provider = provider
      } else if (Array.isArray(provider) && provider.every(entry => typeof entry === 'string')) {
        config.rpcUrls = provider
      } else {
        config.provider = this._provider
      }
    }

    if (utxoCache) {
      config.utxoCache = utxoCache
      config.commitmentEventsCache = commitmentEventsCache || utxoCache.replace(/\.json$/, '-commitment-events.json')
      config.fs = fs
    }

    return { ...config, ...bermuda }
  }
}
