import http from 'node:http'

// A wallet configured with a URL hands that URL to the Bermuda SDK, which reads
// the chain through its own pool of RPC nodes built on it. Hardhat's
// `network.create()` hands back an in-process EIP-1193 object with no port, so
// the two cannot be connected directly.
//
// This serves any such provider over HTTP JSON-RPC on an ephemeral port, which is
// what the SDK (and any other URL-only consumer) can talk to.

// EDR answers a log query over forked history by forwarding it, whole, to the node
// it forks from, and public nodes cap the span of a query: plasma-testnet's refuses
// the SDK's first sync, from its start block to the head, with HTTP 413. The SDK
// splits a refused range only when the node itself refuses it, which it cannot tell
// from the error EDR relays, so wide log queries are split here instead.
const LOG_SPAN = 5_000

function blockNumberOf (tag) {
  return typeof tag === 'string' && /^0x[0-9a-f]+$/i.test(tag) ? Number.parseInt(tag, 16) : null
}

async function getLogs (provider, filter) {
  const from = blockNumberOf(filter.fromBlock)
  const to = blockNumberOf(filter.toBlock)

  if (from === null || to === null || to - from < LOG_SPAN) {
    return await provider.request({ method: 'eth_getLogs', params: [filter] })
  }

  const logs = []

  for (let start = from; start <= to; start += LOG_SPAN) {
    const end = Math.min(to, start + LOG_SPAN - 1)

    logs.push(...await provider.request({
      method: 'eth_getLogs',
      params: [{ ...filter, fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}` }]
    }))
  }

  return logs
}

function toRpcError (error) {
  // Hardhat/EDR errors carry a numeric `code` when they originate from the node.
  const code = Number.isInteger(error?.code) ? error.code : -32603
  const rpcError = { code, message: error?.message ?? 'Internal error' }

  if (error?.data !== undefined) rpcError.data = error.data

  return rpcError
}

async function handle (provider, request) {
  const { id = null, method, params = [] } = request ?? {}

  try {
    const result = method === 'eth_getLogs'
      ? await getLogs(provider, params[0] ?? {})
      : await provider.request({ method, params })

    // A JSON-RPC result of `undefined` is not serialisable; null is.
    return { jsonrpc: '2.0', id, result: result === undefined ? null : result }
  } catch (error) {
    return { jsonrpc: '2.0', id, error: toRpcError(error) }
  }
}

/**
 * Serves an EIP-1193 provider over HTTP JSON-RPC.
 *
 * @param {{ request: (args: { method: string, params?: unknown[] }) => Promise<unknown> }} provider
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export async function serveRpc (provider) {
  const server = http.createServer((req, res) => {
    const chunks = []

    req.on('data', chunk => chunks.push(chunk))

    req.on('end', async () => {
      let payload

      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' }
        }))
        return
      }

      const body = Array.isArray(payload)
        ? await Promise.all(payload.map(entry => handle(provider, entry)))
        : await handle(provider, payload)

      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    })
  })

  // Keep-alive sockets would otherwise hold the server open past `close()`.
  server.keepAliveTimeout = 0

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

  const { port } = server.address()

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => {
      server.closeAllConnections()
      server.close(resolve)
    })
  }
}
