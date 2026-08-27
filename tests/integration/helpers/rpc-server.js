import http from 'node:http'

// The Bermuda SDK's `getConfig` only accepts a provider given as a URL string —
// it constructs its own `JsonRpcProvider` and throws otherwise. Hardhat's
// `network.create()` hands back an in-process EIP-1193 object with no port, so
// the two cannot be connected directly.
//
// This serves any such provider over HTTP JSON-RPC on an ephemeral port, which is
// what the SDK (and any other URL-only consumer) can talk to.

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
    const result = await provider.request({ method, params })

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
