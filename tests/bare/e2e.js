// Shielded operations under Bare: a deposit, a transfer and a withdrawal, with
// real proofs, against the plasma-testnet fork that
// tests/integration/bare.test.js runs - in Node.js, the only runtime Hardhat
// supports. That test funds the account, spawns
//
//   bare tests/bare/e2e.js '<options as JSON>'
//
// and checks every result printed here against the chain.

import WalletManagerBermuda from '@bermuda/wdk-wallet-evm-bermuda'

// Must match COMPLETION_MARKER in tests/integration/bare.test.js.
const COMPLETION_MARKER = 'e2e: done'

// The SDK reuses a read, the chain's head among them, for up to a block time: a
// second on plasma-testnet. A balance read sooner after a transaction can still
// predate it.
const READ_REUSE_MS = 1_100

const { rpcUrl, relayerUrl, seedPhrase, recipient } = JSON.parse(Bare.argv.at(-1))

// As in tests/integration/wallet-account-bermuda.test.js: the local relayer, and
// the fork rather than the deployment's indexer.
const wallet = new WalletManagerBermuda(seedPhrase, {
  provider: rpcUrl,
  bermuda: { relayer: relayerUrl, chainState: undefined }
})

const account = await wallet.getBermudaAccount(0, 0)

const subAccount = await wallet.getBermudaAccount(0, 1)

const provider = account._bermuda.config.provider

const wxpl = account._bermuda.config.WXPL

try {
  const deposit = await settle(() => account.deposit({ token: wxpl, amount: 5_000n }))

  report('deposit', { ...deposit, shielded: await account.getTokenBalance(wxpl) })

  const transfer = await settle(() => account.transfer({ token: wxpl, to: subAccount.address, amount: 1_000n }))

  report('transfer', {
    ...transfer,
    sender: await account.getTokenBalance(wxpl),
    recipient: await subAccount.getTokenBalance(wxpl)
  })

  const withdrawal = await settle(() => account.withdraw({ token: wxpl, to: recipient, amount: 250n }))

  report('withdraw', { ...withdrawal, shielded: await account.getTokenBalance(wxpl) })
} finally {
  wallet.dispose()
}

console.log(COMPLETION_MARKER)

// Runs an operation and waits for its transaction to be mined, and for the SDK to
// read past it.
async function settle (operation) {
  const start = Date.now()

  const hash = await operation()

  await provider.waitForTransaction(hash)

  const milliseconds = Date.now() - start

  await new Promise(resolve => setTimeout(resolve, READ_REUSE_MS))

  return { hash, milliseconds }
}

function report (operation, result) {
  console.log(`result ${JSON.stringify({ operation, ...result }, (_, value) => typeof value === 'bigint' ? value.toString() : value)}`)
}
