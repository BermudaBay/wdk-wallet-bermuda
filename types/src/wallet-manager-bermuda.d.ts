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
    protected static _FEE_RATE_NORMAL_MULTIPLIER: bigint;
    /**
     * Multiplier for fast fee rate calculations (in %).
     *
     * @protected
     * @type {bigint}
     */
    protected static _FEE_RATE_FAST_MULTIPLIER: bigint;
    /**
     * Creates a new Bermuda wallet manager for EVM blockchains.
     *
     * @param {string | Uint8Array} seed The wallet's [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki) seed phrase
     * @param {BermudaWalletConfig} [config] - The configuration object.
     */
    constructor(seed: string | Uint8Array, config?: BermudaWalletConfig);
    /**
     * An ethers provider to interact with a node of the blockchain.
     *
     * @protected
     * @type {Provider | undefined}
     */
    protected _provider: Provider | undefined;
    /**
     * Returns the Bermuda account, derived with the indicated EVM wallet's private key as seed.
     *
     * The indices allow for a vast array of Bermuda sub accounts all controlled by given EVM seed wallet.
     *
     * @param {number} [bip44AccountIndex] - The index of the Ethereum account to use as master of the returned Bermuda account (default: 0).
     * @param {number} [bermudaAccountIndex] - The index of the Bermuda account to derive (default: 0).
     * @returns {Promise<WalletAccountBermuda>} The Bermuda account.
     */
    getBermudaAccount(bip44AccountIndex?: number, bermudaAccountIndex?: number): Promise<WalletAccountBermuda>;
    /**
     * Returns the wallet account at a specific index (see [BIP-44](https://github.com/bitcoin/bips/blob/master/bip-0044.mediawiki)).
     *
     * @example
     * // Returns the account with derivation path m/44'/60'/0'/0/1
     * const account = await wallet.getAccount(1);
     * @param {number} [index] - The index of the account to get (default: 0).
     * @returns {Promise<WalletAccountEvm>} The account.
     */
    getAccount(index?: number): Promise<WalletAccountEvm>;
    /**
     * Returns the wallet account at a specific BIP-44 derivation path.
     *
     * @example
     * // Returns the account with derivation path m/44'/60'/0'/0/1
     * const account = await wallet.getAccountByPath("0'/0/1");
     * @param {string} path - The derivation path (e.g. "0'/0/0").
     * @returns {Promise<WalletAccountEvm>} The account.
     */
    getAccountByPath(path: string): Promise<WalletAccountEvm>;
}
export type Provider = import("ethers").Provider;
export type FeeRates = import("@tetherto/wdk-wallet").FeeRates;
export type BermudaSdk = import("@bermuda/sdk").ISdk;
export type BermudaWalletConfig = {
    /**
     * - The url of the rpc provider, or an instance of a class that implements eip-1193.
     */
    provider?: string | Eip1193Provider;
    /**
     * - The maximum fee amount for transfer operations.
     */
    transferMaxFee?: number | bigint;
    /**
     * - Filepath for persisting UTXO cache across sessions.
     */
    utxoCache?: string;
    /**
     * - node:fs or equivalent.
     */
    fs?: any;
};
import WalletManager from '@tetherto/wdk-wallet';
import WalletAccountBermuda from './wallet-account-bermuda.js';
import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm';
