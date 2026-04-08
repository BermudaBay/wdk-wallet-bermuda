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

/** @typedef {import('ethers').TypedDataDomain} TypedDataDomain */
/** @typedef {import('ethers').TypedDataField} TypedDataField */
/** @typedef {import('ethers').AuthorizationRequest} AuthorizationRequest */
/** @typedef {import('ethers').Authorization} Authorization */
/** @typedef {import('ethers').AuthorizationLike} AuthorizationLike */
/** @typedef {import('ethers').TransactionReceipt} EvmTransactionReceipt */

/** @typedef {import('@tetherto/wdk-wallet').FeeRates} FeeRates */
/** @typedef {import('@tetherto/wdk-wallet').KeyPair} KeyPair */
/** @typedef {import('@tetherto/wdk-wallet').TransactionResult} TransactionResult */
/** @typedef {import('@tetherto/wdk-wallet').TransferResult} TransferResult */

/** @typedef {import('./src/wallet-account-read-only-evm.js').TypedData} TypedData */
/** @typedef {import('./src/wallet-account-read-only-evm.js').DelegationInfo} DelegationInfo */
/** @typedef {import('./src/wallet-account-read-only-evm.js').EvmTransaction} EvmTransaction */
/** @typedef {import('./src/wallet-account-read-only-evm.js').EvmTransferOptions} EvmTransferOptions */
/** @typedef {import('./src/wallet-account-read-only-evm.js').EvmWalletConfig} EvmWalletConfig */

/** @typedef {import('@bermuda/sdk').ISdk} BermudaSdk */
/** @typedef {import('@bermuda/sdk').KeyPair} BermudaKeyPair */
/** @typedef {import('@bermuda/sdk').IDepositOptions} BermudaDepositOptions */
/** @typedef {import('@bermuda/sdk').ITransferOptions} BermudaTransferOptions */
/** @typedef {import('@bermuda/sdk').IWithdrawOptions} BermudaWithdrawOptions */
/** @typedef {import('@bermuda/sdk').IPayload} Payload */

/** @typedef {import('./src/wallet-account-bermuda.js').BermudaDepositParams} BermudaDepositParams */
/** @typedef {import('./src/wallet-account-bermuda.js').BermudaTransferParams} BermudaTransferParams */
/** @typedef {import('./src/wallet-account-bermuda.js').BermudaWithdrawParams} BermudaWithdrawParams */

export { default } from './src/wallet-manager-bermuda.js'

export { default as WalletAccountBermuda } from './src/wallet-account-bermuda.js'
