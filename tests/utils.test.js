import { describe, expect, test } from '@jest/globals'

import { chainIdToName } from '../src/utils.js'

describe('chainIdToName', () => {
  test.each([
    [31_337, 'testenv'],
    [100n, 'gnosis'],
    [8_453, 'base'],
    [84_532, 'base-sepolia'],
    [9_745, 'plasma-mainnet'],
    [9_746, 'plasma-testnet'],
    [59_144, 'linea'],
    [59_141, 'linea-sepolia']
  ])('maps chain ID %s to %s', (chainId, name) => {
    expect(chainIdToName(chainId)).toBe(name)
  })

  test('rejects an unknown chain ID', () => {
    expect(() => chainIdToName(1)).toThrow('Unknown chain id')
  })
})
