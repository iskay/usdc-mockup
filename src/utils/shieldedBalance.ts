import type { Sdk } from '@namada/sdk-multicore'
import { getAssetDecimalsByDisplay, getUSDCAddressFromRegistry } from './namadaBalance'

export type ShieldedTokenBalance = {
  tokenAddress: string
  minDenomAmount: string
}

export async function fetchShieldedUSDCBalance(
  sdk: Sdk,
  viewingKey: string,
  chainId: string
): Promise<ShieldedTokenBalance | null> {
  try {
    const usdcAddress = await getUSDCAddressFromRegistry()
    if (!usdcAddress) return null
    const balances = await (sdk.rpc as any).queryBalance(viewingKey, [usdcAddress], chainId) as [string, string][]
    const match = balances.find(([addr]) => addr === usdcAddress)
    if (!match) return { tokenAddress: usdcAddress, minDenomAmount: '0' }
    return { tokenAddress: match[0], minDenomAmount: match[1] }
  } catch {
    return null
  }
}

export function formatMinDenom(amountMinDenom: string, display: string = 'USDC'): string {
  try {
    const decimals = getAssetDecimalsByDisplay(display, 6)
    const n = Number(BigInt(amountMinDenom)) / Math.pow(10, decimals)
    return (n === 0 ? 0 : n).toFixed(2)
  } catch {
    return '0.00'
  }
}

export async function fetchShieldedBalances(
  sdk: Sdk,
  viewingKey: string,
  tokenAddresses: string[],
  chainId: string
): Promise<[string, string][]> {
  try {
    if (!tokenAddresses || tokenAddresses.length === 0) return []
    const balances = await (sdk.rpc as any).queryBalance(viewingKey, tokenAddresses, chainId) as [string, string][]
    return balances
  } catch {
    return []
  }
}


