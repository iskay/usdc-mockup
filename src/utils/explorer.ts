export const getNamadaTxExplorerUrl = (chainId: string, hash: string): string => {
  const lower = hash?.toLowerCase?.() ?? hash
  return chainId.startsWith('housefire')
    ? `https://testnet.namada.world/transactions/${lower}`
    : `https://namada.world/transactions/${lower}`
}


