import * as ethers from 'ethers'

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'

import WalletManager, { ProviderRequiredError, ValueError, WdkError } from '@tetherto/wdk-wallet'

// The sibling suite drives the manager through a real Hardhat node and the
// real Bermuda SDK. The options the manager hands the SDK cannot be exercised
// that way: `initBermudaSdk` has to be observable, and a real SDK handed a cache
// path would touch the filesystem. Mocks must be installed before the module
// under test is loaded, hence the separate file. That includes
// @tetherto/wdk-wallet-evm: its WalletManagerEvm builds the provider.

let bermudaSdk

const initBermudaSdk = jest.fn(() => bermudaSdk)

jest.unstable_mockModule('@bermuda/sdk', () => ({
  default: initBermudaSdk,
  isNativeDepositToken: jest.fn(),
  proveWithinPeriod: jest.fn()
}))

let provider

const BrowserProvider = jest.fn(() => provider)

jest.unstable_mockModule('ethers', () => ({
  ...ethers,
  BrowserProvider
}))

const { WalletAccountEvm } = await import('@tetherto/wdk-wallet-evm')
const { SeedSignerEvm } = await import('@tetherto/wdk-wallet-evm/signers')

const { default: WalletManagerBermuda } = await import('../src/wallet-manager-bermuda.js')
const { default: WalletAccountBermuda } = await import('../src/wallet-account-bermuda.js')

const SEED_PHRASE = 'cook voyage document eight skate token alien guide drink uncle term abuse'
const UTXO_CACHE = '/tmp/bermuda/utxos.json'
const EIP1193_PROVIDER = { request: jest.fn() }

// Stands in for the SDK's key pair: just the address and the two secrets that
// disposing a Bermuda account erases.
function createBermudaKeyPair (id) {
  return {
    address: jest.fn(() => `0xbermuda${id}`),
    privkey: BigInt(id + 1),
    xwing: { secretKey: new Uint8Array([1, 2, 3]) }
  }
}

// Stands in for an SDK created for a chain it has a deployment on.
function createBermudaSdk () {
  return {
    config: { pool: {} },
    account: jest.fn(async ({ id }) => createBermudaKeyPair(id))
  }
}

