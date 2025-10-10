import type { Sdk } from '@namada/sdk-multicore'
import { SdkEvents, ProgressBarNames } from '@namada/sdk-multicore'
// @ts-ignore - vite worker import
import ShieldedSyncWorker from '../workers/ShieldedSyncWorker?worker'
import type { NamadaKeychainAccount } from './namada'

export type DatedViewingKey = { key: string; birthday: number }

export async function fetchChainIdFromRpc(rpcUrl: string): Promise<string> {
  const res = await fetch(`${rpcUrl}/status`).then(r => r.json()).catch(() => null)
  const id = res?.result?.node_info?.network
  if (typeof id === 'string' && id.length > 0) return id
  throw new Error('Failed to fetch chain id from RPC')
}

/**
 * Fetch block height by timestamp from the Namada indexer
 * This is used to convert account creation timestamps to block heights for birthday optimization
 */
export async function fetchBlockHeightByTimestamp(timestamp: number): Promise<number> {
  try {
    // Use the same indexer URL that's used elsewhere in the app
    const indexerUrl = import.meta.env.VITE_NAMADA_INDEXER_URL as string
    if (!indexerUrl) {
      throw new Error('Indexer URL not configured')
    }
    
    // Convert timestamp to seconds (if it's in milliseconds)
    const timestampSeconds = timestamp > 1000000000000 ? Math.floor(timestamp / 1000) : timestamp
    
    const response = await fetch(`${indexerUrl}/block/height/by_timestamp/${timestampSeconds}`)
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Block not found for timestamp')
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    
    const data = await response.json()
    const height = data?.height
    
    if (typeof height !== 'number' || height < 0) {
      throw new Error('Invalid height returned from indexer')
    }
    
    return height
  } catch (error) {
    console.warn('Failed to fetch block height by timestamp:', error)
    throw error
  }
}

/**
 * Calculate the birthday (block height) for a given account
 * For generated keys, converts the creation timestamp to block height
 * For imported keys, returns 0 (full sync required)
 */
export async function calculateBirthday(account: NamadaKeychainAccount): Promise<number> {
  // For imported keys or accounts without timestamp, always sync from genesis
  if (account.source !== "generated" || !account.timestamp) {
    return 0
  }
  
  try {
    const height = await fetchBlockHeightByTimestamp(account.timestamp)
    console.info(`[Birthday] Account ${account.address?.slice(0, 12)}... birthday: block ${height}`)
    return height
  } catch (error) {
    console.warn(`[Birthday] Failed to fetch block height for account ${account.address?.slice(0, 12)}..., falling back to height 0:`, error)
    return 0
  }
}

type EnsureMaspReadyParams = {
  sdk: Sdk
  chainId: string
  paramsUrl?: string
  dbName?: string
}

export async function ensureMaspReady({ sdk, chainId, paramsUrl }: EnsureMaspReadyParams): Promise<void> {
  const masp = sdk.masp
  const has = await masp.hasMaspParams()
  if (!has) {
    await masp.fetchAndStoreMaspParams(paramsUrl)
  }
  await masp.loadMaspParams('', chainId)
}

type RunShieldedSyncParams = {
  sdk: Sdk
  viewingKeys: DatedViewingKey[]
  chainId: string
  onProgress?: (progress01: number) => void
  maspIndexerUrl?: string
}

export async function runShieldedSync({ sdk, viewingKeys, chainId, onProgress, maspIndexerUrl }: RunShieldedSyncParams): Promise<void> {
  let handlerStarted: ((e: Event) => void) | null = null
  let handlerIncr: ((e: Event) => void) | null = null
  let handlerFinished: ((e: Event) => void) | null = null

  if (onProgress) {
    handlerStarted = (e: Event) => {
      const ev = e as CustomEvent<string>
      try {
        const data = JSON.parse(ev.detail)
        if (data.name === ProgressBarNames.Fetched) {
          onProgress(0)
        }
      } catch {}
    }
    handlerIncr = (e: Event) => {
      const ev = e as CustomEvent<string>
      try {
        const data = JSON.parse(ev.detail)
        if (data.name === ProgressBarNames.Fetched) {
          const { current, total } = data
          const perc = total === 0 ? 0 : Math.max(0, Math.min(1, current / total))
          onProgress(perc)
        }
      } catch {}
    }
    handlerFinished = (e: Event) => {
      const ev = e as CustomEvent<string>
      try {
        const data = JSON.parse(ev.detail)
        if (data.name === ProgressBarNames.Fetched) {
          onProgress(1)
        }
      } catch {}
    }

    addEventListener(SdkEvents.ProgressBarStarted, handlerStarted as EventListener)
    addEventListener(SdkEvents.ProgressBarIncremented, handlerIncr as EventListener)
    addEventListener(SdkEvents.ProgressBarFinished, handlerFinished as EventListener)
  }

  // Run sync in a worker to avoid Atomics.wait errors on main thread
  const worker: Worker = new ShieldedSyncWorker()
  let onWorkerProgress: ((ev: MessageEvent) => void) | null = null
  try {
    // Persistent progress listener
    onWorkerProgress = (ev: MessageEvent) => {
      const { type, payload } = ev.data || {}
      if (type === 'progress' && onProgress) {
        if (payload?.name === ProgressBarNames.Fetched && typeof payload?.current === 'number' && typeof payload?.total === 'number') {
          const perc = payload.total === 0 ? 0 : Math.max(0, Math.min(1, payload.current / payload.total))
          onProgress(perc)
        }
      }
    }
    worker.addEventListener('message', onWorkerProgress as EventListener)

    const initPromise = new Promise<void>((resolve, reject) => {
      const onMessage = (ev: MessageEvent) => {
        const { type, error } = ev.data || {}
        if (type === 'init-done') {
          worker.removeEventListener('message', onMessage as EventListener)
          resolve()
        } else if (type === 'init-error') {
          worker.removeEventListener('message', onMessage as EventListener)
          reject(new Error(error || 'Worker init failed'))
        }
      }
      worker.addEventListener('message', onMessage as EventListener)
    })

    worker.postMessage({ type: 'init', payload: { rpcUrl: (sdk as any).url, token: (sdk as any).nativeToken, maspIndexerUrl } })
    await initPromise

    const syncPromise = new Promise<void>((resolve, reject) => {
      const onMessage = (ev: MessageEvent) => {
        const { type, error } = ev.data || {}
        if (type === 'sync-done') {
          worker.removeEventListener('message', onMessage as EventListener)
          resolve()
        } else if (type === 'sync-error') {
          worker.removeEventListener('message', onMessage as EventListener)
          reject(new Error(error || 'Worker sync failed'))
        }
      }
      worker.addEventListener('message', onMessage as EventListener)
    })

    worker.postMessage({ type: 'sync', payload: { vks: viewingKeys, chainId } })
    await syncPromise
  } finally {
    worker.terminate()
    // Cleanup progress listener
    if (onWorkerProgress) {
      worker.removeEventListener('message', onWorkerProgress as EventListener)
      onWorkerProgress = null
    }
    if (handlerStarted) removeEventListener(SdkEvents.ProgressBarStarted, handlerStarted as EventListener)
    if (handlerIncr) removeEventListener(SdkEvents.ProgressBarIncremented, handlerIncr as EventListener)
    if (handlerFinished) removeEventListener(SdkEvents.ProgressBarFinished, handlerFinished as EventListener)
  }
}

export async function clearShieldedContext(sdk: Sdk, chainId: string): Promise<void> {
  await sdk.masp.clearShieldedContext(chainId)
}


