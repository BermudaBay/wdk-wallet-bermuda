export default class WalletAccountBermuda {
    /**
     * Creates a new Bermuda EVM wallet account.
     *
     *
     * @param {BermudaSdk} bermudaSdk - The Bermuda SDK.
     * @param {WalletAccountEvm} ethereumWallet - The master Ethereum wallet account.
     * @param {BermudaKeyPair} bermudaKeyPair - The Bermuda key pair.
     */
    constructor(bermudaSdk: BermudaSdk, ethereumWallet: WalletAccountEvm, bermudaKeyPair: BermudaKeyPair);
    /**
     * The Bermuda SDK instance.
     *
     * Only available on Plasma testnet for now.
     *
     * @protected
     * @type {BermudaSdk}
     */
    protected _bermuda: BermudaSdk;
    /**
     * The master Ethereum account.
     *
     * @protected
     * @type {WalletAccountEvm}
     */
    protected _ethereumWallet: WalletAccountEvm;
    /**
     * The Bermuda key pair.
     *
     * @protected
     * @type {BermudaKeyPair}
     */
    protected _bermudaKeyPair: BermudaKeyPair;
    /** @private */
    private _disposed;
    /**
     * Get the Bermuda address.
     *
     * @returns {string} The Bermuda address.
     */
    getAddress(): string;
    /**
     * The account's address.
     *
     * @type {string}
     */
    get address(): string;
    /**
     * Returns the account balance for a specific token.
     *
     * Value held in the token's vaulted class counts at what it is worth in the token.
     *
     * @param {string} tokenAddress - The smart contract address of the token.
     * @returns {Promise<bigint>} The token balance (in base unit).
     */
    getTokenBalance(tokenAddress: string): Promise<bigint>;
    /**
     * Returns the account balances for multiple tokens.
     *
     * Value held in a token's vaulted class counts at what it is worth in the token.
     *
     * @param {string[]} tokenAddresses - The smart contract addresses of the tokens.
     * @returns {Promise<Record<string, bigint>>} A mapping of token addresses to their balances (in base units).
     */
    getTokenBalances(tokenAddresses: string[]): Promise<Record<string, bigint>>;
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
    protected _getEthersSigner(): any;
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
    deposit(params: BermudaDepositParams, options?: BermudaDepositOptions): Promise<string>;
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
    transfer(params: BermudaTransferParams, options?: BermudaTransferOptions): Promise<string>;
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
    withdraw(params: BermudaWithdrawParams, options?: BermudaWithdrawOptions): Promise<string>;
    /**
     * True if the account has been disposed.
     *
     * @type {boolean}
     */
    get disposed(): boolean;
    /**
     * Disposes the wallet account, erasing the Bermuda private keys from the memory.
     *
     * The master Ethereum account is left untouched: it belongs to the wallet manager (or to whoever passed it to the
     * constructor), and other Bermuda accounts derived from it may still be using it.
     */
    dispose(): void;
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
    private _requireFunds;
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
    private _approvePool;
}
export type HDNodeWallet = import("ethers").HDNodeWallet;
export type AuthorizationRequest = import("ethers").AuthorizationRequest;
export type Authorization = import("ethers").Authorization;
export type AuthorizationLike = import("ethers").AuthorizationLike;
export type IWalletAccount = import("@tetherto/wdk-wallet").IWalletAccount;
export type KeyPair = import("@tetherto/wdk-wallet").KeyPair;
export type TransactionResult = import("@tetherto/wdk-wallet").TransactionResult;
export type TransferResult = import("@tetherto/wdk-wallet").TransferResult;
export type WalletAccountEvm = import("@tetherto/wdk-wallet-evm").WalletAccountEvm;
export type TypedData = import("@tetherto/wdk-wallet-evm").TypedData;
export type EvmTransaction = import("@tetherto/wdk-wallet-evm").EvmTransaction;
export type EvmTransferOptions = import("@tetherto/wdk-wallet-evm").EvmTransferOptions;
export type EvmWalletConfig = import("@tetherto/wdk-wallet-evm").EvmWalletConfig;
export type BermudaSdk = import("@bermuda/sdk").ISdk;
export type BermudaKeyPair = import("@bermuda/sdk").KeyPair;
export type BermudaDepositOptions = import("@bermuda/sdk").IDepositOptions;
export type BermudaTransferOptions = import("@bermuda/sdk").ITransferOptions;
export type BermudaWithdrawOptions = import("@bermuda/sdk").IWithdrawOptions;
export type Payload = import("@bermuda/sdk").IPayload;
export type BermudaDepositParams = {
    /**
     * - The address of the token to deposit, or `NATIVE_DEPOSIT_TOKEN` (the zero address) to deposit the chain's native currency.
     */
    token: string;
    /**
     * - The Bermuda address of the recipient, defaults to self.
     */
    to?: string;
    /**
     * - The amount of tokens to deposit, unless `recipients` are given.
     */
    amount?: number | bigint;
    /**
     * - Optional payment memo.
     */
    memo?: string;
    /**
     * - Optional multiple recipients.
     */
    recipients?: Array<{
        to: string;
        amount: number | bigint;
        memo?: string;
    }>;
};
export type BermudaTransferParams = {
    /**
     * - The address of the token to transfer.
     */
    token: string;
    /**
     * - The Bermuda address of the recipient, unless `recipients` are given.
     */
    to?: string;
    /**
     * - The amount of tokens to transfer, unless `recipients` are given.
     */
    amount?: number | bigint;
    /**
     * - Optional payment memo.
     */
    memo?: string;
    /**
     * - Optionally multiple recipients.
     */
    recipients?: Array<{
        to: string;
        amount: number | bigint;
        memo?: string;
    }>;
};
export type BermudaWithdrawParams = {
    /**
     * - The address of the token to withdraw.
     */
    token: string;
    /**
     * - The Ethereum address of the recipient.
     */
    to?: string;
    /**
     * - The amount of tokens to withdraw.
     */
    amount: number | bigint;
};
