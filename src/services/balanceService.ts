import { ethers } from 'ethers'
import BigNumber from 'bignumber.js'
import { getUsdcAddress, getPrimaryRpcUrl } from '../utils/chain'
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
  chainKey?: string // For EVM balance fetching
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
              await updateEvmUsdc(opts.chainKey || 'sepolia')
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

  const updateEvmUsdc = async (chainKey: string = 'sepolia') => {
    try { console.info('[BalanceSvc][evmUsdc] start (external RPC) for chain:', chainKey) } catch {}
    const usdc = getUsdcAddress(chainKey)
    const rpcUrl = getPrimaryRpcUrl(chainKey)
    if (!usdc || !rpcUrl) {
      try { console.info('[BalanceSvc][evmUsdc] missing config for chain:', chainKey) } catch {}
      return
    }
    
    // Find any EVM address since all EVM chains share the same MetaMask address
    const evmAddresses = [
      state.addresses.ethereum,
      state.addresses.base,
      state.addresses.polygon,
      state.addresses.arbitrum,
      state.addresses.sepolia
    ]
    const addr = evmAddresses.find(addr => addr && typeof addr === 'string' && addr.length >= 42)
    
    if (!addr) {
      try { console.info('[BalanceSvc][evmUsdc] no EVM address found in state for any chain') } catch {}
      return
    }
    const provider = new ethers.JsonRpcProvider(rpcUrl)
    const c = new ethers.Contract(usdc, ['function balanceOf(address) view returns (uint256)'], provider)
    const bal = await c.balanceOf(addr)
    const formatted = new BigNumber(ethers.formatUnits(bal, 6)).toFixed(6)
    dispatch({ type: 'MERGE_BALANCES', payload: { [chainKey]: { usdc: formatted } } })
    try { console.info('[BalanceSvc][evmUsdc] done (external RPC)', formatted) } catch {}
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
      // Find the VK matching the currently selected shielded account; fallback to first VK
      const accounts: any[] = await (getNamadaAccounts as any)()
      const currentShieldedAddress = state.addresses.namada.shielded
      let selectedAccount = null
      if (currentShieldedAddress) {
        selectedAccount = (accounts || []).find((a) => a?.address === currentShieldedAddress && typeof a?.viewingKey === 'string' && a.viewingKey.length > 0)
        try { console.info('[BalanceSvc][shieldedSync] selected account by address:', currentShieldedAddress.slice(0, 12) + '...') } catch {}
      }
      if (!selectedAccount) {
        selectedAccount = (accounts || []).find((a) => typeof a?.viewingKey === 'string' && a.viewingKey.length > 0)
        try { console.info('[BalanceSvc][shieldedSync] using fallback account (first with viewing key)') } catch {}
      }
      if (!selectedAccount) { try { console.info('[BalanceSvc][shieldedSync] no viewing key found') } catch {}; return }
      try {
        const vk = String(selectedAccount.viewingKey)
        const vkDisp = vk.length > 24 ? vk.slice(0, 12) + '...' + vk.slice(-8) : vk
        console.info('[BalanceSvc][shieldedSync] using viewing key:', vkDisp)
      } catch {}
      await runShieldedSync({
        sdk: sdk as any,
        viewingKeys: [{ key: String(selectedAccount.viewingKey), birthday: 0 }],
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
      
      // Find the account that matches the current selected shielded address
      const currentShieldedAddress = state.addresses.namada.shielded
      let selectedAccount = null
      
      if (currentShieldedAddress) {
        // Try to find the account by shielded address
        selectedAccount = (accounts || []).find((a) => a?.address === currentShieldedAddress && typeof a?.viewingKey === 'string' && a.viewingKey.length > 0)
        try { console.info('[BalanceSvc][shieldedBalances] looking for account with shielded address:', currentShieldedAddress.slice(0, 12) + '...') } catch {}
      }
      
      // Fallback to first account with viewing key if current account not found
      if (!selectedAccount) {
        selectedAccount = (accounts || []).find((a) => typeof a?.viewingKey === 'string' && a.viewingKey.length > 0)
        try { console.info('[BalanceSvc][shieldedBalances] using fallback account (first with viewing key)') } catch {}
      }
      
      if (!selectedAccount) { 
        try { console.info('[BalanceSvc][shieldedBalances] no viewing key found') } catch {}
        return 
      }
      
      try {
        console.info('[BalanceSvc][shieldedBalances] fetching balances using viewing key for account:', selectedAccount.address?.slice(0, 12) + '...')
        const vk = String(selectedAccount.viewingKey)
        const vkDisp = vk.length > 24 ? vk.slice(0, 12) + '...' + vk.slice(-8) : vk
        console.info('[BalanceSvc][shieldedBalances] viewing key:', vkDisp)
      } catch {}
      const balances = await fetchShieldedBalances(
        sdk as any,
        String(selectedAccount.viewingKey),
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


