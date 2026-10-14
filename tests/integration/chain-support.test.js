import { network } from 'hardhat'

import { afterAll, describe, expect, jest, test } from '@jest/globals'

import { ValueError } from '@tetherto/wdk-wallet'

import WalletManagerBermuda, { WalletAccountBermuda } from '../../index.js'

// `getBermudaAccount` resolves the chain by asking the provider for its id and
// mapping it through `chainIdToName`. That mapping is only reachable through a
// real provider, so each case here runs against a node actually reporting that
// chain id rather than a stubbed `getNetwork`.
//
// None of this touches the network: the SDK reads the chain through the local
// node it is handed and derives the account from the seed alone, so no node
// beyond the local one is contacted.

const SEED_PHRASE = 'cook voyage document eight skate token alien guide drink uncle term abuse'

const BERMUDA_ADDRESS = /^0x[0-9a-f]{2496}$/

// Chain ids `chainIdToName` maps AND the installed SDK ships a config for.
const SUPPORTED = [
  [31_337, 'testenv'],
  [100, 'gnosis'],
  [84_532, 'base-sepolia'],
  [9_746, 'plasma-testnet']
]

// Chain ids `chainIdToName` maps but the installed SDK has NO config for. The
// mapping succeeds, and the SDK builds a configuration from the options it is
// handed alone, with no pool: the manager rejects that, rather than hand out an
// account that would only fail once used.
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
    'maps chain %s (%s) but rejects it, as the SDK ships no config for it',
    async (chainId, name) => {
      const wallet = await walletOn(chainId)

      // The SDK warns on its way through the unrecognised-chain branch. Asserting
      // it keeps that observable behaviour pinned and keeps the expected noise out
      // of the reporter — a `sdk.config` warning from anywhere else still shows up.
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

      try {
        const error = await wallet.getBermudaAccount().catch(error => error)

        expect(error).toBeInstanceOf(ValueError)
        expect(error.message).toBe(`The Bermuda SDK has no deployment on chain ${name} (chain id ${chainId}).`)

        expect(warn).toHaveBeenCalledWith('sdk.config', expect.objectContaining({ provider: wallet._provider }))
      } finally {
        warn.mockRestore()
        wallet.dispose()
      }
    }
  )

  // linea-sepolia (59141) was mapped until the SDK dropped its config.
  test.each([1, 59_141])('rejects the chain id %s, which the package does not map', async chainId => {
    const wallet = await walletOn(chainId)

    const error = await wallet.getBermudaAccount().catch(error => error)

    expect(error).toBeInstanceOf(ValueError)
    expect(error.message).toBe(`Unknown chain id: ${chainId}`)

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
