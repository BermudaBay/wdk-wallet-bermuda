import initBermudaSdk from '@bermuda/sdk'

import {
  JsonRpcProvider,
  hexlify,
  parseEther,
  verifyMessage,
  verifyTypedData
} from 'ethers'

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals'

import WalletManagerBermuda, { WalletAccountBermuda } from '../../index.js'

import { serveRelayer } from './helpers/relayer.js'

import {
  USDT0_ALLOWANCE_SLOT,
  USDT0_BALANCE_SLOT,
  allowanceOf,
  fundWrappedNative,
  setBalance,
  setTokenAllowance,
  setTokenBalance,
  startFork,
  tokenBalanceOf
} from './helpers/fork.js'

// Drives the real Bermuda SDK against a fork of plasma-testnet: the shielded pool,
// its verifier and the tokens are the deployed ones, the proofs are real, and
// every operation settles on-chain. Only the relayer is local — the hosted one
// would broadcast onto the live chain, where the deposits being spent here do not
// exist.
//
// plasma-testnet specifically, because it is the chain whose SDK config carries a
// wrapped-native token (`WXPL`). The deposit path branches on that, and on
// `testenv` the branch is unreachable.
//
// The tests share one fork and run in order, asserting on deltas rather than
// absolute balances. Snapshot/revert would desynchronise the SDK's in-memory UTXO
// state from the chain it was built from.

const SEED_PHRASE = 'cook voyage document eight skate token alien guide drink uncle term abuse'

// Proof generation dominates: each shielded operation takes roughly ten seconds.
const OPERATION_TIMEOUT = 240_000

const WXPL_FUNDING = parseEther('10')
const USDT0_FUNDING = 1_000_000n

