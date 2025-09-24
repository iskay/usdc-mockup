type BlockResults = {
  result?: {
    end_block_events?: { type: string; attributes?: { key: string; value: string; index?: boolean }[] }[]
  }
}

export async function fetchLatestHeight(namadaRpc: string): Promise<number> {
  const res = await fetch(`${namadaRpc}/status?`)
  const json = await res.json()
  const h = Number(json?.result?.sync_info?.latest_block_height ?? 0)
  return Number.isFinite(h) ? h : 0
}

export type NamadaDepositTrackInputs = {
  namadaRpc: string
  startHeight: number
  forwardingAddress: string
  namadaReceiver: string
  denom?: string
  timeoutMs?: number
  intervalMs?: number
}

export type NamadaDepositTrackResult = {
  ackFound: boolean
  foundAt?: number
  namadaTxHash?: string
}

export async function pollNamadaForDeposit(inputs: NamadaDepositTrackInputs, onUpdate?: (u: { height: number; ackFound?: boolean; namadaTxHash?: string }) => void): Promise<NamadaDepositTrackResult> {
  const timeoutMs = inputs.timeoutMs ?? 5 * 60 * 1000
  const intervalMs = inputs.intervalMs ?? 5000
  const deadline = Date.now() + timeoutMs
  let nextHeight = inputs.startHeight
  const denom = inputs.denom || 'uusdc'

  let ackFound = false
  let foundAt: number | undefined
  let namadaTxHash: string | undefined

  try { console.info('[NamadaDepositPoller] Starting poll', { namadaRpc: inputs.namadaRpc, startHeight: inputs.startHeight, forwardingAddress: inputs.forwardingAddress, namadaReceiver: inputs.namadaReceiver, denom }) } catch {}

  while (Date.now() < deadline && !ackFound) {
    const latest = await fetchLatestHeight(inputs.namadaRpc)
    try { console.info('[NamadaDepositPoller] latest height', latest, 'nextHeight', nextHeight) } catch {}
    while (nextHeight <= latest && !ackFound) {
      onUpdate?.({ height: nextHeight, ackFound })
      const url = `${inputs.namadaRpc}/block_results?height=${nextHeight}`
      try {
        const res = await fetch(url)
        const json = (await res.json()) as BlockResults
        const endEvents = json?.result?.end_block_events || []
        try { console.info('[NamadaDepositPoller] scanning height', nextHeight, 'end_block_events', endEvents.length) } catch {}
        for (const ev of endEvents) {
          if (ev?.type !== 'write_acknowledgement') continue
          const attrs = indexAttributes(ev.attributes)
          const ack = attrs['packet_ack']
          const pdata = attrs['packet_data']
          const inner = attrs['inner-tx-hash']
          const ok = ack === '{"result":"AQ=="}'
          try { console.debug('[NamadaDepositPoller][ack] packet_ack', ack, 'ok', ok) } catch {}
          if (!ok) continue
          try {
            const parsed = JSON.parse(pdata || '{}') as any
            const recv = parsed?.receiver
            const send = parsed?.sender
            const d = parsed?.denom
            const amount = parsed?.amount
            try { console.debug('[NamadaDepositPoller][ack] packet_data', { receiver: recv, sender: send, denom: d, amount }) } catch {}
            const receiverMatches = recv === inputs.namadaReceiver
            const senderMatches = send === inputs.forwardingAddress
            const denomMatches = d === denom
            try { console.debug('[NamadaDepositPoller][ack] matches', { receiverMatches, senderMatches, denomMatches }) } catch {}
            if (receiverMatches && senderMatches && denomMatches) {
              ackFound = true
              foundAt = nextHeight
              namadaTxHash = inner
              try { console.info('[NamadaDepositPoller] write_acknowledgement matched at', nextHeight, 'txHash', namadaTxHash) } catch {}
              onUpdate?.({ height: nextHeight, ackFound, namadaTxHash })
              break
            }
          } catch (e) {
            try { console.debug('[NamadaDepositPoller][ack] packet_data parse failed', e) } catch {}
          }
        }
      } catch (e) {
        try { console.warn('[NamadaDepositPoller] fetch failed for height', nextHeight, e) } catch {}
      }
      nextHeight++
    }
    if (ackFound) break
    await sleep(intervalMs)
  }

  try { console.info('[NamadaDepositPoller] Poll completed', { ackFound, foundAt, namadaTxHash }) } catch {}
  return { ackFound, foundAt, namadaTxHash }
}

function indexAttributes(attrs?: { key: string; value: string }[]) {
  const map: Record<string, string> = {}
  for (const a of attrs || []) {
    if (!a?.key) continue
    map[a.key] = a.value
  }
  return map
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }


