import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'

// If using Vite, inline build is recommended per SDK docs
// eslint-disable-next-line import/no-unresolved
import { initSdk } from '@namada/sdk-multicore/inline'

// Guard against double initialization in React StrictMode (dev)
let sdkInitPromise: Promise<any> | null = null
let initLogged = false
const initSdkOnce = (options: any) => {
  if (!sdkInitPromise) {
    sdkInitPromise = initSdk(options).catch((e) => {
      // Allow retry on next call if init failed
      sdkInitPromise = null
      throw e
    })
  }
  return sdkInitPromise
}

type NamadaSdkContextValue = {
  sdk: any | null
  tx: any | null
  rpc: any | null
  signing: any | null
  isReady: boolean
  error: string | null
}

const NamadaSdkContext = createContext<NamadaSdkContextValue | null>(null)

type ProviderProps = {
  children: React.ReactNode
  rpcUrl?: string
  token?: string
  maspIndexerUrl?: string
  dbName?: string
}

export const NamadaSdkProvider: React.FC<ProviderProps> = ({ children, rpcUrl, token, maspIndexerUrl, dbName }) => {
  const [state, setState] = useState<NamadaSdkContextValue>({
    sdk: null,
    tx: null,
    rpc: null,
    signing: null,
    isReady: false,
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    const initialize = async () => {
      try {
        const effectiveRpcUrl = rpcUrl || import.meta.env.VITE_NAMADA_RPC_URL || 'https://rpc.testnet.siuuu.click'
        const effectiveToken = token || import.meta.env.VITE_NAMADA_NAM_TOKEN || 'tnam1q9gr66cvu4hrzm0sd5kmlnjje82gs3xlfg3v6nu7'
        const effectiveMaspIndexerUrl = maspIndexerUrl || import.meta.env.VITE_NAMADA_MASP_INDEXER_URL || 'https://masp.testnet.siuuu.click'
        const effectiveDbName = dbName || import.meta.env.VITE_NAMADA_DB_NAME || 'usdcdelivery'
        
        const sdkOptions: any = { rpcUrl: effectiveRpcUrl, token: effectiveToken }
        if (effectiveMaspIndexerUrl) sdkOptions.maspIndexerUrl = effectiveMaspIndexerUrl
        if (effectiveDbName) sdkOptions.dbName = effectiveDbName
        const sdk = await initSdkOnce(sdkOptions)
        if (cancelled) return
        const { tx, rpc, signing } = sdk as any
        setState({ sdk, tx, rpc, signing, isReady: true, error: null })
        // Basic diagnostics for init success
        if (!initLogged) {
          console.info('[Namada SDK] Initialized', {
            rpcUrl: effectiveRpcUrl,
            maspIndexerUrl: effectiveMaspIndexerUrl,
            dbName: effectiveDbName,
            hasRpc: !!rpc,
            hasTx: !!tx,
            hasSigning: !!signing,
            crossOriginIsolated: self.crossOriginIsolated,
            hasSAB: typeof SharedArrayBuffer !== 'undefined',
          })
          initLogged = true
        }
      } catch (e: any) {
        if (cancelled) return
        const message = e?.message || 'Failed to initialize Namada SDK'
        setState((prev) => ({ ...prev, isReady: false, error: message }))
        if (!initLogged) {
          console.error('[Namada SDK] Initialization error:', e)
          initLogged = true
        }
      }
    }

    initialize()
    return () => {
      cancelled = true
    }
  }, [rpcUrl, token, maspIndexerUrl, dbName])

  const value = useMemo(() => state, [state])

  return <NamadaSdkContext.Provider value={value}>{children}</NamadaSdkContext.Provider>
}

export function useNamadaSdk() {
  const ctx = useContext(NamadaSdkContext)
  if (!ctx) throw new Error('useNamadaSdk must be used within NamadaSdkProvider')
  return ctx
}


