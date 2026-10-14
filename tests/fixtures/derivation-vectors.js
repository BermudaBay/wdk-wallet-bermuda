// Bermuda accounts are derived from the private key of an EVM account, so any
// change to either derivation would leave users unable to re-derive the
// accounts holding their shielded funds.
//
// The spending keys were captured from the implementation at 59c37c9 and must
// never change. The addresses they lead were captured again, once, for
// @bermuda/sdk v0.3.2, whose address format dropped the spending public key,
// the recovery hash, the x25519 viewing key and the randomized address-binding
// signature for an owner commitment and an X-Wing viewing key, both derived
// from the spending key. They must not change again either.
//
// Shared by tests/derivation-vectors.test.js and tests/bare/smoke.js, so that
// Node.js and Bare are held to the very same values.

export const SEED_PHRASE = 'cook voyage document eight skate token alien guide drink uncle term abuse'

// Only answers the chain id: deriving accounts needs nothing else from the
// network, and the real SDK used here must not reach out to plasma-testnet.
export const PLASMA_TESTNET = {
  request: async ({ method }) => {
    if (method === 'eth_chainId') {
      return '0x2612'
    }

    throw new Error(`Unexpected RPC call: ${method}`)
  }
}

export const EVM_ADDRESSES = [
  [0, '0x405005C7c4422390F4B334F64Cf20E0b767131d0'],
  [1, '0xcC81e04BadA16DEf9e1AFB027B859bec42BE49dB']
]

// The spending public key of every Bermuda account, its x and y coordinates as
// 128 hex characters: what led its address at 59c37c9.
export const BERMUDA_SPENDING_KEYS = [
  [0, 0, '0x1fdebefece752d93219fdb8aa99609f0050a35f9aad6082997effae03c81401b0182207e440887269d05b6a6038ab756bec2209f888ca1413df97a2b2604e5f3'],
  [0, 1, '0x0b7f96f3049957e1a94888762bd68d3a6f47fad29e986d52f89014bb34e4bb9628b2032962300b56e69c5f8c40360a7bc70210f5d7ba31cda272037278091c94'],
  [1, 0, '0x0b31266a5861774bc81b987544d4dcbdc9efd7b4659719efcd3d1bbdc2574c8a17716e313d602c7ad4ea071a3de3672bfa1a7b004937710ed27635c4be5b8bfa']
]

// Every Bermuda address: the owner commitment leading it (66 characters), and
// the keccak256 hash of the whole address (2,498 characters), which the
// 1,216-byte X-Wing key following the commitment would make unwieldy here.
export const BERMUDA_ADDRESSES = [
  [0, 0, '0x2c78e56b60703e4d0ac5350cb4fc15013e9ad005ae36e15a2fb2ecebc17c6681', '0x1607df98ba45c3cd5a96b3116e7149e08d48cb650720f6be2a9ac63768bf6466'],
  [0, 1, '0x112a2569ba56e96f6e47747d65520d3dcd3cbfaa7ca59565e5344b1094e12cb5', '0x605cf443785c6a8cb6a362a0b624b36c76388debab50da92dbd93487b2937570'],
  [1, 0, '0x03be53fe5200a0690e7c7b49e4a745e695dce71929a81a94315e2685634f4863', '0xdef253ca4bb2d1b8f0d1b602754dc631c7d949383d1b3d6db3cb5b4f7d5cd692']
]

/**
 * Returns a Bermuda key pair's spending public key in the format of
 * `BERMUDA_SPENDING_KEYS`.
 *
 * @param {{ pubkeyX: bigint, pubkeyY: bigint }} keyPair - The key pair.
 * @returns {string} The spending public key, as hex.
 */
export function spendingKeyOf (keyPair) {
  return '0x' + [keyPair.pubkeyX, keyPair.pubkeyY].map(coordinate => coordinate.toString(16).padStart(64, '0')).join('')
}
