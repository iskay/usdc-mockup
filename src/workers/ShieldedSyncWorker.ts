// Minimal worker to run shielded sync off the main thread
// Avoids Atomics.wait errors on main thread

import { initSdk } from '@namada/sdk-multicore/inline'
import { SdkEvents } from '@namada/sdk-multicore'

type InitMsg = {
  type: 'init'
  payload: { rpcUrl: string; token: string; maspIndexerUrl?: string; paramsUrl?: string }
}

type SyncMsg = {
  type: 'sync'
  payload: { vks: { key: string; birthday: number }[]; chainId: string }
}

type InMsg = InitMsg | SyncMsg

let sdk: any | undefined

const handleInit = async (m: InitMsg) => {
  sdk = await initSdk({
    rpcUrl: m.payload.rpcUrl,
    token: m.payload.token,
    maspIndexerUrl: m.payload.maspIndexerUrl || undefined,
  })
  // Forward SDK progress events to main thread
  addEventListener(SdkEvents.ProgressBarStarted, (e) => {
    const ev = e as CustomEvent<string>
    postMessage({ type: 'progress', payload: JSON.parse(ev.detail) })
  })
  addEventListener(SdkEvents.ProgressBarIncremented, (e) => {
    const ev = e as CustomEvent<string>
    postMessage({ type: 'progress', payload: JSON.parse(ev.detail) })
  })
  addEventListener(SdkEvents.ProgressBarFinished, (e) => {
    const ev = e as CustomEvent<string>
    postMessage({ type: 'progress', payload: JSON.parse(ev.detail) })
  })
  postMessage({ type: 'init-done' })
}

const handleSync = async (m: SyncMsg) => {
  if (!sdk) throw new Error('SDK not initialized in worker')
  try {
    await sdk.rpc.shieldedSync(m.payload.vks, m.payload.chainId)
    postMessage({ type: 'sync-done' })
  } catch (e: any) {
    postMessage({ type: 'sync-error', error: e?.message ?? String(e) })
  }
}

self.onmessage = (event: MessageEvent<InMsg>) => {
  const msg = event.data
  if (msg.type === 'init') {
    handleInit(msg).catch((e) => postMessage({ type: 'init-error', error: e?.message ?? String(e) }))
  } else if (msg.type === 'sync') {
    handleSync(msg)
  }
}


