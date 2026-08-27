import * as ethers from 'ethers'

import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'

// The sibling suite drives the manager through a real Hardhat node and the
// real Bermuda SDK. The `utxoCache` overrides cannot be exercised that way:
// `initBermudaSdk` has to be observable, and a real SDK handed a cache path
// would touch the filesystem. Mocks must be installed before the module under
// test is loaded, hence the separate file.

let bermudaSdk

const initBermudaSdk = jest.fn(() => bermudaSdk)

jest.unstable_mockModule('@bermuda/sdk', () => ({
  default: initBermudaSdk
}))

let provider

const BrowserProvider = jest.fn(() => provider)

jest.unstable_mockModule('ethers', () => ({
  ...ethers,
  BrowserProvider
}))

const { default: WalletManagerBermuda } = await import('../src/wallet-manager-bermuda.js')
const { default: WalletAccountBermuda } = await import('../src/wallet-account-bermuda.js')

const SEED_PHRASE = 'cook voyage document eight skate token alien guide drink uncle term abuse'
const UTXO_CACHE = '/tmp/bermuda/utxos.json'
const EIP1193_PROVIDER = { request: jest.fn() }

describe('WalletManagerBermuda sdk overrides', () => {
  let bermudaKeyPair, fs

  beforeEach(() => {
    jest.clearAllMocks()

    provider = {
      getNetwork: jest.fn(async () => ({ chainId: 31337n }))
    }

    bermudaKeyPair = { address: jest.fn(() => '0xbermuda') }

    bermudaSdk = {
      account: jest.fn(async () => bermudaKeyPair)
    }

    fs = { readFileSync: jest.fn(), writeFileSync: jest.fn() }
  })

  function createWallet (config = {}) {
    return new WalletManagerBermuda(SEED_PHRASE, {
      provider: EIP1193_PROVIDER,
      ...config
    })
  }

  test('passes no overrides to the sdk when no utxo cache is configured', async () => {
    const wallet = createWallet({ fs })

    const account = await wallet.getBermudaAccount(0, 0)

    expect(account).toBeInstanceOf(WalletAccountBermuda)

    expect(initBermudaSdk).toHaveBeenCalledWith('testenv', {})

    wallet.dispose()
  })

  test('derives the commitment events cache from the utxo cache', async () => {
    const wallet = createWallet({ utxoCache: UTXO_CACHE, fs })

    await wallet.getBermudaAccount(0, 0)

    expect(initBermudaSdk).toHaveBeenCalledWith('testenv', {
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

  test('rejects a negative bermuda account index', async () => {
    const wallet = createWallet()

    await expect(wallet.getBermudaAccount(0, -1))
      .rejects.toThrow('Account index must not be negative')

    expect(initBermudaSdk).not.toHaveBeenCalled()

    wallet.dispose()
  })

  test('rejects when the wallet has no provider', async () => {
    const wallet = new WalletManagerBermuda(SEED_PHRASE)

    await expect(wallet.getBermudaAccount()).rejects.toThrow('Missing provider')

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

    await expect(wallet.getFeeRates())
      .rejects.toThrow('The wallet must be connected to a provider to get fee rates.')

    wallet.dispose()
  })
})
