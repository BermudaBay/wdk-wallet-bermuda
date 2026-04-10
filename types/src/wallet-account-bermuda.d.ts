
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
     * Creates a new evm wallet account.
     *
     * @param {BermudaSdk} bermudaSdk - The Bermuda SDK.
     * @param {WalletAccountEvm} ethereumWallet - The master Ethereum wallet account.
     * @param {BermudaKeyPair} bermudaKeyPair - The Bermuda key pair.
     */
    constructor(bermudaSdk, ethereumWallet, bermudaKeyPair);
    /**
     * Gets the Bermuda address.
     * 
     * @returns {string} The Bermuda address.
     */
    getAddress(): string;
    /**
     * Gets the Bermuda address.
     * 
     * @returns {string} The Bermuda address.
     */
    get address(): string;
    /**
     * Returns the account balance for a specific token.
     *
     * @param {string} tokenAddress - The smart contract address of the token.
     * @returns {Promise<bigint>} The token balance (in base unit).
     */
    getTokenBalance (tokenAddress: string): Promise<bigint>;
    /**
     * Returns the account balances for multiple tokens.
     *
     * @param {string[]} tokenAddresses - The smart contract addresses of the tokens.
     * @returns {Promise<Record<string, bigint>>} A mapping of token addresses to their balances (in base units).
     */
    getTokenBalances(tokenAddresses: string[]): Promise<{ [key:string]: bigint }>;
    /**
     * Shield funds.
     *
     * @param {BermudaDepositParams} params
     * @param {BermudaDepositOptions} options
     * @returns Transaction hash
     */
    deposit (params: BermudaDepositParams, options: BermudaDepositOptions): Promise<string>;
    /**
     * Transfer shielded funds.
     *
     * @param {BermudaTransferParams} params
     * @param {BermudaTransferOptions} options
     * @returns Transaction hash
     */
    transfer (params: BermudaTransferParams, options: BermudaTransferOptions): Promise<string>;
    /**
     * Unshield funds.
     *
     * @param {BermudaWithdrawParams} params
     * @param {BermudaWithdrawOptions} options
     * @returns Transaction hash
     */
    withdraw (params: BermudaWithdrawParams, options: BermudaWithdrawOptions): Promise<string>;
    /**
     * Disposes the wallet account, erasing the private key from the memory.
     */
    dispose(): void;
}
export type HDNodeWallet = import("ethers").HDNodeWallet;
export type AuthorizationRequest = import("ethers").AuthorizationRequest;
export type Authorization = import("ethers").Authorization;
export type AuthorizationLike = import("ethers").AuthorizationLike;
export type IWalletAccount = import("@tetherto/wdk-wallet").IWalletAccount;
export type KeyPair = import("@tetherto/wdk-wallet").KeyPair;
export type TransactionResult = import("@tetherto/wdk-wallet").TransactionResult;
export type TransferResult = import("@tetherto/wdk-wallet").TransferResult;
export type TypedData = import("./wallet-account-read-only-evm.js").TypedData;
export type EvmTransaction = import("./wallet-account-read-only-evm.js").EvmTransaction;
export type EvmTransferOptions = import("./wallet-account-read-only-evm.js").EvmTransferOptions;
export type EvmWalletConfig = import("./wallet-account-read-only-evm.js").EvmWalletConfig;
export type ApproveOptions = {
    /**
     * - The address of the token to approve.
     */
    token: string;
    /**
     * - The spender's address.
     */
    spender: string;
    /**
     * - The amount of tokens to approve to the spender.
     */
    amount: number | bigint;
};
import WalletAccountReadOnlyEvm from './wallet-account-read-only-evm.js';
