type Hex = `0x${string}`

const TRANSFER_TOPIC: Hex = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

function toPaddedTopicAddress(addr: string): Hex {
  const clean = addr.toLowerCase().replace(/^0x/, '')
  return `0x${clean.padStart(64, '0')}` as Hex
}

function toHexQuantity(n: bigint): Hex {
  return `0x${n.toString(16)}` as Hex
}

export type EvmPollInputs = {
  rpcUrl: string
  usdcAddress: string
  recipient: string
  amountBaseUnits: string
  fromBlock?: bigint
  timeoutMs?: number
  intervalMs?: number
}

export type EvmPollResult = {
  found: boolean
  txHash?: string
  blockNumber?: bigint
}

export async function pollSepoliaUsdcMint(inputs: EvmPollInputs, onUpdate?: (u: { latest?: bigint; scannedFrom?: bigint; scannedTo?: bigint }) => void): Promise<EvmPollResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), inputs.timeoutMs ?? 5 * 60 * 1000)
  const intervalMs = inputs.intervalMs ?? 5000
  try {
    const zero = '0x0000000000000000000000000000000000000000'
    let fromBlock = inputs.fromBlock ?? await fetchLatestBlock(inputs.rpcUrl)

    while (true) {
      const latest = await fetchLatestBlock(inputs.rpcUrl)
      onUpdate?.({ latest, scannedFrom: fromBlock, scannedTo: latest })
      if (latest < fromBlock) {
        await sleep(intervalMs)
        continue
      }

      const logs = await ethGetLogs(inputs.rpcUrl, {
        fromBlock: toHexQuantity(fromBlock),
        toBlock: toHexQuantity(latest),
        address: inputs.usdcAddress,
        topics: [
          TRANSFER_TOPIC,
          toPaddedTopicAddress(zero),
          toPaddedTopicAddress(inputs.recipient),
        ],
      })

      for (const log of logs) {
        // data is uint256 value (32 bytes)
        const value = BigInt(log.data as string)
        if (value === BigInt(inputs.amountBaseUnits)) {
          return { found: true, txHash: log.transactionHash as string, blockNumber: BigInt(log.blockNumber as string) }
        }
      }

      fromBlock = latest + 1n
      await sleep(intervalMs)
    }
  } catch (e) {
    if ((e as any).name === 'AbortError') {
      return { found: false }
    }
    return { found: false }
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchLatestBlock(rpcUrl: string): Promise<bigint> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
  })
  const json = await res.json()
  return BigInt(json.result as string)
}

async function ethGetLogs(rpcUrl: string, filter: any) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [filter] }),
  })
  const json = await res.json()
  return (json.result as any[]) || []
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }


