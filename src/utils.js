export function chainIdToName (chainId) {
  switch (Number(chainId)) {
    case 31337:
      return 'testenv'
    case 100:
      return 'gnosis'
    case 8453:
      return 'base'
    case 84532:
      return 'base-sepolia'
    case 9745:
      return 'plasma-mainnet'
    case 9746:
      return 'plasma-testnet'
    case 59144:
      return 'linea'
    case 59141:
      return 'linea-sepolia'
    default:
      throw Error('Unknown chain id')
  }
}
