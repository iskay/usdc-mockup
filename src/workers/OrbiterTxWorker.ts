// Dedicated worker per transaction to poll Noble and Sepolia without interfering with other txs
export type StartParams = {
  id: string
  noble: {
    rpcUrl: string
    startHeight: number
    memoJson: string
    receiver: string
    amount: string
    destinationCallerB64: string
    mintRecipientB64: string
    destinationDomain: number
    channelId: string
    timeoutMs: number
    intervalMs: number
  }
  sepolia?: {
    rpcUrl: string
    usdcAddress: string
    recipient: string
    amountBaseUnits: string
    timeoutMs: number
    intervalMs: number
  }
}

export type WorkerEvent =
  | { type: 'update'; id: string; data: { stage?: string; nobleAckFound?: boolean; nobleCctpFound?: boolean } }
  | { type: 'complete'; id: string; data: { sepoliaHash?: string } }
  | { type: 'error'; id: string; error: string }

declare const self: Worker

async function httpJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function pollNoble(params: StartParams['noble'], onUpdate: (u: { ack?: boolean; cctp?: boolean }) => void): Promise<{ ackFound: boolean; cctpFound: boolean }> {
  let next = params.startHeight
  const endAt = Date.now() + params.timeoutMs
  let ackFound = false
  let cctpFound = false
  const ackOk = '{"result":"AQ=="}'
  while (Date.now() < endAt && (!ackFound || !cctpFound)) {
    const status = await httpJson(`${params.rpcUrl}/status`)
    const latest = Number(status.result.sync_info.latest_block_height)
    for (let h = next; h <= latest; h++) {
      const r = await httpJson(`${params.rpcUrl}/block_results?height=${h}`)
      const events = (r.result?.txs_results?.[0]?.events || []) as any[]
      for (const ev of events) {
        if (ev.type === 'write_acknowledgement') {
          const attrs = indexAttributes(ev.attributes)
          const packetDataRaw = attrs['packet_data']
          const packetAck = attrs['packet_ack']
          const parsed1 = parseMaybeJsonOrBase64Json(packetDataRaw)
          const parsed = typeof parsed1 === 'string' ? safeJson(parsed1) || {} : parsed1 || {}
          const memo: string | undefined = (parsed as any)?.memo
          const amount: string | undefined = (parsed as any)?.amount
          const receiver: string | undefined = (parsed as any)?.receiver
          const memoMatches = memo === params.memoJson
          const amountMatches = amount === params.amount
          const receiverMatches = receiver === params.receiver
          const ackOkMatch = packetAck === ackOk
          if (memoMatches && amountMatches && receiverMatches && ackOkMatch) { ackFound = true; onUpdate({ ack: true }) }
        } else if (ev.type === 'circle.cctp.v1.DepositForBurn') {
          const attrs = indexAttributes(ev.attributes)
          const amount = stripQuotes(attrs['amount'])
          const destCaller = stripQuotes(attrs['destination_caller'])
          const mintRecipient = stripQuotes(attrs['mint_recipient'])
          if (amount === params.amount && destCaller === params.destinationCallerB64 && mintRecipient === params.mintRecipientB64) {
            cctpFound = true; onUpdate({ cctp: true })
          }
        }
      }
      next = h + 1
    }
    if (ackFound && cctpFound) break
    await new Promise((r) => setTimeout(r, params.intervalMs))
  }
  return { ackFound, cctpFound }
}

async function postRpc(rpcUrl: string, body: any): Promise<any> {
  const res = await fetch(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`RPC ${res.status}`)
  return res.json()
}

async function pollSepolia(params: NonNullable<StartParams['sepolia']>): Promise<{ found: boolean; txHash?: string }> {
  const endAt = Date.now() + params.timeoutMs
  let fromBlock: number | null = null
  while (Date.now() < endAt) {
    try {
      const latestHex = (await postRpc(params.rpcUrl, { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] })).result as string
      const latest = parseInt(latestHex, 16)
      if (!Number.isFinite(latest)) throw new Error('invalid latest block')
      if (fromBlock == null) fromBlock = latest
      const resp = await postRpc(params.rpcUrl, {
        jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: `0x${latest.toString(16)}`,
          address: params.usdcAddress,
          topics: [
            '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
            '0x0000000000000000000000000000000000000000000000000000000000000000',
            `0x${params.recipient.replace('0x','').padStart(64,'0')}`,
          ],
        }],
      })
      const logs = Array.isArray(resp?.result) ? (resp.result as any[]) : []
      for (const log of logs) {
        const dataHex: string = log?.data || '0x0'
        let amount: bigint
        try { amount = BigInt(dataHex) } catch { amount = 0n }
        if (amount === BigInt(params.amountBaseUnits)) {
          return { found: true, txHash: log.transactionHash }
        }
      }
      fromBlock = latest + 1
    } catch {
      // ignore transient RPC issues
    }
    await new Promise((r) => setTimeout(r, params.intervalMs))
  }
  return { found: false }
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type: 'start'; payload: StartParams }
  if (msg.type !== 'start') return
  const { id, noble, sepolia } = msg.payload
  try {
    const upd = (u: { ack?: boolean; cctp?: boolean }) => {
      const stage = u.cctp ? 'Forwarding to Sepolia via CCTP' : undefined
      self.postMessage({ type: 'update', id, data: { stage, nobleAckFound: !!u.ack, nobleCctpFound: !!u.cctp } } as WorkerEvent)
    }
    const nres = await pollNoble(noble, upd)
    if (!nres.cctpFound) {
      self.postMessage({ type: 'complete', id, data: {} } as WorkerEvent)
      return
    }
    if (sepolia) {
      const eres = await pollSepolia(sepolia)
      if (eres.found) {
        self.postMessage({ type: 'complete', id, data: { sepoliaHash: eres.txHash } } as WorkerEvent)
      } else {
        self.postMessage({ type: 'complete', id, data: {} } as WorkerEvent)
      }
    } else {
      self.postMessage({ type: 'complete', id, data: {} } as WorkerEvent)
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', id, error: String(err?.message || err) } as WorkerEvent)
  }
}

function indexAttributes(attrs?: { key: string; value: string }[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const a of attrs || []) {
    if (!a?.key) continue
    map[a.key] = a.value
  }
  return map
}

function parseMaybeJsonOrBase64Json(value?: string): any {
  if (!value) return undefined
  try { return JSON.parse(value) } catch {}
  try { const decoded = atob(value); return JSON.parse(decoded) } catch {}
  return undefined
}

function safeJson(s: string): any | undefined { try { return JSON.parse(s) } catch { return undefined } }
function stripQuotes(s?: string): string | undefined { if (typeof s !== 'string') return s; if (s.startsWith('"') && s.endsWith('"')) return s.slice(1,-1); return s }


