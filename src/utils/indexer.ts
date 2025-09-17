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