describe('WalletAccountBermuda against a plasma-testnet fork', () => {
  let fork,
    relayer,
    provider,
    bermuda,
    wallet,
    ethereumAccount,
    ethereumAddress,
    account,
    subAccount,
    pool,
    wxpl,
    usdt0

  beforeAll(async () => {
    fork = await startFork()
    relayer = await serveRelayer(fork.url)

    await setBalance(fork.hre.provider, relayer.address)

    provider = new JsonRpcProvider(fork.url)

    bermuda = initBermudaSdk('plasma-testnet', {
      provider: fork.url,
      relayer: relayer.url,
      // No issuer-policy service is running against the fork.
      policyEnforcement: false
    })

    wxpl = bermuda.config.WXPL
    usdt0 = bermuda.config.USDT0
    pool = await bermuda.config.pool.getAddress()

    wallet = new WalletManagerBermuda(SEED_PHRASE, { provider: fork.url })

    ethereumAccount = await wallet.getAccountByPath("0'/0/0")
    ethereumAddress = await ethereumAccount.getAddress()

    const seed = hexlify(ethereumAccount.keyPair.privateKey)

    account = new WalletAccountBermuda(bermuda, ethereumAccount, await bermuda.account({ seed, id: 0 }))
    subAccount = new WalletAccountBermuda(bermuda, ethereumAccount, await bermuda.account({ seed, id: 1 }))

    await setBalance(fork.hre.provider, ethereumAddress)

    // WXPL is wrapped and delivered by a faucet, and USDT0 is written straight
    // into storage, so the account under test has sent no transaction of its own
    // before the code under test runs. Its first signed transaction must be at
    // nonce zero, or ethers' cached transaction count puts it one behind.
    await fundWrappedNative(fork.hre.provider, fork.url, wxpl, ethereumAddress, WXPL_FUNDING)
    await setTokenBalance(fork.hre.provider, usdt0, USDT0_BALANCE_SLOT, ethereumAddress, USDT0_FUNDING)

    // USDT0 exposes DOMAIN_SEPARATOR but no `nonces`, so the SDK cannot mint an
    // EIP-2612 permit for it. Standing in for an approval made earlier.
    await setTokenAllowance(fork.hre.provider, usdt0, USDT0_ALLOWANCE_SLOT, ethereumAddress, pool, USDT0_FUNDING)
  }, OPERATION_TIMEOUT)

  afterAll(async () => {
    provider?.destroy()
    wallet?.dispose()
    await relayer?.close()
    await fork?.close()
  })

  describe('addresses and balances', () => {
    test('reports the same Bermuda address from the getter and the method', () => {
      expect(account.getAddress()).toBe(account.address)
      expect(account.address).toMatch(/^0x[0-9a-f]{448}$/)
      expect(subAccount.address).not.toBe(account.address)
    })

    test('reports a zero balance for a token it holds nothing of', async () => {
      await expect(account.getTokenBalance(usdt0)).resolves.toBe(0n)
    }, OPERATION_TIMEOUT)

    test('reports zero for every requested token when the account is empty', async () => {
      const balances = await account.getTokenBalances([wxpl, usdt0])

      // The keys come back lower-cased regardless of how they were passed in.
      expect(balances).toEqual({
        [wxpl.toLowerCase()]: 0n,
        [usdt0.toLowerCase()]: 0n
      })
    }, OPERATION_TIMEOUT)
  })

  describe('deposit', () => {
    test('approves the pool before shielding the wrapped native token', async () => {
      const amount = 5_000n

      expect(await allowanceOf(fork.url, wxpl, ethereumAddress, pool)).toBe(0n)

      const hash = await account.deposit({ token: wxpl, amount })

      const receipt = await provider.waitForTransaction(hash)

      expect(receipt.status).toBe(1)

      // WXPL is WETH9 and cannot be permitted, so the account must have sent a
      // real approval first and had it mined before the deposit was built.
      expect(await allowanceOf(fork.url, wxpl, ethereumAddress, pool)).toBe(amount)

      await expect(account.getTokenBalance(wxpl)).resolves.toBe(amount)
    }, OPERATION_TIMEOUT)

    test('skips the approval when the pool allowance already covers the deposit', async () => {
      const before = await allowanceOf(fork.url, wxpl, ethereumAddress, pool)
      const nonceBefore = await provider.getTransactionCount(ethereumAddress)

      const amount = before - 1_000n

      const shieldedBefore = await account.getTokenBalance(wxpl)

      await provider.waitForTransaction(await account.deposit({ token: wxpl, amount }))

      // One transaction only: the deposit. No second approval was sent.
      expect(await provider.getTransactionCount(ethereumAddress)).toBe(nonceBefore + 1)
      expect(await allowanceOf(fork.url, wxpl, ethereumAddress, pool)).toBe(before)

      await expect(account.getTokenBalance(wxpl)).resolves.toBe(shieldedBefore + amount)
    }, OPERATION_TIMEOUT)

    test('sends no value and skips the pre-flight for a plain ERC-20', async () => {
      const amount = 2_500n

      const walletBefore = await tokenBalanceOf(fork.url, usdt0, ethereumAddress)

      const hash = await account.deposit({ token: usdt0, amount })

      const [receipt, transaction] = await Promise.all([
        provider.waitForTransaction(hash),
        provider.getTransaction(hash)
      ])

      expect(receipt.status).toBe(1)

      // The value is only carried for the wrapped native token.
      expect(transaction.value).toBe(0n)

      expect(await tokenBalanceOf(fork.url, usdt0, ethereumAddress)).toBe(walletBefore - amount)

      await expect(account.getTokenBalance(usdt0)).resolves.toBe(amount)
    }, OPERATION_TIMEOUT)

    test('shields to another Bermuda account when a recipient is named', async () => {
      const amount = 400n

      const recipientBefore = await subAccount.getTokenBalance(wxpl)
      const senderBefore = await account.getTokenBalance(wxpl)

      await provider.waitForTransaction(
        await account.deposit({ token: wxpl, to: subAccount.address, amount })
      )

      await expect(subAccount.getTokenBalance(wxpl)).resolves.toBe(recipientBefore + amount)

      // The depositor funds it but receives nothing.
      await expect(account.getTokenBalance(wxpl)).resolves.toBe(senderBefore)
    }, OPERATION_TIMEOUT)

    test('shields to several recipients at once', async () => {
      const toSelf = 300n
      const toSub = 200n

      const selfBefore = await account.getTokenBalance(usdt0)
      const subBefore = await subAccount.getTokenBalance(usdt0)

      await provider.waitForTransaction(
        await account.deposit({
          token: usdt0,
          recipients: [
            { to: account.address, amount: toSelf, note: 'self' },
            { to: subAccount.address, amount: toSub }
          ]
        })
      )

      await expect(account.getTokenBalance(usdt0)).resolves.toBe(selfBefore + toSelf)
      await expect(subAccount.getTokenBalance(usdt0)).resolves.toBe(subBefore + toSub)
    }, OPERATION_TIMEOUT)

    // Pins a defect rather than endorsing it. The SDK accepts `recipients` in
    // place of `amount` for a batch deposit, but the wrapped-native pre-flight
    // reads `params.amount` unconditionally (and so does the `value` it sends),
    // so a batch deposit of the wrapped native token cannot be expressed at all.
    // A plain ERC-20 batch, exercised above, is unaffected.
    test('cannot batch-deposit the wrapped native token', async () => {
      await expect(account.deposit({
        token: wxpl,
        recipients: [
          { to: account.address, amount: 100n },
          { to: subAccount.address, amount: 100n }
        ]
      })).rejects.toThrow(TypeError)
    }, OPERATION_TIMEOUT)

    test('reports both shielded balances together', async () => {
      const balances = await account.getTokenBalances([wxpl, usdt0])

      expect(balances[wxpl.toLowerCase()]).toBeGreaterThan(0n)
      expect(balances[usdt0.toLowerCase()]).toBeGreaterThan(0n)
    }, OPERATION_TIMEOUT)
  })

  describe('transfer', () => {
    test('moves shielded funds between accounts without touching the chain balance', async () => {
      const amount = 1_000n

      const senderBefore = await account.getTokenBalance(wxpl)
      const recipientBefore = await subAccount.getTokenBalance(wxpl)
      const walletBefore = await tokenBalanceOf(fork.url, wxpl, ethereumAddress)

      const receipt = await provider.waitForTransaction(
        await account.transfer({
          token: wxpl,
          to: subAccount.address,
          amount,
          note: 'integration'
        })
      )

      expect(receipt.status).toBe(1)

      await expect(account.getTokenBalance(wxpl)).resolves.toBe(senderBefore - amount)
      await expect(subAccount.getTokenBalance(wxpl)).resolves.toBe(recipientBefore + amount)

      // The relayer paid for and submitted the transaction, not the account.
      expect(receipt.from).toBe(relayer.address)
      expect(await tokenBalanceOf(fork.url, wxpl, ethereumAddress)).toBe(walletBefore)
    }, OPERATION_TIMEOUT)
  })

  describe('withdraw', () => {
    test('unshields to a named Ethereum address', async () => {
      const amount = 250n
      const recipient = (await wallet.getAccount(5)).address

      const shieldedBefore = await account.getTokenBalance(wxpl)

      expect(await tokenBalanceOf(fork.url, wxpl, recipient)).toBe(0n)

      const receipt = await provider.waitForTransaction(
        await account.withdraw({ token: wxpl, to: recipient, amount })
      )

      expect(receipt.status).toBe(1)

      expect(await tokenBalanceOf(fork.url, wxpl, recipient)).toBe(amount)

      await expect(account.getTokenBalance(wxpl)).resolves.toBe(shieldedBefore - amount)
    }, OPERATION_TIMEOUT)

    test('unshields to the account\'s own Ethereum address by default', async () => {
      const amount = 150n

      const walletBefore = await tokenBalanceOf(fork.url, wxpl, ethereumAddress)
      const shieldedBefore = await account.getTokenBalance(wxpl)

      await provider.waitForTransaction(await account.withdraw({ token: wxpl, amount }))

      expect(await tokenBalanceOf(fork.url, wxpl, ethereumAddress)).toBe(walletBefore + amount)

      await expect(account.getTokenBalance(wxpl)).resolves.toBe(shieldedBefore - amount)
    }, OPERATION_TIMEOUT)
  })

  describe('the ethers signer adapter', () => {
    test('exposes the SDK provider and the Ethereum address', async () => {
      const signer = account._getEthersSigner()

      expect(signer.provider).toBe(bermuda.config.provider)
      await expect(signer.getAddress()).resolves.toBe(ethereumAddress)
    })

    test('signs messages recoverably to the Ethereum account', async () => {
      const message = 'shield it'

      const signature = await account._getEthersSigner().signMessage(message)

      expect(verifyMessage(message, signature)).toBe(ethereumAddress)
    })

    // The adapter exists because the SDK calls ethers' positional
    // `signTypedData(domain, types, message)` while the wallet's signer takes a
    // single object. A regression here would be silently wrong signatures.
    test('signs typed data given positionally, as the SDK calls it', async () => {
      const domain = {
        name: 'Bermuda',
        version: '1',
        chainId: 9746,
        verifyingContract: pool
      }

      const types = { Shield: [{ name: 'amount', type: 'uint256' }] }

      const message = { amount: 42n }

      const signature = await account._getEthersSigner().signTypedData(domain, types, message)

      expect(verifyTypedData(domain, types, message, signature)).toBe(ethereumAddress)
    })
  })

  describe('dispose', () => {
    test('erases both the Ethereum and the Bermuda key material', async () => {
      const seed = hexlify(ethereumAccount.keyPair.privateKey)

      const disposable = new WalletAccountBermuda(
        bermuda,
        await wallet.getAccountByPath("0'/0/9"),
        await bermuda.account({ seed, id: 9 })
      )

      const x25519 = disposable._bermudaKeyPair.x25519.secretKey

      expect(x25519.some(byte => byte !== 0)).toBe(true)

      disposable.dispose()

      expect(disposable._bermudaKeyPair.privkey).toBeNull()
      expect(x25519.every(byte => byte === 0)).toBe(true)
      expect(disposable._ethereumWallet.keyPair.privateKey).toBeNull()
    }, OPERATION_TIMEOUT)
  })
})
