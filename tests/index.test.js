import { describe, expect, test } from '@jest/globals'

import WalletManagerBermudaDefault, {
  WalletManagerBermuda,
  WalletAccountBermuda,
  WalletAccountEvm,
  WalletAccountReadOnlyEvm
} from '../index.js'

import WalletManagerBermudaDirect from '../src/wallet-manager-bermuda.js'
import WalletAccountBermudaDirect from '../src/wallet-account-bermuda.js'

describe('package exports', () => {
  test('exposes the wallet manager as both the default and a named export', () => {
    expect(WalletManagerBermudaDefault).toBe(WalletManagerBermudaDirect)
    expect(WalletManagerBermuda).toBe(WalletManagerBermudaDirect)
  })

  test('re-exports the Bermuda account', () => {
    expect(WalletAccountBermuda).toBe(WalletAccountBermudaDirect)
  })

  test('re-exports the EVM accounts from @tetherto/wdk-wallet-evm', () => {
    expect(typeof WalletAccountEvm).toBe('function')
    expect(typeof WalletAccountReadOnlyEvm).toBe('function')
  })
})