describe('WalletManagerBermuda sdk configuration', () => {
  let fs

  beforeEach(() => {
    jest.clearAllMocks()

    provider = {
      getNetwork: jest.fn(async () => ({ chainId: 31337n }))
    }

    bermudaSdk = createBermudaSdk()

    fs = { readFileSync: jest.fn(), writeFileSync: jest.fn() }
  })

  function createWallet (config = {}) {
    return new WalletManagerBermuda(SEED_PHRASE, {
      provider: EIP1193_PROVIDER,
      ...config
    })
  }

  // The wallet's providers are real ethers ones when given urls; the chain id is
  // all the manager asks them, so a stub answers it instead.
  function stubProviderOf (wallet) {
    wallet._provider.destroy()
    wallet._provider = provider
  }

  test('hands the sdk the eip-1193 provider the wallet wraps', async () => {
    const wallet = createWallet({ fs })

    const account = await wallet.getBermudaAccount(0, 0)

    expect(account).toBeInstanceOf(WalletAccountBermuda)

    expect(initBermudaSdk).toHaveBeenCalledWith('testenv', { chainId: 31337n, provider })

    wallet.dispose()
  })

  // The SDK builds its own pool of RPC nodes on a url, which splits the log
  // queries a node refuses as too wide.
  test('hands the sdk the url of the wallet\'s provider', async () => {
    const wallet = createWallet({ provider: 'http://127.0.0.1:8545' })

    stubProviderOf(wallet)

    await wallet.getBermudaAccount(0, 0)

    expect(initBermudaSdk).toHaveBeenCalledWith('testenv', { chainId: 31337n, provider: 'http://127.0.0.1:8545' })

    wallet.dispose()
  })

  test('hands the sdk the urls of the wallet\'s failover providers as its rpc urls', async () => {
    const urls = ['http://127.0.0.1:8545', 'http://127.0.0.1:8546']

    const wallet = createWallet({ provider: urls })

    stubProviderOf(wallet)

    await wallet.getBermudaAccount(0, 0)

    expect(initBermudaSdk).toHaveBeenCalledWith('testenv', { chainId: 31337n, rpcUrls: urls })

    wallet.dispose()
  })

  test('hands the sdk the bermuda options', async () => {
    const wallet = createWallet({ bermuda: { relayer: 'http://127.0.0.1:4191', depositClass: 'idle' } })

    await wallet.getBermudaAccount(0, 0)

    expect(initBermudaSdk).toHaveBeenCalledWith('testenv', {
      chainId: 31337n,
      provider,
      relayer: 'http://127.0.0.1:4191',
      depositClass: 'idle'
    })

    wallet.dispose()
  })

  test.each([
    [{ rpcUrls: ['http://127.0.0.1:8547'] }],
    [{ provider: 'http://127.0.0.1:8547' }]
  ])('lets the bermuda options %p replace the wallet\'s provider', async (bermuda) => {
    const wallet = createWallet({ bermuda })

    await wallet.getBermudaAccount(0, 0)

    expect(initBermudaSdk).toHaveBeenCalledWith('testenv', { chainId: 31337n, ...bermuda })

    wallet.dispose()
  })

  test('rejects a chain the sdk has no deployment on', async () => {
    bermudaSdk.config = {}

    provider.getNetwork.mockResolvedValue({ chainId: 8453n })

    const wallet = createWallet()

    const error = await wallet.getBermudaAccount(0, 0).catch(error => error)

    expect(error).toBeInstanceOf(ValueError)
    expect(error.message).toBe('The Bermuda SDK has no deployment on chain base (chain id 8453).')

    expect(bermudaSdk.account).not.toHaveBeenCalled()

    wallet.dispose()
  })

  test('derives the commitment events cache from the utxo cache', async () => {
    const wallet = createWallet({ utxoCache: UTXO_CACHE, fs })

    await wallet.getBermudaAccount(0, 0)

    expect(initBermudaSdk).toHaveBeenCalledWith('testenv', {
      chainId: 31337n,
      provider,
      utxoCache: UTXO_CACHE,
      commitmentEventsCache: '/tmp/bermuda/utxos-commitment-events.json',
      fs
    })

    wallet.dispose()
  })

  test('prefers an explicit commitment events cache over the derived one', async () => {
    const commitmentEventsCache = '/tmp/bermuda/events.json'

    const wallet = createWallet({
      utxoCache: UTXO_CACHE,
      commitmentEventsCache,
      fs
    })

    await wallet.getBermudaAccount(0, 0)

    expect(initBermudaSdk).toHaveBeenCalledWith('testenv', {
      chainId: 31337n,
      provider,
      utxoCache: UTXO_CACHE,
      commitmentEventsCache,
      fs
    })

    wallet.dispose()
  })

  // Pins current behaviour rather than endorsing it: the derivation is anchored
  // to a `.json` suffix, so a path without one is left untouched and both
  // caches end up pointing at the same file. See follow-up F2 in test_plan.md.
  test('collides both caches when the utxo cache path does not end in .json', async () => {
    const utxoCache = '/tmp/bermuda/utxos'

    const wallet = createWallet({ utxoCache, fs })

    await wallet.getBermudaAccount(0, 0)

    expect(initBermudaSdk).toHaveBeenCalledWith('testenv', {
      chainId: 31337n,
      provider,
      utxoCache,
      commitmentEventsCache: utxoCache,
      fs
    })

    wallet.dispose()
  })

  test('passes an undefined fs through when the utxo cache is set without one', async () => {
    const wallet = createWallet({ utxoCache: UTXO_CACHE })

    await wallet.getBermudaAccount(0, 0)

    expect(initBermudaSdk).toHaveBeenCalledWith('testenv', expect.objectContaining({
      fs: undefined
    }))

    wallet.dispose()
  })

  test.each([
    [0, -1],
    [-1, 0]
  ])('rejects the negative account indices %p and %p', async (bip44AccountIndex, bermudaAccountIndex) => {
    const wallet = createWallet()

    const error = await wallet.getBermudaAccount(bip44AccountIndex, bermudaAccountIndex).catch(error => error)

    expect(error).toBeInstanceOf(ValueError)
    expect(error.message).toBe('Account index must not be negative.')

    expect(initBermudaSdk).not.toHaveBeenCalled()

    wallet.dispose()
  })

  test.each([
    [1.5, 0],
    [0, '1'],
    [0, NaN]
  ])('rejects the non-integer account indices %p and %p', async (bip44AccountIndex, bermudaAccountIndex) => {
    const wallet = createWallet()

    const error = await wallet.getBermudaAccount(bip44AccountIndex, bermudaAccountIndex).catch(error => error)

    expect(error).toBeInstanceOf(ValueError)
    expect(error.message).toBe('Account index must be an integer.')

    expect(initBermudaSdk).not.toHaveBeenCalled()

    wallet.dispose()
  })

  test('rejects when the wallet has no provider', async () => {
    const wallet = new WalletManagerBermuda(SEED_PHRASE)

    const error = await wallet.getBermudaAccount().catch(error => error)

    // Hosts catch every wallet module's errors through the shared WDK base class.
    expect(error).toBeInstanceOf(ProviderRequiredError)
    expect(error).toBeInstanceOf(WdkError)
    expect(error.message).toBe('The wallet must be connected to a provider to get Bermuda accounts.')

    wallet.dispose()
  })

  test('seeds the bermuda account with the derived ethereum private key', async () => {
    const wallet = createWallet()

    await wallet.getBermudaAccount(1, 2)

    const ethereumWallet = await wallet.getAccountByPath("0'/0/1")

    expect(bermudaSdk.account).toHaveBeenCalledWith({
      seed: ethers.hexlify(ethereumWallet.keyPair.privateKey),
      id: 2
    })

    wallet.dispose()
  })
})

