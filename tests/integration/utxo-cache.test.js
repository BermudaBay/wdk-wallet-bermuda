import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals'

import WalletManagerBermuda from '../../index.js'

import { startFork } from './helpers/fork.js'

// `utxoCache` asks the SDK to persist its UTXO and commitment-event state across
// sessions, and the manager derives a second path for the commitment events when
// none is given. The unit suite can only prove those values are handed to the SDK;
// what matters to a caller is that the files are actually written, at the paths
// they asked for.
//
// The manager forwards only the cache options to the SDK — not a provider — so the
// SDK reads plasma-testnet through its own configured endpoint here rather than
// through the fork. That is what a caller configuring `utxoCache` really gets.

const SEED_PHRASE = 'cook voyage document eight skate token alien guide drink uncle term abuse'

const SCAN_TIMEOUT = 240_000

describe('utxo cache persistence', () => {
  let fork, directory

  beforeAll(async () => {
    fork = await startFork()
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wdk-wallet-bermuda-'))
  }, SCAN_TIMEOUT)

  afterAll(async () => {
    await fork?.close()

    if (directory) fs.rmSync(directory, { recursive: true, force: true })
  })

  async function readBalanceWith (config) {
    const wallet = new WalletManagerBermuda(SEED_PHRASE, {
      provider: fork.url,
      fs,
      ...config
    })

    try {
      const account = await wallet.getBermudaAccount()

      await account.getTokenBalance(account._bermuda.config.WXPL)

      return account
    } finally {
      wallet.dispose()
    }
  }

  test('writes both caches, deriving the commitment events path', async () => {
    const utxoCache = path.join(directory, 'derived.json')
    const derived = path.join(directory, 'derived-commitment-events.json')

    const account = await readBalanceWith({ utxoCache })

    expect(account._bermuda.config.utxoCache).toBe(utxoCache)
    expect(account._bermuda.config.commitmentEventsCache).toBe(derived)

    // Both files exist and hold state, so a later session can resume from them.
    expect(fs.existsSync(utxoCache)).toBe(true)
    expect(fs.existsSync(derived)).toBe(true)
    expect(fs.statSync(derived).size).toBeGreaterThan(0)

    expect(() => JSON.parse(fs.readFileSync(utxoCache, 'utf8'))).not.toThrow()
    expect(() => JSON.parse(fs.readFileSync(derived, 'utf8'))).not.toThrow()
  }, SCAN_TIMEOUT)

  test('honours an explicit commitment events cache path', async () => {
    const utxoCache = path.join(directory, 'explicit.json')
    const commitmentEventsCache = path.join(directory, 'events-elsewhere.json')

    const account = await readBalanceWith({ utxoCache, commitmentEventsCache })

    expect(account._bermuda.config.commitmentEventsCache).toBe(commitmentEventsCache)

    expect(fs.existsSync(commitmentEventsCache)).toBe(true)

    // The derived path is not used when an explicit one is given.
    expect(fs.existsSync(path.join(directory, 'explicit-commitment-events.json'))).toBe(false)
  }, SCAN_TIMEOUT)
})
