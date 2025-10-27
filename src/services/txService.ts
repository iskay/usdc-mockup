// Transaction service factory (not a React hook). Inject dispatch from component scope.
import { pollNobleForDeposit, fetchLatestHeight as fetchNobleLatestHeight } from '../utils/noblePoller'
import { pollNamadaForDeposit, fetchLatestHeight as fetchNamadaLatestHeight } from '../utils/namadaPoller'

export type DepositTrackContext = {
  txId: string
  amountUsdc: string // human units
  forwardingAddress: string // noble bech32
  namadaReceiver: string // tnam...
  sepoliaHash: string
}

export type SendTrackContext = {
  txId: string
  stage?: string
  memoJson: string
  receiver: string
  amountMinDenom: string
  destinationCallerB64: string
  mintRecipientB64: string
  channelId: string
  sepoliaRecipient: string
  sepoliaAmountMinDenom: string
}

export type ShieldTrackContext = {
  txId: string
  amount: string
  tokenSymbol: 'USDC' | 'NAM'
  namadaHash?: string
  namadaChainId?: string
}

const pollingJobs = new Map<string, AbortController>()

export function createTxService(dispatch: (action: any) => void) {

  const createTransaction = (tx: any): string => {
    const id = tx.id || `${tx.kind}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const now = Date.now()
    dispatch({ type: 'UPSERT_TRANSACTION', payload: { ...tx, id, createdAt: tx.createdAt ?? now, updatedAt: now } })
    return id
  }

  const updateTransaction = (id: string, changes: any) => {
    dispatch({ type: 'UPDATE_TRANSACTION', payload: { id, changes } })
  }

  const stopTracking = (id: string) => {
    const ctrl = pollingJobs.get(id)
    if (ctrl) {
      try { ctrl.abort() } catch {}
      pollingJobs.delete(id)
    }
  }

  const trackDeposit = async (ctx: DepositTrackContext) => {
    const nobleRpc = import.meta.env.VITE_NOBLE_RPC as string
    const namadaRpc = import.meta.env.VITE_NAMADA_RPC_URL as string
    try { console.info('[TxService][Deposit] start', { txId: ctx.txId, amountUsdc: ctx.amountUsdc, forwardingAddress: ctx.forwardingAddress, namadaReceiver: ctx.namadaReceiver, nobleRpc: !!nobleRpc, namadaRpc: !!namadaRpc }) } catch {}
    if (!nobleRpc) {
      try { console.warn('[TxService][Deposit] missing VITE_NOBLE_RPC; cannot start Noble poller') } catch {}
      return
    }

    const abort = new AbortController()
    pollingJobs.set(ctx.txId, abort)
    try {
      // Set initial stage
      dispatch({ type: 'SET_TRANSACTION_STAGE', payload: { id: ctx.txId, stage: 'Burned on EVM' } })
      dispatch({ type: 'SET_TRANSACTION_STATUS', payload: { id: ctx.txId, status: 'pending' } })
      dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: ctx.txId, changes: { sepoliaHash: ctx.sepoliaHash } } })

      const startHeight = (await fetchNobleLatestHeight(nobleRpc)) - 20
      try { console.info('[TxService][Deposit] Noble poll starting', { startHeight }) } catch {}
      const expectedAmountUusdc = `${Math.round(Number(ctx.amountUsdc) * 1e6)}uusdc`

      const nobleRes = await pollNobleForDeposit({
        nobleRpc,
        startHeight,
        forwardingAddress: ctx.forwardingAddress,
        expectedAmountUusdc,
        namadaReceiver: ctx.namadaReceiver,
        timeoutMs: 30 * 60 * 1000,
        intervalMs: 5000,
      }, async (u) => {
        if (abort.signal.aborted) return
        if (u.receivedFound) {
          try { console.info('[TxService][Deposit] Noble coin_received found') } catch {}
          dispatch({ type: 'SET_TRANSACTION_STAGE', payload: { id: ctx.txId, stage: 'Received on Noble' } })
        }
        if (u.forwardFound) {
          try { console.info('[TxService][Deposit] Noble ibc_transfer found (forwarding)') } catch {}
          dispatch({ type: 'SET_TRANSACTION_STAGE', payload: { id: ctx.txId, stage: 'Forwarding to Namada' } })
        }
      })

      if (abort.signal.aborted) return

      // Handle Noble timeout / partial progress
      if (!nobleRes.receivedFound) {
        dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: ctx.txId, changes: { status: 'error', errorMessage: 'Timeout waiting for Noble deposit (coin_received). The EVM transaction may have failed or not been recognized.' } } })
        return
      }
      if (!nobleRes.forwardFound) {
        dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: ctx.txId, changes: { status: 'error', errorMessage: 'Timeout waiting for Noble forwarding (ibc_transfer) to Namada.' } } })
        return
      }

      if (!namadaRpc) {
        try { console.warn('[TxService][Deposit] missing VITE_NAMADA_RPC_URL; skipping Namada poller') } catch {}
        return
      }
      const namadaStart = (await fetchNamadaLatestHeight(namadaRpc)) - 20
      try { console.info('[TxService][Deposit] Namada poll starting', { namadaStart }) } catch {}
      const namadaRes = await pollNamadaForDeposit({
        namadaRpc,
        startHeight: namadaStart,
        forwardingAddress: ctx.forwardingAddress,
        namadaReceiver: ctx.namadaReceiver,
        expectedAmountUusdc: expectedAmountUusdc,
        denom: 'uusdc',
        timeoutMs: 30 * 60 * 1000,
        intervalMs: 5000,
      }, (u) => { /* optional progress */ })

      if (abort.signal.aborted) return

      if (namadaRes.ackFound) {
        try { console.info('[TxService][Deposit] Namada write_acknowledgement found', { namadaTxHash: namadaRes.namadaTxHash }) } catch {}
        dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: ctx.txId, changes: { namadaHash: namadaRes.namadaTxHash, stage: 'Received on Namada' } } })
        dispatch({ type: 'SET_TRANSACTION_STATUS', payload: { id: ctx.txId, status: 'success' } })
      } else {
        dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: ctx.txId, changes: { status: 'error', errorMessage: 'Timeout waiting for Namada acknowledgement (write_acknowledgement).' } } })
      }
    } catch (e: any) {
      try { console.warn('[TxService][Deposit] error', e) } catch {}
      dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: ctx.txId, changes: { status: 'error', errorMessage: e?.message || String(e) } } })
    } finally {
      try { console.info('[TxService][Deposit] finished for', ctx.txId) } catch {}
      pollingJobs.delete(ctx.txId)
    }
  }

  const trackSend = async (ctx: SendTrackContext) => {
    // Mirror OrbiterTxWorker orchestration here, but keep existing worker for now.
    // For Phase 1, we’ll just upsert initial stage and let BridgeForm’s worker push updates we reflect.
    if (ctx.stage) {
      dispatch({ type: 'SET_TRANSACTION_STAGE', payload: { id: ctx.txId, stage: ctx.stage } })
      dispatch({ type: 'SET_TRANSACTION_STATUS', payload: { id: ctx.txId, status: 'pending' } })
    }
  }

  const clearHistory = (opts?: { olderThanMs?: number }) => {
    dispatch({ type: 'CLEAR_COMPLETED_TRANSACTIONS', payload: opts })
    try {
      // If we later persist to localStorage, also wipe there; placeholder key name
      localStorage.removeItem('tx_history')
    } catch {}
  }

  const trackShield = async (ctx: ShieldTrackContext) => {
    dispatch({ type: 'UPSERT_TRANSACTION', payload: {
      id: ctx.txId,
      kind: 'shield',
      amount: ctx.amount,
      fromChain: 'namada',
      toChain: 'namada',
      status: 'pending',
      stage: 'Shield submitted',
      namadaHash: ctx.namadaHash,
      namadaChainId: ctx.namadaChainId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any })
    if (ctx.namadaHash) {
      dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: ctx.txId, changes: { status: 'success' } } })
    }
  }

  return { createTransaction, updateTransaction, trackDeposit, trackSend, trackShield, stopTracking, clearHistory }
}


