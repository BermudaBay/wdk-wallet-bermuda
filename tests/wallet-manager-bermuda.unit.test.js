import * as ethers from 'ethers'

import { beforeEach, describe, expect, jest, test } from '@jest/globals'

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
