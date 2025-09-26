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

export async function getUSDCAddressFromRegistry(): Promise<string | null> {
  try {
    // Optional override via Vite env var
    const envAddress = (import.meta as any)?.env?.VITE_USDC_TOKEN_ADDRESS as string | undefined
    if (envAddress && typeof envAddress === 'string' && envAddress.trim()) {
      return envAddress.trim()
    }

    // Fallback: resolve via Namada chain registry
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
    const rawBalances = (await res.json()) as any[]
    
    // Handle both old and new API response formats
    const balances = rawBalances.map((b) => ({
      tokenAddress: typeof b.tokenAddress === 'string' ? b.tokenAddress : b.tokenAddress?.address || '',
      minDenomAmount: b.minDenomAmount
    }))
    
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
      return { balance: '0', formattedBalance: '0.000000', tokenAddress: usdcAddress, accountAddress }
    }

    // Determine decimals from asset list; default to 6
    let decimals = 6
    const usdcAsset = namadaAssets.assets?.find((a) => a.display?.toLowerCase() === 'usdc')
    const displayUnit = usdcAsset?.denom_units?.find((u) => u.denom === usdcAsset.display)
    if (displayUnit?.exponent) decimals = displayUnit.exponent

    const minDenom = BigInt(usdc.minDenomAmount)
    const formattedRaw = Number(minDenom) / Math.pow(10, decimals)
    const formatted = (formattedRaw === 0 ? 0 : formattedRaw).toFixed(6)
    return { balance: usdc.minDenomAmount, formattedBalance: formatted, tokenAddress: usdcAddress, accountAddress }
  } catch {
    return null
  }
}


export type NamadaNAMBalance = {
  balance: string
  formattedBalance: string
  tokenAddress: string | null
  accountAddress: string
}

export async function getNAMAddressFromRegistry(): Promise<string | null> {
  try {
    const namAsset = namadaAssets.assets?.find((a) => a.display?.toLowerCase() === 'nam')
    // Native token may not have an address
    return namAsset?.address ?? null
  } catch {
    return null
  }
}

export async function getNamadaNAMBalance(accountAddress: string): Promise<NamadaNAMBalance | null> {
  try {
    const balances = await fetchNamadaAccountBalances(accountAddress)
    if (!balances) return null

    const namAddress = await getNAMAddressFromRegistry()

    // Try to find by registry address first (if defined)
    let nam = namAddress ? balances.find((b) => b.tokenAddress === namAddress) : undefined

    // If no registry address or not found, try common fallbacks for native NAM representation
    if (!nam) {
      nam = balances.find((b) => b.tokenAddress?.toUpperCase?.() === 'NAM')
        || balances.find((b) => b.tokenAddress === '' || b.tokenAddress === '0x' || b.tokenAddress === 'native')
    }

    // If still not found, best-effort: pick the entry with the largest amount that is not USDC
    if (!nam) {
      const usdcAddress = await getUSDCAddressFromRegistry()
      const candidates = balances.filter((b) => b.tokenAddress !== usdcAddress)
      if (candidates.length > 0) {
        nam = candidates.reduce((max, cur) => (BigInt(cur.minDenomAmount) > BigInt(max.minDenomAmount) ? cur : max), candidates[0])
      }
    }

    if (!nam) {
      return { balance: '0', formattedBalance: '0.000000', tokenAddress: namAddress ?? null, accountAddress }
    }

    // Determine decimals from asset list; default to 6
    let decimals = 6
    const namAsset = namadaAssets.assets?.find((a) => a.display?.toLowerCase() === 'nam')
    const displayUnit = namAsset?.denom_units?.find((u) => u.denom === namAsset.display)
    if (displayUnit?.exponent) decimals = displayUnit.exponent

    const minDenom = BigInt(nam.minDenomAmount)
    const formattedRaw = Number(minDenom) / Math.pow(10, decimals)
    const formatted = (formattedRaw === 0 ? 0 : formattedRaw).toFixed(6)
    return { balance: nam.minDenomAmount, formattedBalance: formatted, tokenAddress: nam.tokenAddress ?? namAddress ?? null, accountAddress }
  } catch {
    return null
  }
}

export function getAssetDecimalsByDisplay(display: string, defaultDecimals: number = 6): number {
  try {
    const asset = namadaAssets.assets?.find((a) => a.display?.toLowerCase() === display.toLowerCase())
    const displayUnit = asset?.denom_units?.find((u) => u.denom === asset?.display)
    if (displayUnit?.exponent) return displayUnit.exponent
    return defaultDecimals
  } catch {
    return defaultDecimals
  }
}


