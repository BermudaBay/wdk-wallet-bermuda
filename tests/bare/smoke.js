// Smoke test of the package entry point. `npm run test:bare` (tests/bare/run.js)
// runs it under Node.js and under Bare, both in the checkout and in a project
// that installed the packed tarball:
//
//   node tests/bare/smoke.js
//   bare tests/bare/smoke.js
//
// The package is imported by its own name, so each runtime resolves it through
// package.json's "exports" the way a consumer would: Node.js gets index.js and
// Bare gets bare.js. The test checks the exports and derives the pinned EVM and
// Bermuda vectors offline. Under Bare, it also exercises the shims in bare/ and
// starts the zero-knowledge prover (skipped with BARE_SMOKE_PROVER=0).
//
// Bare exits with code 0 as soon as its event loop runs dry, even with promises
// still pending, so a clean exit proves nothing on its own: the runner only
// accepts a run whose last line is the completion marker printed at the end.

import WalletManagerBermuda, {
  WalletAccountBermuda,
  WalletAccountEvm,
  WalletAccountReadOnlyEvm,
  WalletManagerBermuda as NamedWalletManagerBermuda
} from '@bermuda/wdk-wallet-evm-bermuda'

import {
  BERMUDA_ADDRESSES,
  BERMUDA_SPENDING_KEYS,
  EVM_ADDRESSES,
  PLASMA_TESTNET,
  SEED_PHRASE,
  spendingKeyOf
} from '../fixtures/derivation-vectors.js'

// Must match COMPLETION_MARKER in tests/bare/run.js.
const COMPLETION_MARKER = 'smoke test: done'

const RUNTIME = typeof Bare === 'undefined' ? 'node' : 'bare'

// poseidon2(4, 8), as computed by the prover's native backend under Node.js.
const POSEIDON2_OF_4_AND_8 = '2bcaeb6d58bb38baf753d58c3c96618fea82163345295eb40e88344eeb0ce2a1'

// How long the RPC node in checkSlowRpc takes to answer: longer than the 5
// seconds bare-http1's global agent used to allow a request.
const SLOW_RPC_MS = 5_500

check(typeof WalletManagerBermuda === 'function' && WalletManagerBermuda === NamedWalletManagerBermuda,
  'exports WalletManagerBermuda as the default and as a named export')

check(typeof WalletAccountBermuda === 'function', 'exports WalletAccountBermuda')

check(typeof WalletAccountEvm === 'function' && typeof WalletAccountReadOnlyEvm === 'function',
  'exports WalletAccountEvm and WalletAccountReadOnlyEvm')

const wallet = new WalletManagerBermuda(SEED_PHRASE, { provider: PLASMA_TESTNET })

for (const [index, address] of EVM_ADDRESSES) {
  const account = await wallet.getAccount(index)

  check(await account.getAddress() === address, `derives the EVM account ${index}`)
}

for (const [bip44AccountIndex, bermudaAccountIndex, spendingKey] of BERMUDA_SPENDING_KEYS) {
  const account = await wallet.getBermudaAccount(bip44AccountIndex, bermudaAccountIndex)

  check(account instanceof WalletAccountBermuda && spendingKeyOf(account._bermudaKeyPair) === spendingKey,
    `derives the spending key of the Bermuda account ${bip44AccountIndex}/${bermudaAccountIndex}`)
}

// Resolved at runtime, like @aztec/bb.js in checkProver: imported by its literal
// specifier, ethers would be preloaded ahead of the package, without its import
// map, while by now the SDK has loaded it with one.
const { keccak256 } = await import(['eth', 'ers'].join(''))

for (const [bip44AccountIndex, bermudaAccountIndex, ownerCommitment, addressHash] of BERMUDA_ADDRESSES) {
  const address = (await wallet.getBermudaAccount(bip44AccountIndex, bermudaAccountIndex)).getAddress()

  check(address.startsWith(ownerCommitment) && keccak256(address) === addressHash,
    `derives the address of the Bermuda account ${bip44AccountIndex}/${bermudaAccountIndex}`)
}

wallet.dispose()

check(wallet.disposed, 'disposes the wallet')

if (RUNTIME === 'bare') {
  await checkGlobals()

  await checkSlowRpc()

  await checkStreamPromises()

  await checkWorkerThreads()

  if (process.env.BARE_SMOKE_PROVER !== '0') {
    await checkProver()
  }
}

console.log(COMPLETION_MARKER)

