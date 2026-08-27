import http from 'node:http'

import { JsonRpcProvider, Wallet } from 'ethers'

// The SDK's `relay()` submits a shielded operation to a remote relayer, which
// broadcasts it and returns the resulting transaction hash. Against a fork that
// is useless — the real plasma-testnet relayer would broadcast onto the live
// chain, where the fork-local deposits being spent do not exist.
//
// This is the same protocol, served locally: `POST /relay` taking
// `{ chainId, to, data, value?, authorizationList? }` (bigints as strings, per the
// SDK's JSON replacer) and answering `{ tx }`. It broadcasts from its own funded
// account, exactly as the real relayer does, so the operation is settled by a
// third party rather than by the account under test.

const RELAYER_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

async function broadcast (wallet, call) {
  const transaction = {
    to: call.to,
    data: call.data
  }

  if (call.value !== undefined && call.value !== null) {
    transaction.value = BigInt(call.value)
  }

  if (call.authorizationList !== undefined) {
    transaction.authorizationList = call.authorizationList
  }

  const sent = await wallet.sendTransaction(transaction)

  return sent.hash
}

/**
 * Serves a minimal Bermuda relayer that broadcasts onto the given RPC endpoint.
 *
 * @param {string} rpcUrl - The JSON-RPC endpoint to broadcast through.
 * @returns {Promise<{ url: string, address: string, close: () => Promise<void> }>}
 */
export async function serveRelayer (rpcUrl) {
  const provider = new JsonRpcProvider(rpcUrl)
  const wallet = new Wallet(RELAYER_PRIVATE_KEY, provider)

  const server = http.createServer((req, res) => {
    const chunks = []

    req.on('data', chunk => chunks.push(chunk))

    req.on('end', async () => {
      if (!req.url.endsWith('/relay')) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'not found' }))
        return
      }

      try {
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))

        // The SDK relays either a single call or a batch; a batch settles
        // sequentially and reports the last hash, matching `relay()`'s contract.
        const calls = Array.isArray(payload) ? payload : [payload]

        let tx

        for (const call of calls) {
          tx = await broadcast(wallet, call)
        }

        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ tx }))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: error.shortMessage ?? error.message }))
      }
    })
  })

  server.keepAliveTimeout = 0

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

  const { port } = server.address()

  return {
    url: `http://127.0.0.1:${port}`,
    address: wallet.address,
    close: () => new Promise(resolve => {
      provider.destroy()
      server.closeAllConnections()
      server.close(resolve)
    })
  }
}
