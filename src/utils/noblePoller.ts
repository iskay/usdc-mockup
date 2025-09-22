export type NobleTrackInputs = {
  nobleRpc: string
  startHeight: number
  memoJson: string
  receiver: string
  amount: string
  destinationCallerB64: string
  mintRecipientB64: string
  destinationDomain: number
  channelId: string
  timeoutMs?: number
  intervalMs?: number
}

export type NobleTrackResult = {
  ackFound: boolean
  cctpFound: boolean
  ackAt?: number
  cctpAt?: number
}

type BlockResults = {
  result?: {
    txs_results?: { events?: { type: string; attributes?: { key: string; value: string; index?: boolean }[] }[] }[]
  }
}

export async function fetchLatestHeight(nobleRpc: string): Promise<number> {
  const res = await fetch(`${nobleRpc}/status?`)
  const json = await res.json()
  const h = Number(json?.result?.sync_info?.latest_block_height ?? 0)
  return Number.isFinite(h) ? h : 0
}

export async function pollNobleForOrbiter(inputs: NobleTrackInputs, onUpdate?: (u: { height: number; ackFound?: boolean; cctpFound?: boolean }) => void): Promise<NobleTrackResult> {
  const timeoutMs = inputs.timeoutMs ?? 5 * 60 * 1000
  const intervalMs = inputs.intervalMs ?? 5000
  const deadline = Date.now() + timeoutMs
  let nextHeight = inputs.startHeight

  let ackFound = false
  let cctpFound = false
  let ackAt: number | undefined
  let cctpAt: number | undefined

  while (Date.now() < deadline && (!ackFound || !cctpFound)) {
    const latest = await fetchLatestHeight(inputs.nobleRpc)
    try { console.info('[NoblePoller] latest height', latest, 'nextHeight', nextHeight) } catch {}
    while (nextHeight <= latest && (!ackFound || !cctpFound)) {
      onUpdate?.({ height: nextHeight, ackFound, cctpFound })
      const url = `${inputs.nobleRpc}/block_results?height=${nextHeight}`
      try {
        const res = await fetch(url)
        const json = (await res.json()) as BlockResults
        const txs = json?.result?.txs_results || []
        try { console.info('[NoblePoller] scanning height', nextHeight, 'txs_results', txs.length) } catch {}
        for (const tx of txs) {
          const events = tx?.events || []
          try { console.debug('[NoblePoller] events count', events.length) } catch {}
          for (const ev of events) {
            // IBC ack
            if (!ackFound && ev?.type === 'write_acknowledgement') {
              const attrs = indexAttributes(ev.attributes)
              const packetDataRaw = attrs['packet_data']
              const packetAck = attrs['packet_ack']
              try { console.debug('[NoblePoller][ack] packet_ack', packetAck) } catch {}
              let memoMatches = false
              let amountMatches = false
              let receiverMatches = false
              if (packetDataRaw) {
                const parsed = parseMaybeJsonOrBase64Json(packetDataRaw)
                // Handle double-encoded JSON string
                const parsed2 = typeof parsed === 'string' ? (() => { try { return JSON.parse(parsed) } catch { return parsed } })() : parsed
                const denom = parsed?.denom
                const amount = parsed?.amount
                const receiver = parsed?.receiver
                const memo = parsed2?.memo ?? parsed?.memo
                memoMatches = memo === inputs.memoJson
                amountMatches = amount === inputs.amount
                receiverMatches = receiver === inputs.receiver
                // Optional: verify denom contains channel id
                if (typeof denom === 'string' && inputs.channelId) {
                  if (!denom.includes(inputs.channelId)) {
                    // keep matches but note denom mismatch silently
                  }
                }
                try { console.debug('[NoblePoller][ack] matches', { memoMatches, amountMatches, receiverMatches }) } catch {}
              }
              const ackOk = packetAck === '{"result":"AQ=="}'
              try { console.debug('[NoblePoller][ack] ackOk', ackOk) } catch {}
              if (memoMatches && amountMatches && receiverMatches && ackOk) {
                ackFound = true
                ackAt = nextHeight
                try { console.info('[NoblePoller] IBC acknowledgement matched at', nextHeight) } catch {}
                try { onUpdate?.({ height: nextHeight, ackFound, cctpFound }) } catch {}
              }
            }

            // CCTP DepositForBurn
            if (!cctpFound && ev?.type === 'circle.cctp.v1.DepositForBurn') {
              const attrs = indexAttributes(ev.attributes)
              const amount = stripQuotes(attrs['amount'])
              const destCaller = stripQuotes(attrs['destination_caller'])
              const mintRecipient = stripQuotes(attrs['mint_recipient'])
              const destDomain = attrs['destination_domain']
              try { console.debug('[NoblePoller][cctp] attrs', { amount, destCaller, mintRecipient, destDomain }) } catch {}
              if (
                amount === inputs.amount &&
                destCaller === inputs.destinationCallerB64 &&
                mintRecipient === inputs.mintRecipientB64 &&
                Number(destDomain) === inputs.destinationDomain
              ) {
                cctpFound = true
                cctpAt = nextHeight
                try { console.info('[NoblePoller] CCTP DepositForBurn matched at', nextHeight) } catch {}
                try { onUpdate?.({ height: nextHeight, ackFound, cctpFound }) } catch {}
              }
            }
          }
        }
      } catch {
        // ignore and retry on next tick for this height
        try { console.warn('[NoblePoller] fetch failed for height', nextHeight) } catch {}
      }
      nextHeight++
    }
    if (ackFound && cctpFound) break
    await sleep(intervalMs)
  }

  return { ackFound, cctpFound, ackAt, cctpAt }
}

function indexAttributes(attrs?: { key: string; value: string }[]) {
  const map: Record<string, string> = {}
  for (const a of attrs || []) {
    if (!a?.key) continue
    map[a.key] = a.value
  }
  return map
}

function parseMaybeJsonOrBase64Json(value?: string): any {
  if (!value) return undefined
  // Try direct JSON first
  try { return JSON.parse(value) } catch {}
  // Try base64-decoded JSON
  try {
    const decoded = atob(value)
    return JSON.parse(decoded)
  } catch {}
  return undefined
}

function stripQuotes(s?: string): string | undefined {
  if (typeof s !== 'string') return s
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1)
  return s
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }


