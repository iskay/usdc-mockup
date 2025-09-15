import namadaAssets from '@namada/chain-registry/namada/assetlist.json'

export type NamadaUSDCBalance = {
  balance: string
  formattedBalance: string
  tokenAddress: string
  accountAddress: string
}

function getNamadaIndexerUrl(): string {
  // simple default; can be moved to env later
  return import.meta.env.VITE_NAMADA_INDEXER_URL || 'https://indexer.namada.tududes.com'
}

async function getUSDCAddressFromRegistry(): Promise<string | null> {
  try {
    const usdcAsset = namadaAssets.assets?.find((a) => a.display?.toLowerCase() === 'usdc')
    if (usdcAsset?.address) return usdcAsset.address
    return null
  } catch {
    return null
  }
}

export async function fetchNamadaAccountBalances(accountAddress: string): Promise<{ tokenAddress: string; minDenomAmount: string }[] | null> {
  try {
    const apiUrl = `${getNamadaIndexerUrl()}/api/v1/account/${accountAddress}`
    const res = await fetch(apiUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const balances = (await res.json()) as { tokenAddress: string; minDenomAmount: string }[]
    return balances
  } catch {
    return null
  }
}

export async function getNamadaUSDCBalance(accountAddress: string): Promise<NamadaUSDCBalance | null> {
  try {
    const balances = await fetchNamadaAccountBalances(accountAddress)
    if (!balances) return null

    const usdcAddress = await getUSDCAddressFromRegistry()
    if (!usdcAddress) return null

    const usdc = balances.find((b) => b.tokenAddress === usdcAddress)
    if (!usdc) {
      return { balance: '0', formattedBalance: '0', tokenAddress: usdcAddress, accountAddress }
    }

    // Determine decimals from asset list; default to 6
    let decimals = 6
    const usdcAsset = namadaAssets.assets?.find((a) => a.display?.toLowerCase() === 'usdc')
    const displayUnit = usdcAsset?.denom_units?.find((u) => u.denom === usdcAsset.display)
    if (displayUnit?.exponent) decimals = displayUnit.exponent

    const minDenom = BigInt(usdc.minDenomAmount)
    const formatted = (Number(minDenom) / Math.pow(10, decimals)).toFixed(6)
    return { balance: usdc.minDenomAmount, formattedBalance: formatted, tokenAddress: usdcAddress, accountAddress }
  } catch {
    return null
  }
}