// The provider-shaped behaviour below used to be covered only by the sibling
// Hardhat suite, which now lives in tests/integration. None of it needs a node:
// the constructor just branches on the config, `getAccount` is pure derivation,
// and `getFeeRates` is arithmetic over whatever `getFeeData` returns.

describe('WalletManagerBermuda constructor', () => {
  test('wraps a provider url in a JsonRpcProvider', () => {
    const wallet = new WalletManagerBermuda(SEED_PHRASE, {
      provider: 'http://127.0.0.1:8545'
    })

    expect(wallet._provider).toBeInstanceOf(ethers.JsonRpcProvider)

    wallet._provider.destroy()
    wallet.dispose()
  })

  test('wraps an eip-1193 provider in a BrowserProvider', () => {
    const wallet = new WalletManagerBermuda(SEED_PHRASE, { provider: EIP1193_PROVIDER })

    expect(BrowserProvider).toHaveBeenCalledWith(EIP1193_PROVIDER)

    wallet.dispose()
  })

  test('leaves the provider unset when none is configured', () => {
    const wallet = new WalletManagerBermuda(SEED_PHRASE)

    expect(wallet._provider).toBeUndefined()

    wallet.dispose()
  })

  test('rejects an invalid seed phrase with a ValueError', () => {
    expect(() => new WalletManagerBermuda('not a valid seed phrase')).toThrow(ValueError)
    expect(() => new WalletManagerBermuda('not a valid seed phrase')).toThrow('Invalid seed phrase.')
  })
})

describe('WalletManagerBermuda getAccount', () => {
  let wallet

  beforeEach(() => {
    wallet = new WalletManagerBermuda(SEED_PHRASE)
  })

  test('returns the account at index 0 by default', async () => {
    const account = await wallet.getAccount()

    expect(account).toBeInstanceOf(WalletAccountEvm)
    expect(account.path).toBe("m/44'/60'/0'/0/0")

    wallet.dispose()
  })

  test('returns the account at the given index', async () => {
    const account = await wallet.getAccount(3)

    expect(account.path).toBe("m/44'/60'/0'/0/3")

    wallet.dispose()
  })

  test('returns the same instance for a repeated path', async () => {
    const first = await wallet.getAccountByPath("0'/0/7")
    const second = await wallet.getAccountByPath("0'/0/7")

    expect(second).toBe(first)

    wallet.dispose()
  })

  test('throws if the index is a negative number', async () => {
    await expect(wallet.getAccount(-1)).rejects.toThrow('invalid path component')

    wallet.dispose()
  })
})

