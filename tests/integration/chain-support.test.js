import { network } from 'hardhat'

import { afterAll, describe, expect, jest, test } from '@jest/globals'

import WalletManagerBermuda, { WalletAccountBermuda } from '../../index.js'

// `getBermudaAccount` resolves the chain by asking the provider for its id and
// mapping it through `chainIdToName`. That mapping is only reachable through a
// real provider, so each case here runs against a node actually reporting that
// chain id rather than a stubbed `getNetwork`.
//
// None of this touches the network: the SDK builds its provider lazily and
// derives the account from the seed alone, so no node beyond the local one is
// contacted.

const SEED_PHRASE = 'cook voyage document eight skate token alien guide drink uncle term abuse'

const BERMUDA_ADDRESS = /^0x[0-9a-f]{448}$/

// Chain ids `chainIdToName` maps AND the installed SDK ships a config for.
const SUPPORTED = [
  [31_337, 'testenv'],
  [100, 'gnosis'],
  [84_532, 'base-sepolia'],
  [9_746, 'plasma-testnet'],
  [59_141, 'linea-sepolia']
]

// Chain ids `chainIdToName` maps but the installed SDK has NO config for. The
// mapping succeeds and the SDK then fails deep inside `getConfig`, so the caller
// sees an opaque 'no provider configured' rather than an unsupported-chain error.
// Pinned to document the mismatch, not to endorse it.
const MAPPED_BUT_UNCONFIGURED = [
  [8_453, 'base'],
  [9_745, 'plasma-mainnet'],
  [59_144, 'linea']
]

const connections = []

async function walletOn (chainId) {
  const hre = await network.create({
    network: 'hardhat',
    chainType: 'l1',
    override: { type: 'edr-simulated', chainId }
  })

  connections.push(hre)

  return new WalletManagerBermuda(SEED_PHRASE, { provider: hre.provider })
}

afterAll(() => {
  for (const hre of connections) hre.provider.close?.()
})

describe('chain resolution through getBermudaAccount', () => {
  test.each(SUPPORTED)('derives an account on chain %s (%s)', async (chainId, name) => {
    const wallet = await walletOn(chainId)

    const account = await wallet.getBermudaAccount()

    expect(account).toBeInstanceOf(WalletAccountBermuda)
    expect(account.address).toMatch(BERMUDA_ADDRESS)

    // The manager picked the chain config off the provider's reported id, so the
    // SDK it built is pointed at that chain and no other.
    expect(account._bermuda.config.chainId).toBe(BigInt(chainId))

    wallet.dispose()
  })

  test.each(MAPPED_BUT_UNCONFIGURED)(
    'maps chain %s (%s) but the SDK ships no config for it',
    async chainId => {
      const wallet = await walletOn(chainId)

      // The SDK warns on its way through the unrecognised-chain branch. Asserting
      // it keeps that observable behaviour pinned and keeps the expected noise out
      // of the reporter — a `sdk.config` warning from anywhere else still shows up.
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

      try {
        await expect(wallet.getBermudaAccount()).rejects.toThrow('no provider configured')

        expect(warn).toHaveBeenCalledWith('sdk.config', {})
      } finally {
        warn.mockRestore()
        wallet.dispose()
      }
    }
  )

  test('rejects a chain id the package does not map', async () => {
    const wallet = await walletOn(1)

    await expect(wallet.getBermudaAccount()).rejects.toThrow('Unknown chain id')

    wallet.dispose()
  })

  test('derives distinct sub accounts on the same chain', async () => {
    const wallet = await walletOn(9_746)

    const first = await wallet.getBermudaAccount(0, 0)
    const second = await wallet.getBermudaAccount(0, 1)

    expect(first.address).toMatch(BERMUDA_ADDRESS)
    expect(second.address).toMatch(BERMUDA_ADDRESS)
    expect(first.address).not.toBe(second.address)

    wallet.dispose()
  })

  test('derives distinct accounts from different ethereum indices', async () => {
    const wallet = await walletOn(9_746)

    const first = await wallet.getBermudaAccount(0, 0)
    const second = await wallet.getBermudaAccount(1, 0)

    expect(first.address).not.toBe(second.address)

    wallet.dispose()
  })
})
