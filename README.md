# @bermuda/wdk-wallet-bermuda


**Note**: This package is currently in beta. Only supported network is Plasma testnet,

A simple and secure package to manage Bermuda accounts for EVM-compatible blockchains.

This package provides a clean API for both of
- creating Bermuda accounts from BIP-44 wallets, and performing deposits to, transfers within, and withdrawals from a Bermuda shielded pool

- creating, managing, and utlizing BIP-44 accounts à la [`@tetherto/wdk-wallet-evm`](https://github.com/tetherto/wdk-wallet-evm)

Since `WalletManagerBermuda` exposes the same `constructor`, `getAccount` and `getAccountByPath` interfaces as [`@tetherto/wdk-wallet-evm`](https://github.com/tetherto/wdk-wallet-evm) our **`wdk-wallet-bermuda` is a direct drop-in for [`@tetherto/wdk-wallet-evm`](https://github.com/tetherto/wdk-wallet-evm)**.

## 🔍 About WDK

This module is part of the [**WDK (Wallet Development Kit)**](https://wallet.tether.io/) project, which empowers developers to build secure, non-custodial wallets with unified blockchain access, stateless architecture, and complete user control. 

For detailed documentation about the complete WDK ecosystem, visit [docs.wallet.tether.io](https://docs.wallet.tether.io).

## 🌟 Features

- **BIP-39 Seed Phrase Support**: Generate and validate BIP-39 mnemonic seed phrases
- **EVM Derivation Paths**: Support for BIP-44 standard derivation paths for Ethereum (m/44'/60')
- **Multi-Account Management**: Create and manage multiple accounts from a single seed phrase
- **Transaction Management**: Send transactions and get fee estimates with EIP-1559 support
- **ERC20 Support**: Query native token and ERC20 token balances using smart contract interactions
- **EIP-7702 Delegation**: Delegate EOAs to smart contracts, sign authorizations, and send type 4 transactions

## ⬇️ Installation

To install the `@bermuda/wdk-wallet-bermuda` package, follow these instructions:

You can install it using npm:

```bash
npm i bermudabay/wdk-wallet-bermuda
```

## 🚀 Quick Start

### Importing from `@bermuda/wdk-wallet-bermuda`

### Creating a New Wallet

```javascript
import WalletManagerBermuda, { WalletAccountBermuda } from '@bermuda/wdk-wallet-bermuda'

// Use a BIP-39 seed phrase (replace with your own secure phrase)
const seedPhrase = 'test only example nut use this real life secret phrase must random'

// Create wallet manager with provider config
const wallet = new WalletManagerBermuda(seedPhrase, {
  // Option 1: Using RPC URL
  provider: 'https://eth-mainnet.g.alchemy.com/v2/your-api-key', // or any EVM RPC endpoint
  transferMaxFee: 100000000000000 // Optional: Maximum fee in wei
})

// OR

// Option 2: Using EIP-1193 provider (e.g., from browser wallet)
const wallet2 = new WalletManagerBermuda(seedPhrase, {
  provider: window.ethereum, // EIP-1193 provider
  transferMaxFee: 100000000000000 // Optional: Maximum fee in wei
})

// Get a full access Ethereum account
const ethereumWallet = await wallet.getAccount()

// Get the associated Bermuda account
const bermudaAccount = await wallet.getBermudaAccount()
```

### Managing Multiple Accounts

```javascript
import WalletManagerEvm from '@bermuda/wdk-wallet-bermuda'

// Assume wallet is already created
// The first parameter is the BIP-44 account index while the second is the Bermuda account index.
const account = await wallet.getBermudaAccount(0, 0)
const address = await account.address()
console.log('Account 0 address:', address)

const account1 = await wallet.getBermudaAccount(0, 1)
const address1 = await account1.getAddress()
console.log('Account 1 address:', address1)

```

### Checking Balances

For accounts where you have the seed phrase and full access:

```javascript
// Get shielded ERC20 token balance
const token = '0x...'; // ERC20 contract address
const balance = await account.getTokenBalance(token);
console.log('Token balance:', balance);
```

### Deposit into Bermuda

```javascript
const txHash = await account.deposit({ token: '0x...', amount: 1n })

console.log('Transaction hash:', txHash)
```

### Transfer within Bermuda

```javascript
const txHash = await account.transfer({ token: '0x...', amount: 1n, to: '0x...' })

console.log('Transaction hash:', txHash)
```

### Withdraw from Bermuda

```javascript
const txHash = await account.withdraw({ token: '0x...', amount: 1n, to: '0x...' })

console.log('Transaction hash:', txHash)
```

## 🌐 Supported Networks

- **Plasma testnet**

## 🔒 Security Considerations

- **Seed Phrase Security**: Always store your seed phrase securely and never share it
- **Private Key Management**: The package handles private keys internally with memory safety features
- **Provider Security**: Use trusted RPC endpoints and consider running your own node for production
- **Transaction Validation**: Always validate transaction details before signing
- **Memory Cleanup**: Use the `dispose()` method to clear private keys from memory when done
- **Fee Limits**: Set `transferMaxFee` in config to prevent excessive transaction fees
- **Gas Estimation**: Always estimate gas before sending transactions
- **EIP-1559**: Consider using EIP-1559 fee model for better gas price estimation
- **Contract Interactions**: Verify contract addresses and token decimals before transfers

## 🛠️ Development

### Building

```bash
# Install dependencies
npm install

# Build TypeScript definitions
npm run build:types

# Lint code
npm run lint

# Fix linting issues
npm run lint:fix
```

### Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm run test:coverage
```

## 📜 License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 🆘 Support

For support, please open an issue on the GitHub repository.

---
