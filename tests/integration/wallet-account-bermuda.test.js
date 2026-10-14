import {
  JsonRpcProvider,
  parseEther,
  verifyMessage,
  verifyTypedData
} from 'ethers'

import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals'

import { TransactionError, TransactionErrorReason } from '@tetherto/wdk-wallet'

import WalletManagerBermuda, { NATIVE_DEPOSIT_TOKEN } from '../../index.js'

import { serveRelayer } from './helpers/relayer.js'

import {
  USDT0_ALLOWANCE_SLOT,
  USDT0_BALANCE_SLOT,
  WXPL_ALLOWANCE_SLOT,
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
// exist. Deposits are still vetted by the deployment's hosted compliance engine.
//
// plasma-testnet specifically, because it is the chain whose SDK config carries a
// wrapped-native token (`WXPL`). The deposit path branches on that, and on
// `testenv` the branch is unreachable.
//
// The tests share one fork and run in order, asserting on deltas rather than
// absolute balances. Snapshot/revert would desynchronise the SDK's in-memory UTXO
// state from the chain it was built from.

const SEED_PHRASE = 'cook voyage document eight skate token alien guide drink uncle term abuse'

// Proof generation dominates: each shielded operation takes a few seconds, more
// for the first, which loads the prover.
const OPERATION_TIMEOUT = 240_000

const WXPL_FUNDING = parseEther('10')
const USDT0_FUNDING = 1_000_000n

// The SDK reads the chain through a pool of RPC nodes that reuses a read, the
// chain's head among them, for up to a block time: a second on plasma-testnet.
// A balance read within that time of a transaction can still predate it.
const READ_REUSE_MS = 1_100

describe('WalletAccountBermuda against a plasma-testnet fork', () => {
  let fork,
    relayer,
    provider,
    wallet,
    ethereumAccount,
    ethereumAddress,
    account,
    subAccount,
    pool,
    wxpl,
    usdt0,
    warn

  beforeAll(async () => {
    // Watches, without silencing, what reaches the console.
    warn = jest.spyOn(console, 'warn')

    fork = await startFork()

    relayer = await serveRelayer(fork.url)

    await setBalance(fork.hre.provider, relayer.address)

    provider = new JsonRpcProvider(fork.url)

    wallet = new WalletManagerBermuda(SEED_PHRASE, {
      provider: fork.url,
      bermuda: {
        relayer: relayer.url,
        // The deployment's indexer serves the live chain, whose commitments after
        // the fork block the forked pool does not hold. The SDK would notice and
        // read the fork instead; reading only the fork keeps every run alike.
        chainState: undefined
      }
    })

    account = await wallet.getBermudaAccount(0, 0)
    subAccount = await wallet.getBermudaAccount(0, 1)

    ethereumAccount = await wallet.getAccountByPath("0'/0/0")
    ethereumAddress = await ethereumAccount.getAddress()

    wxpl = account._bermuda.config.WXPL
    usdt0 = account._bermuda.config.USDT0
    pool = await account._bermuda.config.pool.getAddress()

    await setBalance(fork.hre.provider, ethereumAddress)

    // WXPL is wrapped and delivered by a faucet, and USDT0 is written straight
    // into storage, so the account under test has sent no transaction of its own
    // before the code under test runs. Its first signed transaction must be at
    // nonce zero, or ethers' cached transaction count puts it one behind.
    await fundWrappedNative(fork.hre.provider, fork.url, wxpl, ethereumAddress, WXPL_FUNDING)
    await setTokenBalance(fork.hre.provider, usdt0, USDT0_BALANCE_SLOT, ethereumAddress, USDT0_FUNDING)

    // USDT0 exposes DOMAIN_SEPARATOR but no `nonces`, so the SDK cannot mint an
    // EIP-2612 permit for it. Standing in for an approval made earlier, which
    // covers the deposits and any fees on top of them.
    await setTokenAllowance(fork.hre.provider, usdt0, USDT0_ALLOWANCE_SLOT, ethereumAddress, pool, USDT0_FUNDING)
  }, OPERATION_TIMEOUT)

  afterAll(async () => {
    provider?.destroy()
    wallet?.dispose()
    await relayer?.close()
    await fork?.close()
    warn?.mockRestore()
  })

  // Waits for a transaction to be mined, and for the SDK to read past it.
  async function settle (hash) {
    const receipt = await provider.waitForTransaction(hash)

    await new Promise(resolve => setTimeout(resolve, READ_REUSE_MS))

    return receipt
  }

  describe('addresses and balances', () => {
    test('reports the same Bermuda address from the getter and the method', () => {
      expect(account.getAddress()).toBe(account.address)
      expect(account.address).toMatch(/^0x[0-9a-f]{2496}$/)
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
    test('approves the pool for the deposit total before shielding the wrapped native token', async () => {
      const amount = 5_000n

      expect(await allowanceOf(fork.url, wxpl, ethereumAddress, pool)).toBe(0n)

      const walletBefore = await tokenBalanceOf(fork.url, wxpl, ethereumAddress)
      const nonceBefore = await provider.getTransactionCount(ethereumAddress)

      const hash = await account.deposit({ token: wxpl, amount })

      const [receipt, transaction] = await Promise.all([
        settle(hash),
        provider.getTransaction(hash)
      ])

      expect(receipt.status).toBe(1)

      // WXPL is WETH9 and cannot be permitted, so the account must have sent a
      // real approval first, and the deposit at the nonce after it. The deposit
      // carries no value: the pool pulls the WXPL itself.
      expect(transaction.nonce).toBe(nonceBefore + 1)
      expect(transaction.value).toBe(0n)

      // The approval covered exactly what the pool pulled: the amount, and any
      // fees on top of it.
      expect(await allowanceOf(fork.url, wxpl, ethereumAddress, pool)).toBe(0n)
      expect(walletBefore - await tokenBalanceOf(fork.url, wxpl, ethereumAddress)).toBeGreaterThanOrEqual(amount)

      await expect(account.getTokenBalance(wxpl)).resolves.toBe(amount)

      // The SDK warns that it cannot permit WXPL before falling back to the
      // allowance, which the account approves right after: an expected warning,
      // kept off the console.
      expect(warn.mock.calls.filter(([message]) => String(message).startsWith('deposit: EIP-2612 permit unavailable'))).toEqual([])
    }, OPERATION_TIMEOUT)

    test('skips the approval when the pool allowance already covers the deposit total', async () => {
      const amount = 1_000n
      const allowance = 1_000_000n

      // Standing in for an approval made earlier, without the account under test
      // sending a transaction of its own first.
      await setTokenAllowance(fork.hre.provider, wxpl, WXPL_ALLOWANCE_SLOT, ethereumAddress, pool, allowance)

      expect(await allowanceOf(fork.url, wxpl, ethereumAddress, pool)).toBe(allowance)

      const nonceBefore = await provider.getTransactionCount(ethereumAddress)
      const shieldedBefore = await account.getTokenBalance(wxpl)

      await settle(await account.deposit({ token: wxpl, amount }))

      // One transaction only: the deposit. No approval was sent.
      expect(await provider.getTransactionCount(ethereumAddress)).toBe(nonceBefore + 1)
      expect(allowance - await allowanceOf(fork.url, wxpl, ethereumAddress, pool)).toBeGreaterThanOrEqual(amount)

      await expect(account.getTokenBalance(wxpl)).resolves.toBe(shieldedBefore + amount)
    }, OPERATION_TIMEOUT)

    test('refuses a deposit the Ethereum account cannot pay, before approving it', async () => {
      // More WXPL than the account was ever given, let alone holds after the deposits above.
      const amount = WXPL_FUNDING + 1n

      const held = await tokenBalanceOf(fork.url, wxpl, ethereumAddress)
      const allowanceBefore = await allowanceOf(fork.url, wxpl, ethereumAddress, pool)
      const nonceBefore = await provider.getTransactionCount(ethereumAddress)

      expect(allowanceBefore).toBeLessThan(amount)

      const error = await account.deposit({ token: wxpl, amount }).then(() => undefined, error => error)

      expect(error).toBeInstanceOf(TransactionError)
      expect(error.reason).toBe(TransactionErrorReason.INSUFFICIENT_BALANCE)
      expect(error.message).toContain(`of token ${wxpl} (its amount and fees, in base units)`)
      expect(error.message).toContain(`the Ethereum account ${ethereumAddress} holds ${held}.`)
      expect(error.message).toMatch(/deposit NATIVE_DEPOSIT_TOKEN\.$/)

      // Neither the approval the allowance falls short of, nor the deposit, was sent.
      expect(await provider.getTransactionCount(ethereumAddress)).toBe(nonceBefore)
      expect(await allowanceOf(fork.url, wxpl, ethereumAddress, pool)).toBe(allowanceBefore)
    }, OPERATION_TIMEOUT)

    test('sends no value and skips the pre-flight for a plain ERC-20', async () => {
      const amount = 2_500n

      const walletBefore = await tokenBalanceOf(fork.url, usdt0, ethereumAddress)
      const nonceBefore = await provider.getTransactionCount(ethereumAddress)

      const hash = await account.deposit({ token: usdt0, amount })

      const [receipt, transaction] = await Promise.all([
        settle(hash),
        provider.getTransaction(hash)
      ])

      expect(receipt.status).toBe(1)

      expect(transaction.nonce).toBe(nonceBefore)
      expect(transaction.value).toBe(0n)

      expect(walletBefore - await tokenBalanceOf(fork.url, usdt0, ethereumAddress)).toBeGreaterThanOrEqual(amount)

      await expect(account.getTokenBalance(usdt0)).resolves.toBe(amount)
    }, OPERATION_TIMEOUT)

    test('shields the native currency when the token is NATIVE_DEPOSIT_TOKEN', async () => {
      const amount = 3_000n

      const shieldedBefore = await account.getTokenBalance(wxpl)
      const nonceBefore = await provider.getTransactionCount(ethereumAddress)

      const hash = await account.deposit({ token: NATIVE_DEPOSIT_TOKEN, amount })

      const [receipt, transaction] = await Promise.all([
        settle(hash),
        provider.getTransaction(hash)
      ])

      expect(receipt.status).toBe(1)

      // The deposit itself carries the native value, and the pool wraps it: no
      // approval is needed.
      expect(transaction.nonce).toBe(nonceBefore)
      expect(transaction.value).toBeGreaterThanOrEqual(amount)

      await expect(account.getTokenBalance(wxpl)).resolves.toBe(shieldedBefore + amount)
    }, OPERATION_TIMEOUT)

    test('shields to another Bermuda account when a recipient is named', async () => {
      const amount = 400n

      const recipientBefore = await subAccount.getTokenBalance(wxpl)
      const senderBefore = await account.getTokenBalance(wxpl)

      await settle(
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

      await settle(
        await account.deposit({
          token: usdt0,
          recipients: [
            { to: account.address, amount: toSelf, memo: 'self' },
            { to: subAccount.address, amount: toSub }
          ]
        })
      )

      await expect(account.getTokenBalance(usdt0)).resolves.toBe(selfBefore + toSelf)
      await expect(subAccount.getTokenBalance(usdt0)).resolves.toBe(subBefore + toSub)
    }, OPERATION_TIMEOUT)

    test('shields the wrapped native token to several recipients at once', async () => {
      const selfBefore = await account.getTokenBalance(wxpl)
      const subBefore = await subAccount.getTokenBalance(wxpl)

      await settle(
        await account.deposit({
          token: wxpl,
          recipients: [
            { to: account.address, amount: 100n },
            { to: subAccount.address, amount: 100n }
          ]
        })
      )

      await expect(account.getTokenBalance(wxpl)).resolves.toBe(selfBefore + 100n)
      await expect(subAccount.getTokenBalance(wxpl)).resolves.toBe(subBefore + 100n)
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

      const receipt = await settle(
        await account.transfer({
          token: wxpl,
          to: subAccount.address,
          amount,
          memo: 'integration'
        })
      )

      expect(receipt.status).toBe(1)

      // The sender also pays the pool's transfer fee, if it charges one.
      expect(senderBefore - await account.getTokenBalance(wxpl)).toBeGreaterThanOrEqual(amount)
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

      const receipt = await settle(
        await account.withdraw({ token: wxpl, to: recipient, amount })
      )

      expect(receipt.status).toBe(1)

      expect(await tokenBalanceOf(fork.url, wxpl, recipient)).toBe(amount)

      // The protocol's withdrawal fee, if it charges one, comes on top.
      expect(shieldedBefore - await account.getTokenBalance(wxpl)).toBeGreaterThanOrEqual(amount)
    }, OPERATION_TIMEOUT)

    test('unshields to the account\'s own Ethereum address by default', async () => {
      const amount = 150n

      const walletBefore = await tokenBalanceOf(fork.url, wxpl, ethereumAddress)

      await settle(await account.withdraw({ token: wxpl, amount }))

      expect(await tokenBalanceOf(fork.url, wxpl, ethereumAddress)).toBe(walletBefore + amount)
    }, OPERATION_TIMEOUT)
  })

  describe('the ethers signer adapter', () => {
    test('exposes the SDK provider and the Ethereum address', async () => {
      const signer = account._getEthersSigner()

      expect(signer.provider).toBe(account._bermuda.config.provider)
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
    test('erases the Bermuda key material but not the Ethereum account it shares', async () => {
      const disposable = await wallet.getBermudaAccount(9, 0)

      const secretKey = disposable._bermudaKeyPair.xwing.secretKey

      expect(secretKey.some(byte => byte !== 0)).toBe(true)

      disposable.dispose()

      expect(disposable.disposed).toBe(true)
      expect(disposable._bermudaKeyPair.privkey).toBeNull()
      expect(secretKey.every(byte => byte === 0)).toBe(true)

      // The Ethereum account belongs to the wallet manager, which keeps handing it
      // out, and other Bermuda accounts derived from it still sign with it.
      const ethereumWallet = await wallet.getAccountByPath("0'/0/9")

      expect(ethereumWallet).toBe(disposable._ethereumWallet)
      expect(ethereumWallet.keyPair.privateKey).not.toBeNull()
      await expect(ethereumWallet.sign('still usable')).resolves.toMatch(/^0x[0-9a-f]{130}$/)
    }, OPERATION_TIMEOUT)
  })
})
