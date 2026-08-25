import hardhatEthers from '@nomicfoundation/hardhat-ethers'
import { defineConfig } from 'hardhat/config'

export default defineConfig({
  plugins: [hardhatEthers],
  defaultNetwork: 'hardhat',
  paths: {
    artifacts: './tests/artifacts'
  },
  networks: {
    hardhat: {
      type: 'edr-simulated',
      chainType: 'l1',
      hardfork: 'prague',
      accounts: {
        mnemonic: 'anger burst story spy face pattern whale quit delay fiction ball solve',
        path: "m/44'/60'/0'/0",
        initialIndex: 0,
        count: 1,
        accountsBalance: '1000000000000000000000'
      }
    }
  }
})