describe('WalletManagerBermuda getFeeRates', () => {
  function walletWithFeeData (feeData) {
    provider = { getFeeData: jest.fn(async () => feeData) }

    return new WalletManagerBermuda(SEED_PHRASE, { provider: EIP1193_PROVIDER })
  }

  test('applies the normal and fast multipliers to maxFeePerGas', async () => {
    const wallet = walletWithFeeData({ maxFeePerGas: 3_000_000_000n, gasPrice: 1n })

    await expect(wallet.getFeeRates()).resolves.toEqual({
      normal: 3_300_000_000n,
      fast: 6_000_000_000n
    })

    wallet.dispose()
  })

  test('falls back to the gas price on a chain without eip-1559', async () => {
    const wallet = walletWithFeeData({ maxFeePerGas: null, gasPrice: 2_000_000_000n })

    await expect(wallet.getFeeRates()).resolves.toEqual({
      normal: 2_200_000_000n,
      fast: 4_000_000_000n
    })

    wallet.dispose()
  })

  // Pins current behaviour rather than endorsing it: with no fee data at all the
  // multiplication throws a raw TypeError instead of a domain error.
  test('throws a TypeError if the provider reports no fee data', async () => {
    const wallet = walletWithFeeData({ maxFeePerGas: null, gasPrice: null })

    await expect(wallet.getFeeRates()).rejects.toThrow(TypeError)

    wallet.dispose()
  })

  test('throws if the wallet is not connected to a provider', async () => {
    const wallet = new WalletManagerBermuda(SEED_PHRASE)

    const error = await wallet.getFeeRates().catch(error => error)

    expect(error).toBeInstanceOf(ProviderRequiredError)
    expect(error.message).toBe('The wallet must be connected to a provider to get fee rates.')

    wallet.dispose()
  })
})

