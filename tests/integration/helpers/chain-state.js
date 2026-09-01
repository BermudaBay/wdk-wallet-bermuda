import http from 'node:http'

import initBermudaSdk from '@bermuda/sdk'

import { Contract, JsonRpcProvider } from 'ethers'

import { FORK_BLOCK_NUMBER } from './fork.js'

// The SDK bootstraps its commitment-event cache from a hosted chain-state
// snapshot, `<chainState>/chain-state/refs/heads/main/<chainId>/<pool>/commitment-events.json`,
// and stamps the cache with the block that snapshot was taken at. Every later
// `NewCommitment` scan — `findUtxos`, `buildMerkleForest` — then resumes from that
// block rather than from `config.startBlock`:
//
//     from = cached.block !== 0n ? cached.block : config.startBlock
//     queryFilterBatched(from, await provider.getBlockNumber(), pool, filter)
//
// The hosted snapshot tracks the live plasma-testnet head, which is why it cannot
// be used from a fork. Within hours of any pinned fork block the snapshot is
// *ahead* of it, the scan runs with `fromBlock > toBlock`, matches nothing, and
// the commitments the deposits under test just created are never observed: every
// shielded balance reads 0 and transfer/withdraw fail with "Insufficient UTXO
// balance". Bumping the pin only buys a few more hours, so the fork is given its
// own snapshot instead.
//
// The events are the hosted ones — they are the pool's real history and cannot be
// rebuilt cheaply; scanning them off the chain means ~1.2M blocks in the 1000-block
// batches `queryFilterBatched` uses. What changes is the block they are stamped
// with (the fork block, so the scan covers exactly the fork-local range) and that
// they are truncated to the leaves the forked pool actually holds. Truncating
// matters: a commitment made on the live chain after the fork point would
// otherwise be inserted into the local Merkle tree, and its root would no longer
// match the one the forked pool verifies proofs against.

/**
 * Fetches the hosted chain-state commitment-event snapshot.
 *
 * The path is the one the SDK's cache asks for, and the base url comes from the
 * installed SDK's own config rather than a copy pinned here, so an SDK upgrade
 * carries the endpoint with it.
 *
 * @param {string} base - The chain-state service base url.
 * @param {bigint} chainId - The chain id.
 * @param {string} pool - The lower-cased pool address.
 * @returns {Promise<{ block: number, events: Object[] }>} The hosted snapshot.
 */
async function fetchHostedSnapshot (base, chainId, pool) {
  const url = `${base.replace(/\/+$/, '')}/chain-state/refs/heads/main/${chainId}/${pool}/commitment-events.json`

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`chain-state: ${response.status} ${response.statusText} for ${url}`)
  }

  return response.json()
}

/**
 * Truncates a snapshot's events to the leaves the forked pool holds.
 *
 * The leaf count is read at the fork's current head rather than at the fork block:
 * EDR has no hardfork activation history for chain 9746 and refuses to execute
 * against a block at or below the fork point. The two are the same value only
 * while nothing has deposited yet, which is why this runs during setup.
 *
 * @param {string} rpcUrl - The JSON-RPC endpoint serving the fork.
 * @param {string} pool - The pool address.
 * @param {Array} abi - The pool ABI.
 * @param {Object[]} events - The hosted snapshot's events.
 * @returns {Promise<Object[]>} The events, ordered by leaf index.
 */
async function truncateToPoolLeaves (rpcUrl, pool, abi, events) {
  const provider = new JsonRpcProvider(rpcUrl)

  try {
    const contract = new Contract(pool, abi, provider)

    const [leaves, treeNumber] = await Promise.all([contract.nextIndex(), contract.treeNumber()])

    // The snapshot carries no tree number and the SDK reads every event as tree 0.
    // A pool that had rolled over to a second tree would need a snapshot shape this
    // helper does not produce, so say so rather than serving a half-tree.
    if (BigInt(treeNumber) !== 0n) {
      throw new Error(`chain-state: pool is on tree ${treeNumber}, the snapshot format assumes tree 0`)
    }

    const kept = events
      .filter(event => BigInt(event.index) < BigInt(leaves))
      .sort((a, b) => Number(BigInt(a.index) - BigInt(b.index)))

    if (BigInt(kept.length) !== BigInt(leaves)) {
      throw new Error(
        `chain-state: the forked pool holds ${leaves} leaves but the hosted snapshot covers only ` +
        `${kept.length} of them. The snapshot is behind the fork block; lower FORK_BLOCK_NUMBER.`
      )
    }

    return kept
  } finally {
    provider.destroy()
  }
}

/**
 * Serves a fork-consistent copy of the Bermuda chain-state snapshot.
 *
 * Pass the returned url as the SDK's `chainState` so its commitment-event cache
 * bootstraps from this instead of from the hosted service. Must be called before
 * anything deposits into the forked pool; see `truncateToPoolLeaves`.
 *
 * @param {string} rpcUrl - The JSON-RPC endpoint serving the fork.
 * @returns {Promise<{ url: string, block: number, events: Object[], close: () => Promise<void> }>}
 */
export async function serveChainState (rpcUrl) {
  const sdk = initBermudaSdk('plasma-testnet')

  const pool = (await sdk.config.pool.getAddress()).toLowerCase()

  const hosted = await fetchHostedSnapshot(sdk.config.chainState, sdk.config.chainId, pool)
  const events = await truncateToPoolLeaves(rpcUrl, pool, sdk.POOL_ABI, hosted.events)

  const body = JSON.stringify({ block: FORK_BLOCK_NUMBER, events })

  const server = http.createServer((req, res) => {
    if (!req.url.endsWith('/commitment-events.json')) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
      return
    }

    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(body)
  })

  // Keep-alive sockets would otherwise hold the server open past `close()`.
  server.keepAliveTimeout = 0

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

  const { port } = server.address()

  return {
    url: `http://127.0.0.1:${port}`,
    block: FORK_BLOCK_NUMBER,
    events,
    close: () => new Promise(resolve => {
      server.closeAllConnections()
      server.close(resolve)
    })
  }
}