function check (condition, description) {
  if (!condition) {
    throw new Error(`[${RUNTIME}] not ok - ${description}`)
  }

  console.log(`[${RUNTIME}] ok - ${description}`)
}

// bare/globals.js. `process` and `TextDecoder` are only globals under Bare
// because importing the package loaded bare-node-runtime/global first.
async function checkGlobals () {
  const decoder = new TextDecoder('ascii')

  check(decoder.encoding === 'windows-1252', "TextDecoder treats 'ascii' as windows-1252")

  check(decoder.decode(Uint8Array.of(0x42, 0x80, 0x99, 0xe9)) === 'B€™é',
    'TextDecoder decodes windows-1252')

  check(new TextDecoder().decode(Uint8Array.of(0xe2, 0x82, 0xac)) === '€',
    "TextDecoder leaves UTF-8 to Bare's own decoder")
}

// bare/globals.js again: a wallet waits for a slow RPC node. The node runs in
// this very process, and answers the chain id at once and every other call
// after SLOW_RPC_MS.
async function checkSlowRpc () {
  const { default: http } = await import('bare-http1')

  const server = http.createServer((req, res) => {
    const chunks = []

    req.on('data', (chunk) => chunks.push(chunk))

    req.on('end', () => {
      const payload = JSON.parse(Buffer.concat(chunks).toString())

      const calls = Array.isArray(payload) ? payload : [payload]

      const answers = calls.map(({ id, method }) => ({ jsonrpc: '2.0', id, result: method === 'eth_chainId' ? '0x2612' : '0x0' }))

      setTimeout(() => {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(Array.isArray(payload) ? answers : answers[0]))
      }, calls.some(({ method }) => method !== 'eth_chainId') ? SLOW_RPC_MS : 0)
    })
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  const wallet = new WalletManagerBermuda(SEED_PHRASE, { provider: `http://127.0.0.1:${server.address().port}` })

  try {
    const account = await wallet.getAccount(0)

    check(await account.getBalance() === 0n, 'a wallet waits for an RPC node that answers after more than 5 seconds')
  } finally {
    wallet.dispose()

    server.close()
  }
}

// bare/stream-promises.js, imported through its export: 'stream/promises'
// itself is only remapped inside the package's own module graph.
async function checkStreamPromises () {
  const { finished, pipeline } = await import('@bermuda/wdk-wallet-evm-bermuda/bare/stream-promises')

  const { Readable } = await import('bare-stream')

  check(typeof pipeline === 'function', "stream/promises still exports bare-stream's pipeline")

  const ended = new Readable({ read () { this.push(null) } })

  ended.resume()

  await finished(ended)

  check(ended.destroyed, 'stream/promises finished resolves once a stream has closed')

  const failure = new Error('stream failure')

  const failed = new Readable({ read () {} })

  failed.destroy(failure)

  check(await finished(failed).then(() => undefined, (error) => error) === failure,
    'stream/promises finished rejects with the error the stream failed with')
}

// bare/worker-threads.js, imported through its export like the shim above.
async function checkWorkerThreads () {
  const { threadId, isMainThread, Worker } = await import('@bermuda/wdk-wallet-evm-bermuda/bare/worker-threads')

  check(threadId === 0 && isMainThread === true, 'worker_threads exports threadId 0 on the main thread')

  check(typeof Worker === 'function', "worker_threads still exports bare-worker's Worker")
}

async function checkProver () {
  if (!process.env.CRS_PATH) {
    throw new Error('Set CRS_PATH, or BARE_SMOKE_PROVER=0: the prover would otherwise download its CRS into ~/.bb-crs.')
  }

  // Resolved at runtime on purpose. Bare preloads literal specifiers, so this
  // module - which has no import map - would load @aztec/bb.js ahead of the
  // package, and because Bare caches modules per URL, the SDK would then get
  // that copy without the shims.
  const { Barretenberg } = await import(['@aztec', 'bb.js'].join('/'))

  const bb = await Barretenberg.new({ threads: 1 })

  try {
    const { hash } = await bb.poseidon2Hash({ inputs: [field(4), field(8)] })

    check(toHex(hash) === POSEIDON2_OF_4_AND_8, 'the prover starts and computes a Poseidon2 hash')
  } finally {
    await bb.destroy()
  }
}

function field (value) {
  const bytes = new Uint8Array(32)

  bytes[31] = value

  return bytes
}

function toHex (bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