describe('WalletManagerBermuda dispose', () => {
  let wallet

  beforeEach(() => {
    jest.clearAllMocks()

    provider = {
      getNetwork: jest.fn(async () => ({ chainId: 31337n }))
    }

    bermudaSdk = createBermudaSdk()

    wallet = new WalletManagerBermuda(SEED_PHRASE, { provider: EIP1193_PROVIDER })
  })

  afterEach(() => {
    wallet.dispose()
  })

  test('keeps the shared ethereum account usable when a bermuda account is disposed', async () => {
    const first = await wallet.getBermudaAccount(0, 0)
    const second = await wallet.getBermudaAccount(0, 1)

    expect(second._ethereumWallet).toBe(first._ethereumWallet)

    first.dispose()

    expect(second.disposed).toBe(false)

    const ethereumAccount = await wallet.getAccount(0)

    expect(ethereumAccount).toBe(first._ethereumWallet)
    expect(ethereumAccount.keyPair.privateKey).not.toBeNull()
    await expect(ethereumAccount.sign('still usable')).resolves.toMatch(/^0x[0-9a-f]{130}$/)
  })

  test('returns the same bermuda account for the same indices', async () => {
    const first = await wallet.getBermudaAccount(0, 0)
    const second = await wallet.getBermudaAccount(0, 0)

    expect(second).toBe(first)
    expect(initBermudaSdk).toHaveBeenCalledTimes(1)
  })

  test('derives a bermuda account only once for concurrent requests', async () => {
    const [first, second] = await Promise.all([
      wallet.getBermudaAccount(0, 0),
      wallet.getBermudaAccount(0, 0)
    ])

    expect(second).toBe(first)
    expect(bermudaSdk.account).toHaveBeenCalledTimes(1)
  })

  test('derives a fresh bermuda account once the cached one is disposed', async () => {
    const first = await wallet.getBermudaAccount(0, 0)

    first.dispose()

    const second = await wallet.getBermudaAccount(0, 0)

    expect(second).not.toBe(first)
    expect(second.disposed).toBe(false)
  })

  test('disposes the bermuda accounts along with the evm accounts', async () => {
    const accounts = [
      await wallet.getBermudaAccount(0, 0),
      await wallet.getBermudaAccount(0, 1),
      await wallet.getBermudaAccount(1, 0)
    ]

    const keyPairs = accounts.map(account => account._bermudaKeyPair)

    const ethereumAccounts = [await wallet.getAccount(0), await wallet.getAccount(1)]

    wallet.dispose()

    expect(wallet.disposed).toBe(true)

    for (const account of accounts) {
      expect(account.disposed).toBe(true)
    }

    for (const keyPair of keyPairs) {
      expect(keyPair.privkey).toBeNull()
      expect(keyPair.xwing.secretKey).toEqual(new Uint8Array(3))
    }

    for (const ethereumAccount of ethereumAccounts) {
      expect(ethereumAccount.keyPair.privateKey).toBeNull()
    }
  })

  test('can be disposed more than once', () => {
    wallet.dispose()

    expect(() => wallet.dispose()).not.toThrow()
    expect(wallet.disposed).toBe(true)
  })

  test('rejects requests for bermuda accounts once disposed', async () => {
    wallet.dispose()

    const error = await wallet.getBermudaAccount().catch(error => error)

    expect(error).toBeInstanceOf(WdkError)
    expect(error.message).toBe('The wallet has been disposed.')

    expect(initBermudaSdk).not.toHaveBeenCalled()
  })

  test('erases a bermuda account whose derivation outlasted the wallet', async () => {
    let resolveKeyPair

    bermudaSdk.account.mockImplementation(() => new Promise(resolve => {
      resolveKeyPair = resolve
    }))

    const pending = wallet.getBermudaAccount(0, 0)

    for (let tick = 0; tick < 100 && !resolveKeyPair; tick++) {
      await new Promise(resolve => setImmediate(resolve))
    }

    wallet.dispose()

    const keyPair = createBermudaKeyPair(0)

    resolveKeyPair(keyPair)

    await expect(pending).rejects.toThrow('The wallet has been disposed.')

    expect(keyPair.privkey).toBeNull()
    expect(keyPair.xwing.secretKey).toEqual(new Uint8Array(3))
  })

  test('erases the root key derived from the seed', () => {
    const dispose = jest.spyOn(wallet._defaultSigner, 'dispose')

    wallet.dispose()

    expect(dispose).toHaveBeenCalled()
    expect(wallet._defaultSigner).toBeUndefined()
  })

  // From @tetherto/wdk-wallet 1.0.0-beta.22 on, the base wallet manager only
  // disposes its accounts and leaves every signer alone.
  describe('with a base wallet manager that leaves the signers alone', () => {
    let baseDispose

    beforeEach(() => {
      baseDispose = jest.spyOn(WalletManager.prototype, 'dispose').mockImplementation(function () {
        for (const account of Object.values(this._accounts)) {
          account.dispose()
        }

        this._accounts = {}
      })
    })

    afterEach(() => {
      baseDispose.mockRestore()
    })

    test('still erases the root key derived from the seed', () => {
      const dispose = jest.spyOn(wallet._defaultSigner, 'dispose')

      wallet.dispose()

      expect(dispose).toHaveBeenCalledTimes(1)
      expect(wallet._defaultSigner).toBeUndefined()
    })

    test('leaves a signer passed in by the caller to the caller', () => {
      const signer = new SeedSignerEvm(SEED_PHRASE)

      const dispose = jest.spyOn(signer, 'dispose')

      const walletWithSigner = new WalletManagerBermuda(signer, { provider: EIP1193_PROVIDER })

      walletWithSigner.dispose()

      expect(dispose).not.toHaveBeenCalled()

      dispose.mockRestore()
      signer.dispose()
    })
  })
})
