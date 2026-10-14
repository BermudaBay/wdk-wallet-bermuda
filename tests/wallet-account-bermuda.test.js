import * as ethers from 'ethers'

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'

import { TransactionError, TransactionErrorReason } from '@tetherto/wdk-wallet'

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
const APPROVE_DATA = '0xapprove-data'
const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'

// What the Ethereum account holds of every token and of the native currency, unless a test says otherwise: more than
// any deposit here pays.
const ETHEREUM_FUNDS = 1_000_000n

// The selector of the pool's `StalePeriod()` error, which refuses a proof made in a period that has ended.
const STALE_PERIOD = '0x5dbb1a06'

describe('WalletAccountBermuda', () => {
  let account,
    bermuda,
    bermudaKeyPair,
    ethereumWallet,
    evmSigner

  beforeEach(() => {
    jest.clearAllMocks()

    tokenContract = {
      allowance: jest.fn(),
      interface: {
        encodeFunctionData: jest.fn(() => APPROVE_DATA)
      }
    }

    bermudaKeyPair = {
      address: jest.fn(() => BERMUDA_ADDRESS),
      privkey: 123n,
      xwing: {
        publicKey: new Uint8Array([7, 8, 9]),
        secretKey: new Uint8Array([4, 5, 6])
      }
    }

    evmSigner = {
      sign: jest.fn(async () => '0xmessage-signature'),
      signTypedData: jest.fn(async () => '0xtyped-data-signature')
    }

    ethereumWallet = {
      _signer: evmSigner,
      address: ETHEREUM_ADDRESS,
      getAddress: jest.fn(async () => ETHEREUM_ADDRESS),
      getBalance: jest.fn(async () => ETHEREUM_FUNDS),
      getTokenBalance: jest.fn(async () => ETHEREUM_FUNDS),
      sendTransaction: jest.fn(),
      dispose: jest.fn()
    }

    bermuda = {
      config: {
        WXPL: false,
        wrappedNativeToken: WRAPPED_TOKEN,
        provider: {
          request: jest.fn(),
          waitForTransaction: jest.fn(),
          getTransaction: jest.fn()
        },
        pool: {
          getAddress: jest.fn(() => POOL_ADDRESS)
        }
      },
      ERC20_ABI: [],
      balance: jest.fn(),
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

  describe('balances', () => {
    test('returns a lower-cased token balance', async () => {
      // The SDK keys a balance by both the token's address and its symbol.
      bermuda.balance.mockResolvedValue({
        [TOKEN.toLowerCase()]: 5n,
        TKN: 5n
      })

      await expect(account.getTokenBalance(TOKEN)).resolves.toBe(5n)

      expect(bermuda.balance).toHaveBeenCalledWith(bermudaKeyPair, [TOKEN.toLowerCase()])
    })

    test('returns zero for a token the SDK reports nothing for', async () => {
      bermuda.balance.mockResolvedValue({})

      await expect(account.getTokenBalance(TOKEN)).resolves.toBe(0n)
    })

    test('returns balances for multiple lower-cased tokens', async () => {
      const secondToken = '0xEfGh'

      bermuda.balance.mockResolvedValue({
        [TOKEN.toLowerCase()]: 7n,
        TKN: 7n
      })

      await expect(account.getTokenBalances([TOKEN, secondToken])).resolves.toEqual({
        [TOKEN.toLowerCase()]: 7n,
        [secondToken.toLowerCase()]: 0n
      })

      expect(bermuda.balance).toHaveBeenCalledWith(bermudaKeyPair, [TOKEN.toLowerCase(), secondToken.toLowerCase()])
    })

    // The SDK reads every token of the chain when asked for none.
    test('returns no balances, without asking the SDK, for no tokens', async () => {
      await expect(account.getTokenBalances([])).resolves.toEqual({})

      expect(bermuda.balance).not.toHaveBeenCalled()
    })
  })

  describe('deposit', () => {
    test('deposits to the associated Bermuda account by default', async () => {
      const params = { token: TOKEN, amount: 10n }
      const options = { deadline: 123 }
      const payload = { to: '0xcontract', data: '0x1234', depositFees: { spend: 10n } }

      bermuda.deposit.mockResolvedValue(payload)
      ethereumWallet.sendTransaction.mockResolvedValue({ hash: '0xhash' })

      await expect(account.deposit(params, options)).resolves.toBe('0xhash')

      expect(bermuda.deposit).toHaveBeenCalledWith({
        token: TOKEN,
        amount: 10n,
        to: BERMUDA_ADDRESS,
        signer: {
          provider: bermuda.config.provider,
          getAddress: expect.any(Function),
          signMessage: expect.any(Function),
          signTypedData: expect.any(Function)
        }
      }, {
        deadline: 123,
        topup: bermudaKeyPair
      })

      // Only the transaction itself is sent, not the rest of the payload.
      expect(ethereumWallet.sendTransaction).toHaveBeenCalledWith({
        to: '0xcontract',
        data: '0x1234',
        value: 0n
      })

      // The caller's arguments are left as they were.
      expect(params).toEqual({ token: TOKEN, amount: 10n })
      expect(options).toEqual({ deadline: 123 })
    })

    test('deposits with an ethers-shaped signer backed by the Ethereum account', async () => {
      const domain = { name: 'Wrapped' }
      const types = { Permit: [] }
      const message = { value: 10n }

      bermuda.deposit.mockResolvedValue({ to: '0xcontract', depositFees: { spend: 10n } })
      ethereumWallet.sendTransaction.mockResolvedValue({ hash: '0xhash' })

      await account.deposit({ token: TOKEN, amount: 10n })

      const [[{ signer }]] = bermuda.deposit.mock.calls

      await expect(signer.getAddress()).resolves.toBe(ETHEREUM_ADDRESS)

      await expect(signer.signMessage('0xmessage')).resolves.toBe('0xmessage-signature')
      expect(evmSigner.sign).toHaveBeenCalledWith('0xmessage')

      await expect(signer.signTypedData(domain, types, message)).resolves.toBe('0xtyped-data-signature')
      expect(evmSigner.signTypedData).toHaveBeenCalledWith({ domain, types, message })
    })

    test('deposits to another account without a recipients array', async () => {
      bermuda.deposit.mockResolvedValue({ to: '0xcontract', depositFees: { spend: 10n } })
      ethereumWallet.sendTransaction.mockResolvedValue({ hash: '0xhash' })

      await expect(account.deposit({ token: TOKEN, to: '0xother-bermuda-account', amount: 10n, memo: 'hi' })).resolves.toBe('0xhash')

      expect(bermuda.deposit).toHaveBeenCalledWith(
        expect.objectContaining({ token: TOKEN, to: '0xother-bermuda-account', amount: 10n, memo: 'hi' }),
        {}
      )
    })

    test('tops up when one of multiple deposit recipients is the associated account', async () => {
      const recipients = [
        { to: '0xother', amount: 5n, memo: 'other' },
        { to: BERMUDA_ADDRESS, amount: 5n }
      ]

      bermuda.deposit.mockResolvedValue({ to: '0xcontract', depositFees: { spend: 10n } })
      ethereumWallet.sendTransaction.mockResolvedValue({ hash: '0xhash' })

      await account.deposit({ token: TOKEN, recipients })

      const [[depositParams, depositOptions]] = bermuda.deposit.mock.calls

      expect(depositParams.recipients).toEqual(recipients)
      expect(depositParams.to).toBeUndefined()
      expect(depositOptions).toEqual({ topup: bermudaKeyPair })
    })

    test('hands the SDK its amounts as bigints', async () => {
      bermuda.deposit.mockResolvedValue({ to: '0xcontract', depositFees: { spend: 10n } })
      ethereumWallet.sendTransaction.mockResolvedValue({ hash: '0xhash' })

      await account.deposit({ token: TOKEN, amount: 10 })
      await account.deposit({ token: TOKEN, recipients: [{ to: '0xother', amount: 3 }] })

      expect(bermuda.deposit.mock.calls[0][0].amount).toBe(10n)
      expect(bermuda.deposit.mock.calls[1][0].recipients).toEqual([{ to: '0xother', amount: 3n }])
    })

    test('sends the native value the SDK asks for', async () => {
      bermuda.deposit.mockResolvedValue({ to: '0xcontract', data: '0x1234', value: 12n, depositFees: { spend: 12n } })
      ethereumWallet.getBalance.mockResolvedValue(12n)
      ethereumWallet.sendTransaction.mockResolvedValue({ hash: '0xhash' })

      await account.deposit({ token: NATIVE_TOKEN, amount: 10n })

      expect(ethereumWallet.sendTransaction).toHaveBeenCalledWith({ to: '0xcontract', data: '0x1234', value: 12n })
      expect(Contract).not.toHaveBeenCalled()

      // The value comes out of the native balance, which covers it exactly.
      expect(ethereumWallet.getBalance).toHaveBeenCalled()
      expect(ethereumWallet.getTokenBalance).not.toHaveBeenCalled()
    })

    test('deposits when the Ethereum account holds exactly what the deposit pays', async () => {
      bermuda.deposit.mockResolvedValue({ to: '0xcontract', data: '0x1234', depositFees: { spend: 12n } })
      ethereumWallet.getTokenBalance.mockResolvedValue(12n)
      ethereumWallet.sendTransaction.mockResolvedValue({ hash: '0xhash' })

      await expect(account.deposit({ token: TOKEN, amount: 10n })).resolves.toBe('0xhash')

      expect(ethereumWallet.getTokenBalance).toHaveBeenCalledWith(TOKEN)
      expect(ethereumWallet.getBalance).not.toHaveBeenCalled()
    })

    describe('that the Ethereum account cannot pay', () => {
      async function depositError (params) {
        return await account.deposit(params).then(() => undefined, error => error)
      }

      test('is refused before anything is sent', async () => {
        bermuda.deposit.mockResolvedValue({ to: '0xcontract', data: '0x1234', depositFees: { spend: 12n } })
        ethereumWallet.getTokenBalance.mockResolvedValue(11n)

        const error = await depositError({ token: TOKEN, amount: 10n })

        expect(error).toBeInstanceOf(TransactionError)
        expect(error.reason).toBe(TransactionErrorReason.INSUFFICIENT_BALANCE)
        expect(error.message).toBe(
          `The deposit pays the pool 12 of token ${TOKEN} (its amount and fees, in base units), but the Ethereum ` +
            `account ${ETHEREUM_ADDRESS} holds 11.`
        )

        expect(ethereumWallet.sendTransaction).not.toHaveBeenCalled()
      })

      test('is refused, in the native currency, for a native deposit', async () => {
        bermuda.deposit.mockResolvedValue({ to: '0xcontract', data: '0x1234', value: 12n, depositFees: { spend: 12n } })
        ethereumWallet.getBalance.mockResolvedValue(11n)

        const error = await depositError({ token: NATIVE_TOKEN, amount: 10n })

        expect(error).toBeInstanceOf(TransactionError)
        expect(error.reason).toBe(TransactionErrorReason.INSUFFICIENT_BALANCE)
        expect(error.message).toBe(
          'The deposit pays the pool 12 of the native currency (its amount and fees, in base units), but the ' +
            `Ethereum account ${ETHEREUM_ADDRESS} holds 11.`
        )

        expect(ethereumWallet.getTokenBalance).not.toHaveBeenCalled()
        expect(ethereumWallet.sendTransaction).not.toHaveBeenCalled()
      })

      // An account that holds the native currency but not its wrapped token may mean to deposit the former.
      test('is refused before the approval for the wrapped native token, pointing to NATIVE_DEPOSIT_TOKEN', async () => {
        bermuda.config.WXPL = true
        bermuda.deposit.mockResolvedValue({ to: '0xcontract', data: '0x1234', depositFees: { spend: 100n } })
        ethereumWallet.getTokenBalance.mockResolvedValue(14n)

        const error = await depositError({ token: WRAPPED_TOKEN.toLowerCase(), amount: 100n })

        expect(error).toBeInstanceOf(TransactionError)
        expect(error.reason).toBe(TransactionErrorReason.INSUFFICIENT_BALANCE)
        expect(error.message).toBe(
          `The deposit pays the pool 100 of token ${WRAPPED_TOKEN.toLowerCase()} (its amount and fees, in base units), ` +
            `but the Ethereum account ${ETHEREUM_ADDRESS} holds 14. To shield the native currency instead, deposit ` +
            'NATIVE_DEPOSIT_TOKEN.'
        )

        expect(tokenContract.allowance).not.toHaveBeenCalled()
        expect(ethereumWallet.sendTransaction).not.toHaveBeenCalled()
      })
    })

    test('approves the deposit total of the wrapped native token when the allowance falls short', async () => {
      bermuda.config.WXPL = true
      bermuda.deposit.mockResolvedValue({ to: '0xcontract', data: '0x1234', depositFees: { spend: 12n } })
      bermuda.config.provider.getTransaction.mockResolvedValue({ nonce: 4 })
      ethereumWallet.sendTransaction
        .mockResolvedValueOnce({ hash: '0xapprove' })
        .mockResolvedValue({ hash: '0xhash' })
      tokenContract.allowance.mockResolvedValue(9n)

      await expect(account.deposit({ token: WRAPPED_TOKEN.toUpperCase(), amount: 10n })).resolves.toBe('0xhash')

      expect(Contract).toHaveBeenCalledWith(
        WRAPPED_TOKEN,
        bermuda.ERC20_ABI,
        { provider: bermuda.config.provider }
      )
      expect(tokenContract.allowance).toHaveBeenCalledWith(ETHEREUM_ADDRESS, POOL_ADDRESS)

      // The pool pulls the amount and the fees on top of it, which the deposit only tells once built.
      expect(bermuda.deposit.mock.invocationCallOrder[0]).toBeLessThan(ethereumWallet.sendTransaction.mock.invocationCallOrder[0])
      expect(tokenContract.interface.encodeFunctionData).toHaveBeenCalledWith('approve', [POOL_ADDRESS, 12n])
      expect(ethereumWallet.sendTransaction).toHaveBeenNthCalledWith(1, {
        to: WRAPPED_TOKEN,
        data: APPROVE_DATA
      })
      expect(bermuda.config.provider.waitForTransaction).toHaveBeenCalledWith('0xapprove')

      // Sent at the nonce after the approval's, which ethers' cached transaction count would not give.
      expect(bermuda.config.provider.getTransaction).toHaveBeenCalledWith('0xapprove')
      expect(ethereumWallet.sendTransaction).toHaveBeenLastCalledWith({
        to: '0xcontract',
        data: '0x1234',
        value: 0n,
        nonce: 5
      })
    })

    test('does not approve the wrapped native token when the allowance covers the deposit total', async () => {
      bermuda.config.WXPL = true
      bermuda.deposit.mockResolvedValue({ to: '0xcontract', data: '0x1234', depositFees: { spend: 12n } })
      ethereumWallet.sendTransaction.mockResolvedValue({ hash: '0xhash' })
      tokenContract.allowance.mockResolvedValue(12n)

      await account.deposit({ token: WRAPPED_TOKEN, amount: 10n })

      expect(tokenContract.interface.encodeFunctionData).not.toHaveBeenCalled()
      expect(bermuda.config.provider.waitForTransaction).not.toHaveBeenCalled()
      expect(ethereumWallet.sendTransaction).toHaveBeenCalledTimes(1)
      expect(ethereumWallet.sendTransaction).toHaveBeenCalledWith({ to: '0xcontract', data: '0x1234', value: 0n })
    })

    test('batch-deposits the wrapped native token', async () => {
      bermuda.config.WXPL = true
      bermuda.deposit.mockResolvedValue({ to: '0xcontract', depositFees: { spend: 200n } })
      bermuda.config.provider.getTransaction.mockResolvedValue({ nonce: 0 })
      ethereumWallet.sendTransaction
        .mockResolvedValueOnce({ hash: '0xapprove' })
        .mockResolvedValue({ hash: '0xhash' })
      tokenContract.allowance.mockResolvedValue(0n)

      await expect(account.deposit({
        token: WRAPPED_TOKEN,
        recipients: [
          { to: BERMUDA_ADDRESS, amount: 100n },
          { to: '0xother', amount: 100n }
        ]
      })).resolves.toBe('0xhash')

      expect(tokenContract.interface.encodeFunctionData).toHaveBeenCalledWith('approve', [POOL_ADDRESS, 200n])
    })

    test('does not approve a token other than the wrapped native one', async () => {
      bermuda.config.WXPL = true
      bermuda.deposit.mockResolvedValue({ to: '0xcontract', depositFees: { spend: 12n } })
      ethereumWallet.sendTransaction.mockResolvedValue({ hash: '0xhash' })

      await account.deposit({ token: TOKEN, amount: 10n })

      expect(Contract).not.toHaveBeenCalled()
      expect(ethereumWallet.sendTransaction).toHaveBeenCalledTimes(1)
    })

    describe('the SDK\'s warning that it cannot permit the token', () => {
      let warn

      beforeEach(() => {
        warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
      })

      afterEach(() => {
        warn.mockRestore()
      })

      function warnPermitFallback (token) {
        console.warn(`deposit: EIP-2612 permit unavailable for ${token} — falling back to the depositor's existing pool allowance`, new Error('no permit'))
      }

      // The account approves WXPL itself, so the warning is expected.
      test('is dropped for the wrapped native token, while other warnings are not', async () => {
        bermuda.config.WXPL = true
        bermuda.deposit.mockImplementation(async () => {
          warnPermitFallback(WRAPPED_TOKEN)
          console.warn('something else')

          return { to: '0xcontract', data: '0x1234', depositFees: { spend: 12n } }
        })
        tokenContract.allowance.mockResolvedValue(12n)
        ethereumWallet.sendTransaction.mockResolvedValue({ hash: '0xhash' })

        await account.deposit({ token: WRAPPED_TOKEN.toLowerCase(), amount: 10n })

        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledWith('something else')
        expect(console.warn).toBe(warn)
      })

      test('is kept for any other token', async () => {
        bermuda.config.WXPL = true
        bermuda.deposit.mockImplementation(async () => {
          warnPermitFallback(TOKEN)

          return { to: '0xcontract', depositFees: { spend: 10n } }
        })
        ethereumWallet.sendTransaction.mockResolvedValue({ hash: '0xhash' })

        await account.deposit({ token: TOKEN, amount: 10n })

        expect(warn).toHaveBeenCalledWith(expect.stringContaining(`unavailable for ${TOKEN}`), expect.any(Error))
      })
    })

    test('proves the deposit again when the pool refuses its period as stale', async () => {
      const reproved = { to: '0xcontract', data: '0x5678' }
      const payload = { to: '0xcontract', data: '0x1234', depositFees: { spend: 10n }, reprove: jest.fn(async () => reproved) }

      bermuda.deposit.mockResolvedValue(payload)
      ethereumWallet.sendTransaction
        .mockRejectedValueOnce(Object.assign(new Error('execution reverted'), { data: STALE_PERIOD }))
        .mockResolvedValue({ hash: '0xhash' })

      await expect(account.deposit({ token: TOKEN, amount: 10n })).resolves.toBe('0xhash')

      expect(payload.reprove).toHaveBeenCalledTimes(1)
      expect(ethereumWallet.sendTransaction).toHaveBeenLastCalledWith({ to: '0xcontract', data: '0x5678', value: 0n })
    })

    test('keeps the nonce after the approval when it proves the deposit again', async () => {
      const payload = {
        to: '0xcontract',
        data: '0x1234',
        depositFees: { spend: 10n },
        reprove: jest.fn(async () => ({ to: '0xcontract', data: '0x5678' }))
      }

      bermuda.config.WXPL = true
      bermuda.deposit.mockResolvedValue(payload)
      bermuda.config.provider.getTransaction.mockResolvedValue({ nonce: 1 })
      tokenContract.allowance.mockResolvedValue(0n)
      ethereumWallet.sendTransaction
        .mockResolvedValueOnce({ hash: '0xapprove' })
        .mockRejectedValueOnce(new Error('execution reverted: StalePeriod()'))
        .mockResolvedValue({ hash: '0xhash' })

      await expect(account.deposit({ token: WRAPPED_TOKEN, amount: 10n })).resolves.toBe('0xhash')

      expect(ethereumWallet.sendTransaction).toHaveBeenCalledTimes(3)
      expect(ethereumWallet.sendTransaction).toHaveBeenLastCalledWith({ to: '0xcontract', data: '0x5678', value: 0n, nonce: 2 })
    })

    test('rethrows any other failure to send the deposit', async () => {
      const payload = { to: '0xcontract', depositFees: { spend: 10n }, reprove: jest.fn() }

      bermuda.deposit.mockResolvedValue(payload)
      ethereumWallet.sendTransaction.mockRejectedValue(new Error('Exceeded maximum fee cost for transaction operation.'))

      await expect(account.deposit({ token: TOKEN, amount: 10n })).rejects.toThrow('Exceeded maximum fee cost')

      expect(payload.reprove).not.toHaveBeenCalled()
    })
  })

  describe('transfer', () => {
    test('transfers shielded funds through the relay', async () => {
      const params = { token: TOKEN, to: '0xrecipient', amount: 10n, memo: 'transfer' }
      const options = { relayFee: 1n }
      const payload = { proof: 'proof' }

      bermuda.transfer.mockResolvedValue(payload)
      bermuda.relay.mockResolvedValue('0xrelay')

      await expect(account.transfer(params, options)).resolves.toBe('0xrelay')

      expect(bermuda.transfer).toHaveBeenCalledWith({ ...params, spender: bermudaKeyPair }, options)
      expect(bermuda.relay).toHaveBeenCalledWith(payload)
      expect(params).toEqual({ token: TOKEN, to: '0xrecipient', amount: 10n, memo: 'transfer' })
    })

    test('transfers with default options when none are given', async () => {
      bermuda.transfer.mockResolvedValue({ proof: 'proof' })
      bermuda.relay.mockResolvedValue('0xrelay')

      await expect(account.transfer({ token: TOKEN, to: '0xrecipient', amount: 10n })).resolves.toBe('0xrelay')

      expect(bermuda.transfer).toHaveBeenCalledWith(expect.any(Object), {})
    })

    test('hands the SDK its amounts as bigints', async () => {
      bermuda.transfer.mockResolvedValue({ proof: 'proof' })

      await account.transfer({ token: TOKEN, recipients: [{ to: '0xa', amount: 1 }, { to: '0xb', amount: 2n }] })

      expect(bermuda.transfer.mock.calls[0][0].recipients).toEqual([{ to: '0xa', amount: 1n }, { to: '0xb', amount: 2n }])
    })
  })

  describe('withdraw', () => {
    test('withdraws to the associated Ethereum account by default', async () => {
      const params = { token: TOKEN, amount: 10 }
      const options = { relayFee: 1n }
      const payload = { proof: 'proof' }

      bermuda.withdraw.mockResolvedValue(payload)
      bermuda.relay.mockResolvedValue('0xrelay')

      await expect(account.withdraw(params, options)).resolves.toBe('0xrelay')

      expect(bermuda.withdraw).toHaveBeenCalledWith({
        token: TOKEN,
        amount: 10n,
        spender: bermudaKeyPair,
        to: ETHEREUM_ADDRESS
      }, options)
      expect(bermuda.relay).toHaveBeenCalledWith(payload)
      expect(params).toEqual({ token: TOKEN, amount: 10 })
    })

    test('preserves an explicit withdrawal recipient', async () => {
      bermuda.withdraw.mockResolvedValue({ proof: 'proof' })

      await account.withdraw({ token: TOKEN, to: '0xrecipient', amount: 10n })

      expect(bermuda.withdraw.mock.calls[0][0].to).toBe('0xrecipient')
      expect(bermuda.withdraw.mock.calls[0][1]).toEqual({})
    })
  })

  describe('dispose', () => {
    test('erases the bermuda secrets', () => {
      const secretKey = bermudaKeyPair.xwing.secretKey

      expect(account.disposed).toBe(false)

      account.dispose()

      expect(account.disposed).toBe(true)
      expect(bermudaKeyPair.privkey).toBeNull()
      expect(secretKey).toEqual(new Uint8Array(3))
    })

    // The ethereum account is owned by the wallet manager, and every Bermuda
    // account derived from the same BIP-44 index shares it.
    test('leaves the ethereum account alone', () => {
      account.dispose()

      expect(ethereumWallet.dispose).not.toHaveBeenCalled()
    })

    test('can be repeated', () => {
      account.dispose()

      expect(() => account.dispose()).not.toThrow()
      expect(account.disposed).toBe(true)
    })
  })
})
