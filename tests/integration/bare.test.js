import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import initBermudaSdk from '@bermuda/sdk'

import { JsonRpcProvider, parseEther } from 'ethers'

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals'

import WalletManagerBermuda from '../../index.js'

import { linkPackageIntoNodeModules } from '../bare/link.js'

import { serveRelayer } from './helpers/relayer.js'

import { fundWrappedNative, setBalance, startFork, tokenBalanceOf } from './helpers/fork.js'

// The shielded operations of wallet-account-bermuda.test.js, performed by Bare
// instead of Node.js: tests/bare/e2e.js deposits, transfers and withdraws with
// real proofs from a Bare process, against a plasma-testnet fork that this test
// hosts - Hardhat only runs on Node.js - and then checks against the chain.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const BARE = path.join(ROOT, 'node_modules', '.bin', 'bare')

// Must match COMPLETION_MARKER in tests/bare/e2e.js.
const COMPLETION_MARKER = 'e2e: done'

// See CRS_PATH in tests/bare/run.js.
const CRS_PATH = process.env.CRS_PATH ?? path.join(ROOT, 'node_modules', '.cache', 'bb-crs')

const SEED_PHRASE = 'cook voyage document eight skate token alien guide drink uncle term abuse'

// Under Bare, proofs come from bb.js's WebAssembly backend, on one thread: much
// slower than the native backend Node.js uses.
const E2E_TIMEOUT = 1_800_000

describe('Bermuda operations under Bare', () => {
  let fork,
    relayer,
    provider,
    wxpl,
    recipient,
    results,
    output

  beforeAll(async () => {
    await linkPackageIntoNodeModules(ROOT)

    fork = await startFork()

    relayer = await serveRelayer(fork.url)

    await setBalance(fork.hre.provider, relayer.address)

    provider = new JsonRpcProvider(fork.url)

    wxpl = initBermudaSdk('plasma-testnet').config.WXPL

    const wallet = new WalletManagerBermuda(SEED_PHRASE, { provider: fork.url })

    const ethereumAddress = await (await wallet.getAccountByPath("0'/0/0")).getAddress()

    recipient = await (await wallet.getAccount(5)).getAddress()

    wallet.dispose()

    // Funded by a faucet, so that the transactions the Bare process signs are
    // the account's first; see helpers/fork.js.
    await setBalance(fork.hre.provider, ethereumAddress)

    await fundWrappedNative(fork.hre.provider, fork.url, wxpl, ethereumAddress, parseEther('10'))

    const run = await runBare({
      rpcUrl: fork.url,
      relayerUrl: relayer.url,
      seedPhrase: SEED_PHRASE,
      recipient
    })

    results = run.results
    output = run.output
  }, E2E_TIMEOUT)

  afterAll(async () => {
    provider?.destroy()
    await relayer?.close()
    await fork?.close()
  })

  test('shields the wrapped native token', async () => {
    const { hash, shielded } = results.deposit

    const receipt = await provider.getTransactionReceipt(hash)

    expect(receipt.status).toBe(1)

    expect(shielded).toBe('5000')
  })

  test('transfers shielded funds through the relayer', async () => {
    const { hash, sender, recipient } = results.transfer

    const receipt = await provider.getTransactionReceipt(hash)

    expect(receipt.status).toBe(1)

    expect(receipt.from).toBe(relayer.address)

    expect(sender).toBe('4000')

    expect(recipient).toBe('1000')
  })

  test('unshields to an Ethereum address', async () => {
    const { hash, shielded } = results.withdraw

    const receipt = await provider.getTransactionReceipt(hash)

    expect(receipt.status).toBe(1)

    expect(receipt.from).toBe(relayer.address)

    expect(await tokenBalanceOf(fork.url, wxpl, recipient)).toBe(250n)

    expect(shielded).toBe('3750')
  })

  // The SDK warns that it cannot permit WXPL before falling back to the
  // allowance, which the account approves right after: an expected warning,
  // kept off the console.
  test('keeps the SDK\'s warning that it cannot permit WXPL off the console', () => {
    expect(output).not.toContain('EIP-2612 permit unavailable')
  })
})

// Runs tests/bare/e2e.js under Bare and collects the result it reports for
// each operation, and all it printed.
function runBare (options) {
  return new Promise((resolve, reject) => {
    const child = spawn(BARE, ['tests/bare/e2e.js', JSON.stringify(options)], {
      cwd: ROOT,
      env: { ...process.env, CRS_PATH },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let output = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })

    child.once('error', reject)

    child.once('close', (code) => {
      const lines = output.trim().split('\n')

      // Bare exits with code 0 once its event loop runs dry, finished or not.
      if (code !== 0 || lines.at(-1) !== COMPLETION_MARKER) {
        reject(new Error(`The Bare process did not complete (exit code ${code}):\n${output}`))

        return
      }

      const results = {}

      for (const line of lines.filter(line => line.startsWith('result '))) {
        const { operation, ...result } = JSON.parse(line.slice('result '.length))

        results[operation] = result
      }

      resolve({ results, output })
    })
  })
}
