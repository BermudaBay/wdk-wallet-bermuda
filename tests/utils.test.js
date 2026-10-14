import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'

import { ValueError } from '@tetherto/wdk-wallet'

import { chainIdToName, withoutWarnings } from '../src/utils.js'

describe('chainIdToName', () => {
  test.each([
    [31_337, 'testenv'],
    [100n, 'gnosis'],
    [8_453, 'base'],
    [84_532, 'base-sepolia'],
    [9_745, 'plasma-mainnet'],
    [9_746, 'plasma-testnet'],
    [59_144, 'linea']
  ])('maps chain ID %s to %s', (chainId, name) => {
    expect(chainIdToName(chainId)).toBe(name)
  })

  test('rejects an unknown chain ID', () => {
    expect(() => chainIdToName(1)).toThrow(ValueError)
    expect(() => chainIdToName(1)).toThrow('Unknown chain id: 1')
  })

  // The Bermuda SDK dropped its linea-sepolia preset.
  test('no longer maps linea-sepolia', () => {
    expect(() => chainIdToName(59_141)).toThrow('Unknown chain id: 59141')
  })
})

describe('withoutWarnings', () => {
  let warn

  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  const isNoise = ([message]) => message === 'noise'

  test('drops the matching warnings while the function runs, and only those', async () => {
    await withoutWarnings(isNoise, async () => {
      console.warn('noise')
      console.warn('signal', 1)
    })

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('signal', 1)
  })

  test('passes on the warnings it keeps however the console is called', async () => {
    await withoutWarnings(isNoise, async () => {
      const logWarning = console.warn

      logWarning('signal')
    })

    expect(warn).toHaveBeenCalledWith('signal')
  })

  test('resolves to what the function resolves to', async () => {
    await expect(withoutWarnings(isNoise, async () => 42)).resolves.toBe(42)
  })

  test('puts the console back once the function has finished', async () => {
    await withoutWarnings(isNoise, async () => {
      expect(console.warn).not.toBe(warn)
    })

    expect(console.warn).toBe(warn)

    console.warn('noise')

    expect(warn).toHaveBeenCalledWith('noise')
  })

  test('puts the console back when the function rejects', async () => {
    await expect(withoutWarnings(isNoise, async () => {
      throw new Error('failed')
    })).rejects.toThrow('failed')

    expect(console.warn).toBe(warn)
  })

  test('drops the warnings of overlapping calls until each has finished', async () => {
    let finishFirst

    const first = withoutWarnings(isNoise, () => new Promise(resolve => {
      finishFirst = resolve
    }))

    await withoutWarnings(([message]) => message === 'chatter', async () => {
      console.warn('noise')
      console.warn('chatter')
    })

    // The second call has finished, the first has not.
    console.warn('noise')
    console.warn('chatter')

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('chatter')

    finishFirst()

    await first

    expect(console.warn).toBe(warn)
  })

  test('leaves the console alone if it was replaced in the meantime', async () => {
    const replacement = jest.fn()

    await withoutWarnings(isNoise, async () => {
      console.warn = replacement
    })

    expect(console.warn).toBe(replacement)
  })
})
