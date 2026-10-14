import { afterAll, describe, expect, test } from '@jest/globals'

import { keccak256 } from 'ethers'

import WalletManagerBermuda from '../index.js'

import {
  BERMUDA_ADDRESSES,
  BERMUDA_SPENDING_KEYS,
  EVM_ADDRESSES,
  PLASMA_TESTNET,
  SEED_PHRASE,
  spendingKeyOf
} from './fixtures/derivation-vectors.js'

describe('derivation vectors', () => {
  const wallet = new WalletManagerBermuda(SEED_PHRASE, { provider: PLASMA_TESTNET })

  afterAll(() => {
    wallet.dispose()
  })

  test.each(EVM_ADDRESSES)('derives the EVM account %i', async (index, address) => {
    const account = await wallet.getAccount(index)

    await expect(account.getAddress()).resolves.toBe(address)
  })

  test.each(BERMUDA_SPENDING_KEYS)('derives the spending key of the Bermuda account %i/%i', async (bip44AccountIndex, bermudaAccountIndex, spendingKey) => {
    const account = await wallet.getBermudaAccount(bip44AccountIndex, bermudaAccountIndex)

    expect(spendingKeyOf(account._bermudaKeyPair)).toBe(spendingKey)
  })

  test.each(BERMUDA_ADDRESSES)('derives the address of the Bermuda account %i/%i', async (bip44AccountIndex, bermudaAccountIndex, ownerCommitment, addressHash) => {
    const account = await wallet.getBermudaAccount(bip44AccountIndex, bermudaAccountIndex)

    const address = account.getAddress()

    expect(address).toMatch(/^0x[0-9a-f]{2496}$/)
    expect(address.slice(0, ownerCommitment.length)).toBe(ownerCommitment)
    expect(keccak256(address)).toBe(addressHash)
  })
})
