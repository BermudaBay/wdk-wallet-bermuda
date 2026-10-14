# @bermuda/wdk-wallet-evm-bermuda

<a href="https://docs.wdk.tether.io">
  <picture>
    <source
      media="(prefers-color-scheme: dark)"
      srcset="https://raw.githubusercontent.com/tetherto/wdk-docs/refs/heads/main/public/assets/branding/wdk-badge-color-dark.svg"
    >
    <source
      media="(prefers-color-scheme: light)"
      srcset="https://raw.githubusercontent.com/tetherto/wdk-docs/refs/heads/main/public/assets/branding/wdk-badge-color-light.svg"
    >
    <img
      alt="Built with WDK"
      src="https://raw.githubusercontent.com/tetherto/wdk-docs/refs/heads/main/public/assets/branding/wdk-badge-color-light.svg"
    >
  </picture>
</a>

**Note**: This package is currently in beta. The only supported network is Plasma testnet.

A simple and secure package to manage Bermuda accounts for EVM-compatible blockchains.

This package extends [`@tetherto/wdk-wallet-evm`](https://github.com/tetherto/wdk-wallet-evm) with Bermuda shielded accounts. `WalletManagerBermuda` is a `WalletManagerEvm`, so it creates and manages BIP-44 accounts exactly like `@tetherto/wdk-wallet-evm` does, and adds `getBermudaAccount()` on top: Bermuda accounts derived from those BIP-44 accounts, which deposit to, transfer within, and withdraw from a Bermuda shielded pool.

## 🔍 About WDK

This module is part of the [**WDK (Wallet Development Kit)**](https://wallet.tether.io/) project, which empowers developers to build secure, non-custodial wallets with unified blockchain access, stateless architecture, and complete user control.

For detailed documentation about the complete WDK ecosystem, visit [docs.wallet.tether.io](https://docs.wallet.tether.io).

## 🌟 Features

- **Built on `@tetherto/wdk-wallet-evm`**: `WalletManagerBermuda` extends `WalletManagerEvm`, so `getAccount()`, `getAccountByPath()`, `getFeeRates()` and the provider options work exactly as they do there
- **BIP-39 and BIP-44 account derivation**: Derive standard EVM accounts from a mnemonic seed
- **Deterministic Bermuda accounts**: Derive shielded accounts from an EVM account with `getBermudaAccount()`
- **Shielded deposits**: Deposit funds into the Bermuda shielded pool
- **Shielded transfers**: Transfer shielded balances between Bermuda accounts
- **Shielded withdrawals**: Withdraw shielded balances to a public EVM address
- **Shielded balance lookup**: Scan owned UTXOs and query balances for one or multiple tokens

## ⬇️ Installation

To install the `@bermuda/wdk-wallet-evm-bermuda` package, follow these instructions:

You can install it using npm:

```bash
npm i bermudabay/wdk-wallet-evm-bermuda
```

The package is not on the npm registry yet, so it is installed from its GitHub repository (`bermudabay/wdk-wallet-evm-bermuda`) and imported as `@bermuda/wdk-wallet-evm-bermuda`.

npm 12 and later refuse git dependencies, such as this package, and URL dependencies, such as the Bermuda SDK it depends on, unless you allow them:

```bash
npm i bermudabay/wdk-wallet-evm-bermuda --allow-git=root --allow-remote=all
```

`allow-git=root` admits the git dependencies of your own project, which this package is one of. The SDK is a dependency of this package rather than of your project, so it needs `allow-remote=all`. Both settings can also go into your project's `.npmrc`.

## 🚀 Quick Start

### Importing from `@bermuda/wdk-wallet-evm-bermuda`

### Creating a New Wallet

```javascript
import WalletManagerBermuda, { WalletAccountBermuda } from '@bermuda/wdk-wallet-evm-bermuda'

// Use a BIP-39 seed phrase (replace with your own secure phrase)
const seedPhrase = 'test only example nut use this real life secret phrase must random'

// Create wallet manager with provider config
const wallet = new WalletManagerBermuda(seedPhrase, {
  // Option 1: Using RPC URL
  provider: 'https://testnet-rpc.plasma.to', // Plasma testnet's public RPC endpoint, or any other one for Plasma testnet
  transactionMaxFee: 100000000000000, // Optional: maximum network fee (in wei) of EVM transactions, Bermuda deposits included
  transferMaxFee: 100000000000000 // Optional: maximum network fee (in wei) of EVM token transfers
})

// OR

// Option 2: Using EIP-1193 provider (e.g., from browser wallet)
const wallet2 = new WalletManagerBermuda(seedPhrase, {
  provider: window.ethereum, // EIP-1193 provider, connected to Plasma testnet (chain id 9746)
  transactionMaxFee: 100000000000000 // Optional: maximum network fee (in wei) of EVM transactions, Bermuda deposits included
})

// Get a full access Ethereum account
const ethereumWallet = await wallet.getAccount()

// Get the associated Bermuda account
const bermudaAccount = await wallet.getBermudaAccount()
```

### Configuring the Bermuda SDK

Bermuda accounts read the chain through the wallet's provider. A provider given as a URL (or a list of URLs) is handed to the Bermuda SDK as one, and the SDK builds its own pool of RPC nodes on it: the pool splits the log queries a node refuses as too wide, which the SDK's first scan of the pool's history needs, and spaces out its requests. An EIP-1193 provider is used as it is, so it has to serve wide log queries; if it cannot, give the SDK URLs of its own with the `bermuda` option.

The `bermuda` option passes any other setting of the Bermuda SDK through, applied over its configuration for the chain:

```javascript
const wallet = new WalletManagerBermuda(seedPhrase, {
  provider: window.ethereum,
  bermuda: {
    rpcUrls: ['https://testnet-rpc.plasma.to'], // Optional: the nodes the SDK reads the chain through, instead of the wallet's provider
    depositClass: 'idle' // Optional: deposit into the token's idle class only (see "Checking Balances")
  },
  utxoCache: './bermuda-utxos.json', // Optional: persist the shielded state across sessions, with...
  fs // ...node:fs or an equivalent
})
```

### Managing Multiple Accounts

```javascript
import WalletManagerBermuda from '@bermuda/wdk-wallet-evm-bermuda'

// Assume wallet is already created
// The first parameter is the BIP-44 account index while the second is the Bermuda account index.
const account = await wallet.getBermudaAccount(0, 0)
const address = account.getAddress()
console.log('Account 0 address:', address)

const account1 = await wallet.getBermudaAccount(0, 1)
const address1 = account1.getAddress()
console.log('Account 1 address:', address1)

```

A Bermuda address is `0x` followed by 2,496 hex characters: the account's owner commitment and its X-Wing viewing key, which shielded payments to it are encrypted to.

### Checking Balances

For accounts where you have the seed phrase and full access:

```javascript
// USDT0 on Plasma testnet (6 decimals)
const USDT0 = '0x502012b361AebCE43b26Ec812B74D9a51dB4D412'

// Get the shielded USDT0 balance (in base units)
const balance = await account.getTokenBalance(USDT0)
console.log('Shielded USDT0 balance:', balance)
```

A token can be held in two classes: idle, in units of the token, and vaulted, as shares of a yield-bearing vault the pool runs for the token. Deposits go to the vaulted class while it takes them, unless the `depositClass` option says otherwise, and balances count vaulted shares at what they are worth in the token.

The SDK reuses what it reads from the chain for up to a block time, so a balance read right after a transaction is mined can still predate it.

### Deposit into Bermuda

The pool pulls each deposit from the master Ethereum account: the amount, and the deposit fees on top of it (the pool's protocol fee and the compliance engine's one-off lifetime fee, if they are charged). USDT0 does not support EIP-2612 permits, so the pool needs an allowance that covers both before a deposit: approve it with the master Ethereum account, and wait for the approval to be mined. The wrapped native token (WXPL) is approved automatically, for exactly what the deposit pulls.

```javascript
const BERMUDA_POOL = '0x5D4948111Ba7f37A8f67141E6B7d0EC27B7d4310' // Bermuda pool on Plasma testnet

const ethereumAccount = await wallet.getAccount(0)

// Approve the amount and the deposit fees
const { hash } = await ethereumAccount.approve({ token: USDT0, spender: BERMUDA_POOL, amount: 1_100_000n })
await ethereumAccount.waitForTransaction(hash)

// Shield 1 USDT0 into the Bermuda account
const txHash = await account.deposit({ token: USDT0, amount: 1_000_000n })

console.log('Transaction hash:', txHash)
```

To shield the chain's native currency (XPL on Plasma), deposit `NATIVE_DEPOSIT_TOKEN`. The deposit carries the amount and the fees as its value, and the pool wraps it: the Bermuda account receives WXPL.

```javascript
import { NATIVE_DEPOSIT_TOKEN } from '@bermuda/wdk-wallet-evm-bermuda'

// Shield 1 XPL
const txHash = await account.deposit({ token: NATIVE_DEPOSIT_TOKEN, amount: 1_000_000_000_000_000_000n })
```

Before it sends anything, approvals included, `deposit()` checks that the master Ethereum account holds what the deposit pays: the amount and the fees, in the deposited token, or in the native currency for `NATIVE_DEPOSIT_TOKEN` (the network fee comes on top). If it holds less, `deposit()` throws a `TransactionError` with the reason `INSUFFICIENT_BALANCE`. Depositing WXPL needs WXPL: an account that holds XPL deposits `NATIVE_DEPOSIT_TOKEN`.

```javascript
import { TransactionError, TransactionErrorReason } from '@tetherto/wdk-wallet'

const WXPL = '0x6100e367285b01f48d07953803a2d8dca5d19873' // WXPL on Plasma testnet

try {
  await account.deposit({ token: WXPL, amount: 100n })
} catch (error) {
  if (error instanceof TransactionError && error.reason === TransactionErrorReason.INSUFFICIENT_BALANCE) {
    // "The deposit pays the pool 100 of token 0x6100…9873 (…), but the Ethereum account 0x… holds 14. …"
    console.log(error.message)
  }
}
```

### Transfer within Bermuda

```javascript
// Send 1 shielded USDT0 to another Bermuda account, here the second one derived above, with a memo only the recipient can read
const txHash = await account.transfer({ token: USDT0, amount: 1_000_000n, to: account1.getAddress(), memo: 'Invoice 42' })

console.log('Transaction hash:', txHash)
```

### Withdraw from Bermuda

```javascript
// Unshield 1 USDT0 to a public address (defaults to the master Ethereum account's address)
const txHash = await account.withdraw({ token: USDT0, amount: 1_000_000n, to: '0x...' })

console.log('Transaction hash:', txHash)
```

## 💸 Fees

`transactionMaxFee` and `transferMaxFee` (both in wei) are enforced by the underlying `@tetherto/wdk-wallet-evm` accounts, so they only cap the network fees the wallet pays itself:

| Operation | Fees | Capped by |
|-----------|------|-----------|
| EVM `sendTransaction()` | Network fee | `transactionMaxFee` |
| EVM `transfer()` | Network fee | `transferMaxFee` |
| Bermuda `deposit()` | Network fee of the deposit, and of the approval sent first for the wrapped native token | `transactionMaxFee` |
| | Deposit fees, if charged: the pool's protocol fee and the compliance engine's one-off lifetime fee, in the deposited token, on top of the amount | Not capped |
| Bermuda `transfer()` | The pool's transfer fee, if it charges one, and a relay fee, only if `options.relayFee` is set, in the transferred token | Not capped |
| Bermuda `withdraw()` | Protocol withdrawal fee and, if `options.relayFee` is set, relay fee, in the withdrawn token | Not capped |

Deposit fees come on top of the amount, which the recipients receive in full. Set `exactOutputAmounts: false` in a deposit's options to have the amount include them instead.

Shielded transfers and withdrawals are submitted by a relayer, so **neither cap applies to them**: their fees are paid out of the shielded balance, in the token being moved. No relay fee is charged unless you set `relayFee` (together with `relayer`) in their options, so the relay fee is always the one you chose.

## 🌐 Supported Networks

| Network | Chain ID | Public RPC | USDT0 | Bermuda pool |
|---------|----------|------------|-------|--------------|
| Plasma testnet | 9746 | `https://testnet-rpc.plasma.to` | `0x502012b361AebCE43b26Ec812B74D9a51dB4D412` | `0x5D4948111Ba7f37A8f67141E6B7d0EC27B7d4310` |

The package targets the deployment of version 0.3.2 of the Bermuda SDK.

## 🖥️ Supported Runtimes

The package runs on Node.js and on [Bare](https://github.com/holepunchto/bare). Under Bare it is loaded through its `bare` entry point, `bare.js`, which sets up Bare's Node.js compatibility layer (`bare-node-runtime`) and fills the gaps that the Bermuda SDK and its zero-knowledge prover, `@aztec/bb.js`, run into on top of it:

- `@aztec/bb.js` imports `finished` from `stream/promises` and `threadId` from `worker_threads`, which `bare-node-runtime` does not provide. The modules in [`bare/`](bare/) add them.
- Two globals are patched, for the whole process. `TextDecoder` also accepts the labels of the `windows-1252` encoding, such as `ascii`, which `@aztec/bb.js` decodes the prover's output with. `WebAssembly.compile()` and `WebAssembly.instantiate()` keep Bare's event loop alive until they settle: Bare would otherwise exit while the prover is still being compiled.
- The global HTTP agents of `bare-http1` and `bare-https` are replaced, for the whole process, with ones without their 5-second socket timeout. It cuts off requests in flight, where Node.js only times out idle sockets, so the wallet's requests failed whenever an RPC node took longer than that to answer.

Tested with Bare 1.34.0 on macOS (arm64):

- `npm run test:bare` loads the package under Node.js and Bare, from the checkout and from the packed tarball, derives EVM and Bermuda accounts against pinned vectors, and starts the prover.
- The integration suite deposits, transfers and withdraws from a Bare process, with real proofs, against a fork of Plasma testnet (`tests/integration/bare.test.js`).

CI runs both on Linux (x64).

Under Bare, keep in mind:

- Proofs come from the WebAssembly backend of `@aztec/bb.js`, on a single thread, where Node.js uses the native one. On an Apple silicon Mac, a first deposit of WXPL, approval included, took 22 seconds and a transfer or withdrawal 11, against 2 to 4 seconds on Node.js once its prover runs.
- On first use, the prover downloads its CRS (about 38 MB, 105 MB once unpacked) into `~/.bb-crs`, or into the directory set in `CRS_PATH`.
- Import `@bermuda/wdk-wallet-evm-bermuda` before anything else that loads `@bermuda/sdk` or `@aztec/bb.js`. Bare caches each module with the import map it was first loaded with, so modules loaded earlier would miss the fixes above.
- WDK worklet bundles are not supported yet. A bundle builds, but fails to load: the Bermuda SDK loads its prover's dependencies up front, and those read their WebAssembly modules from disk as they load, which a bundle does not allow.

## ⬆️ Upgrading from 0.1.x

Version 0.3.2 works with version 0.3.2 of the Bermuda SDK, which targets a new deployment of the Bermuda pool:

- **Shielded balances do not carry over.** Funds shielded with 0.1.x stay in the previous pool (`0xfa3193AD6DEEcaF7D5586d40808E80ad2Ca5A007` on Plasma testnet): withdraw them with 0.1.x first.
- **Bermuda addresses change.** They are derived from the same spending keys, but now consist of an owner commitment and an X-Wing viewing key (2,496 hex characters, where they had 448).
- **`note` is now `memo`**, on deposits, transfers and their recipients.
- **Depositing WXPL pulls WXPL**, approved automatically, rather than sending XPL. Deposit the native currency with `NATIVE_DEPOSIT_TOKEN`.
- **Deposit fees come on top of the amount.** Approvals of tokens without permits, such as USDT0, have to cover them.
- **The SDK reads the chain through the wallet's provider**, rather than through an endpoint of its own; see [Configuring the Bermuda SDK](#configuring-the-bermuda-sdk).
- **Chain id 59141 (Linea Sepolia) is no longer supported**, and `getBermudaAccount()` rejects the chains the SDK has no deployment on with a `ValueError`.

## 🔒 Security Considerations

- **Seed Phrase Security**: Always store your seed phrase securely and never share it
- **Private Key Management**: The package handles private keys internally with memory safety features
- **Provider Security**: Use trusted RPC endpoints and consider running your own node for production
- **Transaction Validation**: Always validate transaction details before signing
- **Memory Cleanup**: Use the `dispose()` method to clear private keys from memory when done
- **Fee Limits**: Set `transactionMaxFee` and `transferMaxFee` to cap the network fees of EVM transactions (Bermuda deposits included) and EVM token transfers. They do not cap the fees of shielded transfers and withdrawals; see [Fees](#-fees)
- **Gas Estimation**: Always estimate gas before sending transactions
- **EIP-1559**: Consider using EIP-1559 fee model for better gas price estimation
- **Contract Interactions**: Verify contract addresses and token decimals before transfers

## 🛠️ Development

### Prerequisites

Development and testing require **Node.js >= 22** — a floor set by Hardhat, whose
`@nomicfoundation/edr` native bindings declare `engines: { node: ">= 22" }`. The recommended
version is pinned in [`.nvmrc`](.nvmrc) and the floor is enforced via `devEngines` in
`package.json`:

```bash
nvm use
```

> This floor applies to the **test toolchain only** — the published library itself needs
> Node.js >= 20.19, the floor of the `@noble` cryptography packages the Bermuda SDK uses.

### Building

```bash
# Install dependencies (use `ci` to honour the lockfile exactly)
npm ci

# Build TypeScript definitions
npm run build:types

# Lint code
npm run lint

# Fix linting issues
npm run lint:fix
```

### Testing

```bash
# Run every suite
npm test

# Run every suite with coverage
npm run test:coverage

# Run only the integration suites
npm run test:integration

# Run only the integration suites with coverage
npm run test:integration:coverage

# Load the package under Node.js and Bare, from the checkout and packed
npm run test:bare
```

The integration suites include `tests/integration/bare.test.js`, which runs shielded operations under Bare.

## 📜 License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 🛡️ Reporting Security Issues

Please do not report security vulnerabilities through public GitHub issues. Email [security@bermudabay.xyz](mailto:security@bermudabay.xyz) instead; see [SECURITY.md](SECURITY.md) for what to include and how disclosure works.

## 🆘 Support

For support, please open an issue on the GitHub repository. Security issues are the exception: report those privately, as described above.

---
