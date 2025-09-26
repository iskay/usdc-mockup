import { ethers } from 'ethers'
import BigNumber from 'bignumber.js'
import { getUSDCAddressFromRegistry, getNAMAddressFromRegistry, getNamadaUSDCBalance, getNamadaNAMBalance } from '../utils/namadaBalance'
import { ensureMaspReady, runShieldedSync } from '../utils/shieldedSync'
import { fetchShieldedBalances, formatMinDenom } from '../utils/shieldedBalance'
import { useAppState } from '../state/AppState'
import { useNamadaSdk } from '../state/NamadaSdkProvider'
import { useNamadaKeychain } from '../utils/namada'

export type BalanceKind = 'evmUsdc' | 'namadaTransparentUsdc' | 'namadaTransparentNam' | 'namadaShieldedBalances' | 'shieldedSync'

export type FetchBalancesOptions = {
  kinds: BalanceKind[]
  delayMs?: number
  force?: boolean
  onProgress?: (evt: { step: string; data?: any }) => void
  skipConnectionCheck?: boolean
}

const inFlight = new Map<BalanceKind, Promise<void>>()

export function useBalanceService() {
  const { state, dispatch } = useAppState()
  const { sdk } = useNamadaSdk()
  const { getAccounts: getNamadaAccounts } = useNamadaKeychain()

  const fetchBalances = async (opts: FetchBalancesOptions): Promise<void> => {
    const kinds = Array.from(new Set(opts.kinds))
    try { console.info('[BalanceSvc] fetchBalances called with kinds:', kinds) } catch {}
    if (opts.delayMs && opts.delayMs > 0) await new Promise((r) => setTimeout(r, opts.delayMs))

    const runKind = async (kind: BalanceKind) => {
      if (!opts.force && inFlight.has(kind)) return inFlight.get(kind)!
      const p = (async () => {
        try {
          switch (kind) {
            case 'evmUsdc':
              await updateEvmUsdc()
              break
            case 'namadaTransparentUsdc':
              await updateNamadaTransparent('usdc')
              break
            case 'namadaTransparentNam':
              await updateNamadaTransparent('nam')
              break
            case 'shieldedSync':
              await runShieldedSyncOnce(opts.onProgress, opts.skipConnectionCheck)
              break
            case 'namadaShieldedBalances':
              await updateNamadaShieldedBalances(opts.skipConnectionCheck)
              break
          }
        } finally {
          inFlight.delete(kind)
        }
      })()
      inFlight.set(kind, p)
      return p
    }

    // If shieldedSync requested, run first
    if (kinds.includes('shieldedSync')) await runKind('shieldedSync')

    // Then shielded balances if requested
    const rest = kinds.filter((k) => k !== 'shieldedSync')
    await Promise.all(rest.map(runKind))
  }

  const updateEvmUsdc = async () => {
    try { console.info('[BalanceSvc][evmUsdc] start') } catch {}
    const chain = 'sepolia'
    const usdc = (import.meta as any)?.env?.VITE_USDC_SEPOLIA as string
    if (!(window as any).ethereum || !usdc) return
    const provider = new ethers.BrowserProvider((window as any).ethereum)
    const signer = await provider.getSigner()
    const addr = await signer.getAddress()
    const c = new ethers.Contract(usdc, ['function balanceOf(address) view returns (uint256)'], provider)
    const bal = await c.balanceOf(addr)
    const formatted = new BigNumber(ethers.formatUnits(bal, 6)).toFixed(6)
    dispatch({ type: 'MERGE_BALANCES', payload: { [chain]: { usdc: formatted } } })
    try { console.info('[BalanceSvc][evmUsdc] done', formatted) } catch {}
  }

  const updateNamadaTransparent = async (token: 'usdc' | 'nam') => {
    try { console.info('[BalanceSvc][namadaTransparent]', token) } catch {}
    const addr = state.addresses.namada.transparent
    if (!addr) return
    if (token === 'usdc') {
      const res = await getNamadaUSDCBalance(addr)
      const formatted = res?.formattedBalance ?? '--'
      dispatch({ type: 'MERGE_BALANCES', payload: { namada: { usdcTransparent: formatted } } })
    } else {
      const res = await getNamadaNAMBalance(addr)
      const formatted = res?.formattedBalance ?? '--'
      dispatch({ type: 'MERGE_BALANCES', payload: { namada: { namTransparent: formatted } } })
    }
  }

  const runShieldedSyncOnce = async (onProgress?: (evt: { step: string; data?: any }) => void, skipConnectionCheck = false) => {
    if (!sdk) return
    if (!skipConnectionCheck && state.walletConnections.namada !== 'connected') { try { console.info('[BalanceSvc][shieldedSync] Namada not connected') } catch {}; return }
    if (state.isShieldedSyncing) { try { console.info('[BalanceSvc][shieldedSync] already running') } catch {}; return }
    dispatch({ type: 'SET_SHIELDED_SYNCING', payload: true })
    try {
      try { onProgress?.({ step: 'shieldedSyncStarted' }) } catch {}
      const chainId = await (async () => {
        const { fetchChainIdFromRpc } = await import('../utils/shieldedSync')
        return fetchChainIdFromRpc((sdk as any).url)
      })()
      const paramsUrl = (import.meta as any)?.env?.VITE_MASP_PARAMS_BASE_URL as string | undefined
      await ensureMaspReady({ sdk: sdk as any, chainId, paramsUrl })
      // Minimal VK discovery: rely on UI-integrated accounts from Keychain hook
      const accounts: any[] = await (getNamadaAccounts as any)()
      const first = (accounts || []).find((a) => typeof a?.viewingKey === 'string' && a.viewingKey.length > 0)
      if (!first) { try { console.info('[BalanceSvc][shieldedSync] no viewing key found') } catch {}; return }
      await runShieldedSync({
        sdk: sdk as any,
        viewingKeys: [{ key: String(first.viewingKey), birthday: 0 }],
        chainId,
        onProgress: (p: number) => {
          try { onProgress?.({ step: 'shieldedSyncProgress', data: Math.round(Math.max(0, Math.min(1, p)) * 100) }) } catch {}
        },
        maspIndexerUrl: import.meta.env.VITE_NAMADA_MASP_INDEXER_URL as string | undefined,
      })
    } finally {
      try { onProgress?.({ step: 'shieldedSyncFinished' }) } catch {}
      dispatch({ type: 'SET_SHIELDED_SYNCING', payload: false })
    }
  }

  const updateNamadaShieldedBalances = async (skipConnectionCheck = false) => {
    if (!sdk) return
    if (!skipConnectionCheck && state.walletConnections.namada !== 'connected') { try { console.info('[BalanceSvc][shieldedBalances] Namada not connected') } catch {}; return }
    if (state.isShieldedBalanceComputing) { try { console.info('[BalanceSvc][shieldedBalances] already computing') } catch {}; return }
    dispatch({ type: 'SET_SHIELDED_BALANCE_COMPUTING', payload: true })
    try { console.info('[BalanceSvc][shieldedBalances] setting isShieldedBalanceComputing to true') } catch {}
    try {
      const chainId = await (async () => {
        const { fetchChainIdFromRpc } = await import('../utils/shieldedSync')
        return fetchChainIdFromRpc((sdk as any).url)
      })()
      const [usdcAddr, namAddr] = await Promise.all([getUSDCAddressFromRegistry(), getNAMAddressFromRegistry()])
      const tokens = [usdcAddr, namAddr].filter((x): x is string => !!x)
      if (tokens.length === 0) {
        try { console.info('[BalanceSvc][shieldedBalances] no tokens found') } catch {}
        return
      }
      const accounts: any[] = await (getNamadaAccounts as any)()
      const first = (accounts || []).find((a) => typeof a?.viewingKey === 'string' && a.viewingKey.length > 0)
      if (!first) { 
        try { console.info('[BalanceSvc][shieldedBalances] no viewing key found') } catch {}
        return 
      }
      try { console.info('[BalanceSvc][shieldedBalances] fetching balances...') } catch {}
      const balances = await fetchShieldedBalances(
        sdk as any,
        String(first.viewingKey),
        tokens,
        chainId
      )
      const map = new Map<string, string>(balances)
      if (usdcAddr) dispatch({ type: 'MERGE_BALANCES', payload: { namada: { usdcShielded: formatMinDenom(map.get(usdcAddr) || '0', 'USDC') } } })
      if (namAddr) dispatch({ type: 'MERGE_BALANCES', payload: { namada: { namShielded: formatMinDenom(map.get(namAddr) || '0', 'NAM') } } })
      try { console.info('[BalanceSvc][shieldedBalances] completed successfully') } catch {}
    } catch (e) {
      try { console.warn('[BalanceSvc][shieldedBalances] error:', e) } catch {}
    } finally {
      dispatch({ type: 'SET_SHIELDED_BALANCE_COMPUTING', payload: false })
      try { console.info('[BalanceSvc][shieldedBalances] setting isShieldedBalanceComputing to false') } catch {}
    }
  }

  return { fetchBalances }
}


