function getIndexerUrl(): string {
  return import.meta.env.VITE_NAMADA_INDEXER_URL || 'https://indexer.namada.tududes.com'
}

export async function fetchBlockHeightByTimestamp(timestampMs: number): Promise<number> {
  const tsSeconds = Math.floor(timestampMs / 1000)
  const url = `${getIndexerUrl()}/api/v1/block/timestamp/${tsSeconds}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Indexer HTTP ${res.status}`)
  const data = await res.json()
  if (typeof data?.height !== 'undefined') return Number(data.height)
  if (typeof data === 'number' || typeof data === 'string') return Number(data)
  throw new Error('Unexpected indexer response')
}

export type GasEstimate = {
  min: number
  avg: number
  max: number
  totalEstimates: number
}

export type GasPriceEntry = {
  token: string
  gasPrice: string | number
}

// Attempts to fetch a gas estimate tailored to the provided tx kinds.
// Mirrors the ordering used in Namadillo's indexer client:
// [Bond, ClaimRewards, Unbond, TransparentTransfer, ShieldedTransfer, ShieldingTransfer,
//  UnshieldingTransfer, VoteProposal, IbcTransfer, Withdraw, RevealPk, Redelegate]
export async function fetchGasEstimateForKinds(txKinds: string[]): Promise<GasEstimate> {
  const counters: Record<string, number> = {}
  for (const kind of txKinds) counters[kind] = (counters[kind] || 0) + 1

  // Build query params best-effort; indexer accepts both order-based and named params in many deployments.
  const params = new URLSearchParams({
    bond: String(counters['Bond'] || 0),
    claimRewards: String(counters['ClaimRewards'] || 0),
    unbond: String(counters['Unbond'] || 0),
    transparentTransfer: String(counters['TransparentTransfer'] || 0),
    shieldedTransfer: String(counters['ShieldedTransfer'] || 0),
    shieldingTransfer: String(counters['ShieldingTransfer'] || 0),
    unshieldingTransfer: String(counters['UnshieldingTransfer'] || 0),
    voteProposal: String(counters['VoteProposal'] || 0),
    ibcTransfer: String(counters['IbcTransfer'] || 0),
    withdraw: String(counters['Withdraw'] || 0),
    revealPk: String(counters['RevealPk'] || 0),
    redelegate: String(counters['Redelegate'] || 0),
  })

  const url = `${getIndexerUrl()}/api/v1/gas/estimate?${params.toString()}`
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Indexer HTTP ${res.status}`)
    const data = await res.json()
    // Basic validation and normalization
    const estimate: GasEstimate = {
      min: Number((data && (data.min ?? data.Min)) ?? 50000),
      avg: Number((data && (data.avg ?? data.Avg)) ?? 50000),
      max: Number((data && (data.max ?? data.Max)) ?? 50000),
      totalEstimates: Number((data && (data.totalEstimates ?? data.TotalEstimates)) ?? 0),
    }
    return estimate
  } catch (e) {
    console.error('[Indexer] fetchGasEstimateForKinds failed', e)
    return { min: 50000, avg: 50000, max: 50000, totalEstimates: 0 }
  }
}

export async function fetchGasPriceTable(): Promise<GasPriceEntry[]> {
  const url = `${getIndexerUrl()}/api/v1/gas/price`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Indexer HTTP ${res.status}`)
  const data = await res.json()
  if (!Array.isArray(data)) return []
  return data.map((entry: any) => ({ token: String(entry.token), gasPrice: entry.gasPrice }))
}


