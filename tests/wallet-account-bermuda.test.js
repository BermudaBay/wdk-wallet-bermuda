import * as ethers from 'ethers'

import { beforeEach, describe, expect, jest, test } from '@jest/globals'

let tokenContract

const Contract = jest.fn(() => tokenContract)

jest.unstable_mockModule('ethers', () => ({
  ...ethers,
  Contract
}))

const { default: WalletAccountBermuda } = await import('../src/wallet-account-bermuda.js')

const BERMUDA_ADDRESS = '0xbermuda'
const ETHEREUM_ADDRESS = '0xethereum'
const TOKEN = '0xAbCd'
const WRAPPED_TOKEN = '0xWrapped'
const POOL_ADDRESS = '0xpool'

describe('WalletAccountBermuda', () => {
  let account,
    bermuda,
    bermudaKeyPair,
    ethereumWallet

  beforeEach(() => {
    jest.clearAllMocks()

    tokenContract = {
      allowance: jest.fn(),
      connect: jest.fn()
    }

    tokenContract.connect.mockReturnValue({
      approve: jest.fn()
    })

    bermudaKeyPair = {
      address: jest.fn(() => BERMUDA_ADDRESS),
      privkey: new Uint8Array([1, 2, 3]),
      x25519: {
        secretKey: new Uint8Array([4, 5, 6])
      }
    }

    ethereumWallet = {
      _account: { address: ETHEREUM_ADDRESS },
      address: ETHEREUM_ADDRESS,
      sendTransaction: jest.fn(),
      dispose: jest.fn()
    }

    bermuda = {
      config: {
        WXPL: false,
        wrappedNativeToken: WRAPPED_TOKEN,
        provider: { request: jest.fn() },
        pool: {
          getAddress: jest.fn(() => POOL_ADDRESS)
        }
      },
      ERC20_ABI: [],
      findUtxos: jest.fn(),
      sumAmounts: jest.fn(values => values.reduce((sum, value) => sum + value, 0n)),
      deposit: jest.fn(),
      transfer: jest.fn(),
      withdraw: jest.fn(),
      relay: jest.fn()
    }

    account = new WalletAccountBermuda(bermuda, ethereumWallet, bermudaKeyPair)
  })

  test('returns the Bermuda address', () => {
    expect(account.getAddress()).toBe(BERMUDA_ADDRESS)
    expect(account.address).toBe(BERMUDA_ADDRESS)
  })

  test('returns a lower-cased token balance', async () => {
    bermuda.findUtxos.mockResolvedValue({
      [TOKEN.toLowerCase()]: [2n, 3n]
    })

    await expect(account.getTokenBalance(TOKEN)).resolves.toBe(5n)

    expect(bermuda.findUtxos).toHaveBeenCalledWith({
      keypair: bermudaKeyPair,
      tokens: [TOKEN.toLowerCase()]
    })
  })

  test('returns zero for a token without UTXOs', async () => {
    bermuda.findUtxos.mockResolvedValue({})

    await expect(account.getTokenBalance(TOKEN)).resolves.toBe(0n)
    expect(bermuda.sumAmounts).toHaveBeenCalledWith([])
  })

  test('returns balances for multiple lower-cased tokens', async () => {
    const secondToken = '0xEfGh'
    bermuda.findUtxos.mockResolvedValue({
      [TOKEN.toLowerCase()]: [7n]
    })

    await expect(account.getTokenBalances([TOKEN, secondToken])).resolves.toEqual({
      [TOKEN.toLowerCase()]: 7n,
      [secondToken.toLowerCase()]: 0n
    })
  })

  test('deposits to the associated Bermuda account by default', async () => {
    const params = { token: TOKEN, amount: 10n }
    const options = { memo: 'deposit' }
    const payload = { to: '0xcontract', data: '0x1234' }

    bermuda.deposit.mockResolvedValue(payload)
    ethereumWallet.sendTransaction.mockResolvedValue({ hash: '0xhash' })

    await expect(account.deposit(params, options)).resolves.toBe('0xhash')

    expect(params).toMatchObject({
      signer: ethereumWallet._account,
      to: BERMUDA_ADDRESS
    })
    expect(bermuda.deposit).toHaveBeenCalledWith(params, {
      ...options,
      topup: bermudaKeyPair
    })
    expect(options).toEqual({ memo: 'deposit' })
    expect(ethereumWallet.sendTransaction).toHaveBeenCalledWith({
      ...payload,
      value: 0n
    })
  })

  test('deposits to another account without a recipients array', async () => {
    const params = {
      token: TOKEN,
      to: '0xother-bermuda-account',
      amount: 10n
    }

    bermuda.deposit.mockResolvedValue({ to: '0xcontract' })
    ethereumWallet.sendTransaction.mockResolvedValue({ hash: '0xhash' })

    await expect(account.deposit(params)).resolves.toBe('0xhash')
    expect(bermuda.deposit).toHaveBeenCalledWith(params, {})
  })

  test('tops up when one of multiple deposit recipients is the associated account', async () => {
    const params = {
      token: TOKEN,
      amount: 10n,
      recipients: [
        { to: '0xother', amount: 5n },
        { to: BERMUDA_ADDRESS, amount: 5n }
      ]
    }

    bermuda.deposit.mockResolvedValue({ to: '0xcontract' })
    ethereumWallet.sendTransaction.mockResolvedValue({ hash: '0xhash' })

    await account.deposit(params)

    expect(bermuda.deposit).toHaveBeenCalledWith(params, {
      topup: bermudaKeyPair
    })
  })

  test('approves and deposits the wrapped native token when allowance is insufficient', async () => {
    const approve = jest.fn().mockResolvedValue({ hash: '0xapprove' })
    const params = { token: WRAPPED_TOKEN.toUpperCase(), amount: 10n }

    bermuda.config.WXPL = true
    bermuda.deposit.mockResolvedValue({ to: '0xcontract' })
    ethereumWallet.sendTransaction.mockResolvedValue({ hash: '0xhash' })
    tokenContract.allowance.mockResolvedValue(9n)
    tokenContract.connect.mockReturnValue({ approve })

    await account.deposit(params)

    expect(Contract).toHaveBeenCalledWith(
      WRAPPED_TOKEN,
      bermuda.ERC20_ABI,
      { provider: bermuda.config.provider }
    )
    expect(tokenContract.allowance).toHaveBeenCalledWith(ETHEREUM_ADDRESS, POOL_ADDRESS)
    expect(tokenContract.connect).toHaveBeenCalledWith(ethereumWallet)
    expect(approve).toHaveBeenCalledWith(POOL_ADDRESS, 10n)
    expect(ethereumWallet.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({
      value: 10n
    }))
  })

  test('does not approve the wrapped native token when allowance is sufficient', async () => {
    const approve = jest.fn()
    const params = { token: WRAPPED_TOKEN, amount: 10n }

    bermuda.config.WXPL = true
    bermuda.deposit.mockResolvedValue({ to: '0xcontract' })
    ethereumWallet.sendTransaction.mockResolvedValue({ hash: '0xhash' })
    tokenContract.allowance.mockResolvedValue(10n)
    tokenContract.connect.mockReturnValue({ approve })

    await account.deposit(params)

    expect(tokenContract.connect).not.toHaveBeenCalled()
    expect(approve).not.toHaveBeenCalled()
  })

  test('transfers shielded funds through the relay', async () => {
    const params = { token: TOKEN, to: '0xrecipient', amount: 10n }
    const options = { note: 'transfer' }
    const payload = { proof: 'proof' }

    bermuda.transfer.mockResolvedValue(payload)
    bermuda.relay.mockResolvedValue('0xrelay')

    await expect(account.transfer(params, options)).resolves.toBe('0xrelay')

    expect(params.spender).toBe(bermudaKeyPair)
    expect(bermuda.transfer).toHaveBeenCalledWith(params, options)
    expect(bermuda.relay).toHaveBeenCalledWith(payload)
  })

  test('withdraws to the associated Ethereum account by default', async () => {
    const params = { token: TOKEN, amount: 10n }
    const options = { note: 'withdraw' }
    const payload = { proof: 'proof' }

    bermuda.withdraw.mockResolvedValue(payload)
    bermuda.relay.mockResolvedValue('0xrelay')

    await expect(account.withdraw(params, options)).resolves.toBe('0xrelay')

    expect(params).toMatchObject({
      spender: bermudaKeyPair,
      to: ETHEREUM_ADDRESS
    })
    expect(bermuda.withdraw).toHaveBeenCalledWith(params, options)
    expect(bermuda.relay).toHaveBeenCalledWith(payload)
  })

  test('preserves an explicit withdrawal recipient', async () => {
    const params = { token: TOKEN, to: '0xrecipient', amount: 10n }

    bermuda.withdraw.mockResolvedValue({ proof: 'proof' })

    await account.withdraw(params)

    expect(params.to).toBe('0xrecipient')
  })

  test('disposes both account secrets', () => {
    const secretKey = bermudaKeyPair.x25519.secretKey

    account.dispose()

    expect(ethereumWallet.dispose).toHaveBeenCalledTimes(1)
    expect(bermudaKeyPair.privkey).toBeNull()
    expect(secretKey).toEqual(new Uint8Array(3))
  })
})
