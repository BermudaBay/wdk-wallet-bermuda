import { network } from 'hardhat'

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'

import { BrowserProvider, JsonRpcProvider } from 'ethers'

import { WalletAccountEvm } from '@tetherto/wdk-wallet-evm'
import WalletManagerBermuda, { WalletAccountBermuda } from '../index.js'

const hre = await network.create()

const SEED_PHRASE = 'cook voyage document eight skate token alien guide drink uncle term abuse'

describe('WalletManagerBermuda', () => {
  let wallet

  beforeEach(async () => {
    wallet = new WalletManagerBermuda(SEED_PHRASE, {
      provider: hre.provider
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
    wallet.dispose()
  })

  describe('constructor', () => {
    test('should wrap a provider url in a JsonRpcProvider', () => {
      const wallet = new WalletManagerBermuda(SEED_PHRASE, {
        provider: 'http://127.0.0.1:8545'
      })

      expect(wallet._provider).toBeInstanceOf(JsonRpcProvider)

      wallet._provider.destroy()
      wallet.dispose()
    })

    test('should wrap an eip-1193 provider in a BrowserProvider', () => {
      expect(wallet._provider).toBeInstanceOf(BrowserProvider)
    })

    test('should leave the provider unset when none is configured', () => {
      const wallet = new WalletManagerBermuda(SEED_PHRASE)

      expect(wallet._provider).toBeUndefined()

      wallet.dispose()
    })
  })

  describe('getBermudaAccount', () => {
    test('should return an associated Bermuda account', async () => {
      const bip44AccountIndex = 0
      const bermudaAccountIndex = 0
      const account = await wallet.getBermudaAccount(bip44AccountIndex, bermudaAccountIndex)

      expect(account).toBeInstanceOf(WalletAccountBermuda)

      expect(account.address).toMatch(/^0x[0-9a-f]{448}$/)
    })

    test('should return another Bermuda sub account', async () => {
      const account00 = await wallet.getBermudaAccount(0, 0)
      const account01 = await wallet.getBermudaAccount(0, 1)

      expect(account00.address).toMatch(/^0x[0-9a-f]{448}$/)
      expect(account01.address).toMatch(/^0x[0-9a-f]{448}$/)
      expect(account00.address).not.toEqual(account01.address)
    })

    test('should default both indices and throw if there is no provider', async () => {
      const wallet = new WalletManagerBermuda(SEED_PHRASE)

      await expect(wallet.getBermudaAccount())
        .rejects.toThrow('Missing provider')

      wallet.dispose()
    })

    test('should throw if the Bermuda account index is a negative number', async () => {
      await expect(wallet.getBermudaAccount(0, -1))
        .rejects.toThrow()
    })

    test('should throw if the Ethereum account index is a negative number', async () => {
      await expect(wallet.getBermudaAccount(-1, 0))
        .rejects.toThrow()
    })
  })

  describe('getAccount', () => {
    test('should return the account at index 0 by default', async () => {
      const account = await wallet.getAccount()

      expect(account).toBeInstanceOf(WalletAccountEvm)

      expect(account.path).toBe("m/44'/60'/0'/0/0")
    })

    test('should return the account at the given index', async () => {
      const account = await wallet.getAccount(3)

      expect(account).toBeInstanceOf(WalletAccountEvm)

      expect(account.path).toBe("m/44'/60'/0'/0/3")
    })

    test('should throw if the index is a negative number', async () => {
      await expect(wallet.getAccount(-1))
        .rejects.toThrow('invalid path component')
    })
  })

  describe('getAccountByPath', () => {
    test('should return the account with the given path', async () => {
      const account = await wallet.getAccountByPath("1'/2/3")

      expect(account).toBeInstanceOf(WalletAccountEvm)

      expect(account.path).toBe("m/44'/60'/1'/2/3")
    })

    test('should throw if the path is invalid', async () => {
      await expect(wallet.getAccountByPath("a'/b/c"))
        .rejects.toThrow('invalid path component')
    })
  })

  describe('getFeeRates', () => {
    test('should return the correct fee rates', async () => {
      const feeRates = await wallet.getFeeRates()

      expect(feeRates.normal).toBe(3_300_000_000n)

      expect(feeRates.fast).toBe(6_000_000_000n)
    })

    test('should fall back to the gas price on a chain without eip-1559', async () => {
      jest.spyOn(wallet._provider, 'getFeeData').mockResolvedValue({
        maxFeePerGas: null,
        gasPrice: 2_000_000_000n
      })

      const feeRates = await wallet.getFeeRates()

      expect(feeRates.normal).toBe(2_200_000_000n)

      expect(feeRates.fast).toBe(4_000_000_000n)
    })

    // Pins current behaviour rather than endorsing it: with no fee data at all
    // the multiplication throws a raw TypeError instead of a domain error.
    // See follow-up F1 in test_plan.md.
    test('should throw a TypeError if the provider reports no fee data', async () => {
      jest.spyOn(wallet._provider, 'getFeeData').mockResolvedValue({
        maxFeePerGas: null,
        gasPrice: null
      })

      await expect(wallet.getFeeRates())
        .rejects.toThrow(TypeError)
    })

    test('should throw if the wallet is not connected to a provider', async () => {
      const wallet = new WalletManagerBermuda(SEED_PHRASE)

      await expect(wallet.getFeeRates())
        .rejects.toThrow('The wallet must be connected to a provider to get fee rates.')
    })
  })
})
