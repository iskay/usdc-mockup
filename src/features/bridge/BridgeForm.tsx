import React, { useCallback, useEffect, useRef, useState } from 'react'
import BigNumber from 'bignumber.js'
import { Card, CardHeader } from '../../components/ui/Card'
import { Tabs } from '../../components/ui/Tabs'
import { Button } from '../../components/ui/Button'
import { useAppState } from '../../state/AppState'
import { useToast } from '../../components/ui/Toast'
import Spinner from '../../components/ui/Spinner'
import { fetchUsdcBalanceForSelectedChain } from '../../utils/evmBalance'
import { getNamadaUSDCBalance, getNamadaNAMBalance } from '../../utils/namadaBalance'
import { useNamadaSdk } from '../../state/NamadaSdkProvider'
import { useNamadaKeychain } from '../../utils/namada'
import { fetchChainIdFromRpc } from '../../utils/shieldedSync'
import { useBalanceService } from '../../services/balanceService'
import { getUSDCAddressFromRegistry, getNAMAddressFromRegistry } from '../../utils/namadaBalance'
import { type GasConfig as ShieldGasConfig } from '../../utils/txShield'
import { validateForm } from './utils/validation'
import { useDepositFeeEstimate } from './hooks/useDepositFeeEstimate'
import { useSendFeeEstimate } from './hooks/useSendFeeEstimate'
import { useShieldFeeEstimate } from './hooks/useShieldFeeEstimate'
import MoreActionsMenu from './MoreActionsMenu'
import DepositSection from './sections/DepositSection'
import SendSection from './sections/SendSection'
import { debugOrbiterAction, clearShieldedContextAction, clearTxHistoryAction, sendNowViaOrbiterAction, shieldNowForTokenAction, startSepoliaDepositAction, connectNamadaAction } from './services/bridgeActions'

export const BridgeForm: React.FC = () => {
  const { state, dispatch } = useAppState()
  const { showToast } = useToast()
  const { fetchBalances } = useBalanceService()
  const [activeTab, setActiveTab] = useState('deposit')
  const [chain, setChain] = useState('sepolia')
  const [depositAmount, setDepositAmount] = useState('')
  const [depositAddress, setDepositAddress] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sendAddress, setSendAddress] = useState('')
  const [shieldSyncStatus, setShieldSyncStatus] = useState<'green' | 'yellow' | 'red'>('green')
  const [evmChainId, setEvmChainId] = useState<string | null>(null)
  const [shieldedSyncProgress, setShieldedSyncProgress] = useState<number | null>(null)
  const [usdcShieldedMinDenom, setUsdcShieldedMinDenom] = useState<string | null>(null)
  const [isAutoShieldedSyncing, setIsAutoShieldedSyncing] = useState(false)
  const [isShielding, setIsShielding] = useState(false)
  const [sendFeeEst, setSendFeeEst] = useState<string | null>(null)
  const [shieldFeeUsdc, setShieldFeeUsdc] = useState<string | null>(null)
  const [shieldFeeNam, setShieldFeeNam] = useState<string | null>(null)
  const [sendShieldedSyncProgress, setSendShieldedSyncProgress] = useState<number | null>(null)
  const [showMoreDropdown, setShowMoreDropdown] = useState(false)
  const [balanceRefreshCountdown, setBalanceRefreshCountdown] = useState<number | null>(null)
  const moreDropdownRef = useRef<HTMLDivElement | null>(null)
  const { sdk, rpc, isReady } = useNamadaSdk()
  const { getDefaultAccount, getAccounts: getNamadaAccounts, isAvailable: isNamadaAvailable } = useNamadaKeychain()

  // Gas estimation helper moved to utils

  // Hook-based fee estimates
  const depositFeeEstHook = useDepositFeeEstimate(chain, depositAmount, depositAddress)
  useEffect(() => { setDepositFeeEst(depositFeeEstHook) }, [depositFeeEstHook])
  const sendFeeEstHook = useSendFeeEstimate(isReady, sdk, sendAmount, sendAddress)
  useEffect(() => { setSendFeeEst(sendFeeEstHook) }, [sendFeeEstHook])
  const { shieldFeeUsdc: shieldFeeUsdcHook, shieldFeeNam: shieldFeeNamHook } = useShieldFeeEstimate(isReady, sdk, state.addresses.namada.transparent)
  useEffect(() => { setShieldFeeUsdc(shieldFeeUsdcHook); setShieldFeeNam(shieldFeeNamHook) }, [shieldFeeUsdcHook, shieldFeeNamHook])

  // Click-outside handler for More dropdown
  const handleDocumentMouseDown = useCallback((event: MouseEvent) => {
      if (moreDropdownRef.current && !moreDropdownRef.current.contains(event.target as Node)) {
        setShowMoreDropdown(false)
      }
  }, [])
  useEffect(() => {
    document.addEventListener('mousedown', handleDocumentMouseDown)
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown)
  }, [handleDocumentMouseDown])

  // Minimal trigger: on MetaMask connect update balances (evm + namada transparent)
  useEffect(() => {
    if (state.walletConnections.metamask === 'connected') {
      void fetchBalances({ kinds: ['evmUsdc', 'namadaTransparentUsdc', 'namadaTransparentNam'], delayMs: 250 })
    }
  }, [state.walletConnections.metamask])

  // Clear Namada-related local state when disconnecting
  useEffect(() => {
    if (state.walletConnections.namada === 'disconnected') {
      setShieldedSyncProgress(null)
      setUsdcShieldedMinDenom(null)
      setSendShieldedSyncProgress(null)
    }
  }, [state.walletConnections.namada])
  // Helpers: refresh shielded context and balances after a tx (delegate to balance service)
  const refreshShieldedAfterTx = async (_chainId: string) => {
    try {
      setShieldedSyncProgress(0)
      await fetchBalances({
        kinds: ['shieldedSync', 'namadaShieldedBalances'],
        delayMs: 0,
        force: true,
        onProgress: (evt) => {
          if (evt.step === 'shieldedSyncStarted') setShieldedSyncProgress(0)
          if (evt.step === 'shieldedSyncProgress' && typeof evt.data === 'number') setShieldedSyncProgress(evt.data)
          if (evt.step === 'shieldedSyncFinished') setShieldedSyncProgress(100)
        },
      })
      setShieldedSyncProgress(100)
    } finally {
      setTimeout(() => setShieldedSyncProgress(null), 1500)
    }
  }

  // Reusable function: triggers shielded sync with optional progress callback
  const triggerShieldedSync = async (onProgress?: (progress: number | null) => void) => {
    const setProgress = onProgress || setShieldedSyncProgress
    try {
      setProgress(0)
      await fetchBalances({
        kinds: ['shieldedSync', 'namadaShieldedBalances'],
        delayMs: 0,
        force: true,
        onProgress: (evt) => {
          if (evt.step === 'shieldedSyncStarted') setProgress(0)
          if (evt.step === 'shieldedSyncProgress' && typeof evt.data === 'number') setProgress(evt.data)
          if (evt.step === 'shieldedSyncFinished') setProgress(100)
        },
      })
      showToast({ title: 'Shielded Sync', message: 'Completed', variant: 'success' })
      setProgress(100)
    } catch (e: any) {
      console.error('[Shielded Sync] Error', e)
      showToast({ title: 'Shielded Sync', message: e?.message ?? 'Failed', variant: 'error' })
    } finally {
      setTimeout(() => setProgress(null), 1500)
    }
  }

  // Listen for a global trigger to start shielded sync (e.g., after connecting Namada)
  useEffect(() => {
    const handler = () => {
      if (state.isShieldedSyncing) return
      
      // Wait for SDK to be ready with retry mechanism
      const attemptSync = async (retryCount = 0) => {
        if (!isReady || !sdk) {
          if (retryCount < 10) { // Max 10 retries (5 seconds)
            setTimeout(() => attemptSync(retryCount + 1), 500)
            return
          }
          console.warn('[Shielded Sync] SDK not ready after retries, skipping auto sync')
          return
        }
        void triggerShieldedSync()
      }
      
      void attemptSync()
    }
    window.addEventListener('shielded-sync:trigger', handler as any)
    return () => window.removeEventListener('shielded-sync:trigger', handler as any)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isShieldedSyncing, isReady, sdk])

  // Helper: generic shielding flow (shared by USDC and NAM buttons)
  const shieldNowForToken = async (
    tokenAddress: string,
    display: string,
    opts?: { amountInBase?: BigNumber; gas?: ShieldGasConfig }
  ) => {
    if (isShielding) {
      showToast({ title: 'Shield', message: 'Shield transaction already in progress', variant: 'warning' })
      return
    }
    setIsShielding(true)
    try {
      await shieldNowForTokenAction(
        { sdk, state, dispatch, showToast, getNamadaAccounts },
        {
        tokenAddress,
          display,
          amountInBase: opts?.amountInBase,
          gas: opts?.gas,
          onComplete: async () => {
      // Delay then refresh with countdown
      setBalanceRefreshCountdown(10)
      const countdownInterval = setInterval(() => {
        setBalanceRefreshCountdown(prev => {
          if (prev === null || prev <= 1) {
            clearInterval(countdownInterval)
            return null
          }
          return prev - 1
        })
      }, 1000)
      
      setTimeout(async () => {
              const chainId = await fetchChainIdFromRpc((sdk as any).url)
        await refreshShieldedAfterTx(chainId)
        clearInterval(countdownInterval)
        setBalanceRefreshCountdown(null)
      }, 10000)
          }
        }
      )
    } finally {
      setIsShielding(false)
    }
  }


  // derive deposit/send views directly from global transactions
  const sendRunId = useRef(0)
  const currentDepositTxIdRef = useRef<string | null>(null)
  const currentSendTxIdRef = useRef<string | null>(null)
  const [depositFeeEst, setDepositFeeEst] = useState<string | null>(null)

  // Derived views from global transactions
  const inProgressDeposits = state.transactions.filter((t) => t.kind === 'deposit' && t.status !== 'success' && t.status !== 'error')
  const latestDepositTx = inProgressDeposits[0]
  const inProgressSends = state.transactions.filter((t) => t.kind === 'send' && t.status !== 'success' && t.status !== 'error')
  const latestSendTx = inProgressSends[0]

  // Initialize send form inputs from latest pending send tx (keep UX), no local status kept
  useEffect(() => {
    try {
      if (latestSendTx) {
        if (!currentSendTxIdRef.current) currentSendTxIdRef.current = latestSendTx.id
        if (latestSendTx.amount) setSendAmount(latestSendTx.amount)
        if (latestSendTx.destination) setSendAddress(latestSendTx.destination)
      }
    } catch {}
  }, [state.transactions, latestSendTx])

  const startSepoliaDeposit = async () => {
    try {
      const txId = currentDepositTxIdRef.current || `dep_${Date.now()}`
      if (!currentDepositTxIdRef.current) currentDepositTxIdRef.current = txId
      
      await startSepoliaDepositAction(
        { sdk, state, dispatch, showToast, getNamadaAccounts },
        {
          amount: depositAmount,
          destinationAddress: depositAddress,
          chain,
          getAvailableBalance,
          validateForm,
          txId
        }
      )
    } catch (err: any) {
      try {
        const txId = currentDepositTxIdRef.current
        if (txId) {
          dispatch({
            type: 'UPDATE_TRANSACTION',
            payload: { id: txId, changes: { status: 'error', errorMessage: err?.message ?? 'Sepolia depositForBurn failed' } },
          })
        }
      } catch {}
      showToast({ title: 'Deposit Failed', message: err?.message ?? 'Transaction failed', variant: 'error' })
    }
  }

  const getAvailableBalance = (chain: string) => {
    if (chain === 'namada') return state.balances.namada.usdcTransparent
    // @ts-ignore typed concrete keys in AppState
    return state.balances[chain]?.usdc || '0.00'
  }

  // Track EVM chain changes to trigger balance refetch (MetaMask docs recommend listening to chainChanged)
  // https://docs.metamask.io/wallet/how-to/manage-networks/detect-network/
  useEffect(() => {
    const setup = async () => {
      try {
        if (window.ethereum) {
          const cid: string = await window.ethereum.request({ method: 'eth_chainId' })
          console.debug('[EVM] Initial eth_chainId:', cid)
          setEvmChainId(cid)
        }
      } catch (e) {
        console.debug('[EVM] eth_chainId initial read failed:', e)
      }

      const handleChainChanged = (cid: string) => {
        console.debug('[EVM] chainChanged event:', cid)
        setEvmChainId(cid)
      }
      window.ethereum?.on?.('chainChanged', handleChainChanged)
      return () => {
        window.ethereum?.removeListener?.('chainChanged', handleChainChanged)
      }
    }
    const maybeCleanup = setup()
    return () => {
      // cleanup handled via returned function inside setup if any
    }
  }, [])

  // Fetch live USDC balance for selected EVM chain when connected
  useEffect(() => {
    const run = async () => {
      try {
        // Only fetch for EVM chains, require metamask connected and address present
        const isEvm = chain !== 'namada'
        const isConnected = state.walletConnections.metamask === 'connected'
        const addr = (state.addresses as any)[chain]
        console.debug('[EVM] Balance fetch trigger:', { chain, isEvm, isConnected, addr })

        // Validate address format before attempting to fetch balance
        const isValidAddress = addr && addr.length >= 42 && addr.startsWith('0x')
        if (!isEvm || !isConnected || !addr || !isValidAddress) {
          console.debug('[EVM] Skipping balance fetch - invalid conditions:', { isEvm, isConnected, hasAddr: !!addr, isValidAddress })
          return
        }

        const { formattedBalance } = await fetchUsdcBalanceForSelectedChain(chain, addr)
        // Merge update for the selected EVM chain only
        // @ts-ignore dynamic key is safe by design
        dispatch({ type: 'MERGE_BALANCES', payload: { [chain]: { usdc: formattedBalance } } })
      } catch (err: any) {
        // Optional user feedback
        console.warn('[EVM] Balance fetch error:', err)
        if (err?.message?.toLowerCase()?.includes('switch metamask')) {
          // Show a gentle hint to switch networks in MetaMask
          showToast({ title: 'Network', message: err.message, variant: 'warning' })
        }
      }
    }
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, state.walletConnections.metamask, state.addresses.ethereum, state.addresses.base, evmChainId])

  // Auto-refresh EVM USDC (MetaMask) every 5s
  useEffect(() => {
    // Only run on EVM chains and when connected
    const isEvm = chain !== 'namada'
    const isConnected = state.walletConnections.metamask === 'connected'
    const addr = (state.addresses as any)[chain]
    const isValidAddress = addr && addr.length >= 42 && addr.startsWith('0x')
    if (!isEvm || !isConnected || !isValidAddress) return

    const id = window.setInterval(() => {
      ;(async () => {
        try {
          const { formattedBalance } = await fetchUsdcBalanceForSelectedChain(chain, addr)
          // @ts-ignore dynamic key is safe by design
          dispatch({ type: 'MERGE_BALANCES', payload: { [chain]: { usdc: formattedBalance } } })
        } catch (err) {
          // Silent failure in interval; keep last known balance
        }
      })()
    }, 5000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chain, state.walletConnections.metamask, state.addresses.ethereum, state.addresses.base, evmChainId])

  // Fetch Namada USDC balance for transparent account when Namada is connected
  useEffect(() => {
    const run = async () => {
      try {
        if (state.walletConnections.namada !== 'connected') {
          // Clear balance when not connected
          dispatch({ type: 'MERGE_BALANCES', payload: { namada: { usdcTransparent: '--' } } })
          return
        }
        const addr = state.addresses.namada.transparent
        if (!addr) {
          // Clear balance when no address
          dispatch({ type: 'MERGE_BALANCES', payload: { namada: { usdcTransparent: '--' } } })
          return
        }
        const res = await getNamadaUSDCBalance(addr)
        if (!res) {
          // Show -- when balance unavailable
          dispatch({ type: 'MERGE_BALANCES', payload: { namada: { usdcTransparent: '--' } } })
          return
        }
        dispatch({ type: 'MERGE_BALANCES', payload: { namada: { usdcTransparent: res.formattedBalance } } })
      } catch {
        // Show -- on error
        dispatch({ type: 'MERGE_BALANCES', payload: { namada: { usdcTransparent: '--' } } })
      }
    }
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.walletConnections.namada, state.addresses.namada.transparent])

  // Auto-refresh Namada transparent USDC every 10s
  useEffect(() => {
    if (state.walletConnections.namada !== 'connected') return
    const addr = state.addresses.namada.transparent
    if (!addr) return

    const id = window.setInterval(() => {
      ;(async () => {
        try {
          const res = await getNamadaUSDCBalance(addr)
          if (res) {
            dispatch({ type: 'MERGE_BALANCES', payload: { namada: { usdcTransparent: res.formattedBalance } } })
          }
        } catch {
          // Silent; keep last known value
        }
      })()
    }, 10000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.walletConnections.namada, state.addresses.namada.transparent])

  // Fetch Namada NAM balance for transparent account when Namada is connected
  useEffect(() => {
    const run = async () => {
      try {
        if (state.walletConnections.namada !== 'connected') {
          dispatch({ type: 'MERGE_BALANCES', payload: { namada: { namTransparent: '--' } } })
          return
        }
        const addr = state.addresses.namada.transparent
        if (!addr) {
          dispatch({ type: 'MERGE_BALANCES', payload: { namada: { namTransparent: '--' } } })
          return
        }
        const res = await getNamadaNAMBalance(addr)
        if (!res) {
          dispatch({ type: 'MERGE_BALANCES', payload: { namada: { namTransparent: '--' } } })
          return
        }
        dispatch({ type: 'MERGE_BALANCES', payload: { namada: { namTransparent: res.formattedBalance } } })
      } catch {
        dispatch({ type: 'MERGE_BALANCES', payload: { namada: { namTransparent: '--' } } })
      }
    }
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.walletConnections.namada, state.addresses.namada.transparent])

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Tabs
              items={[{ key: 'deposit', label: 'Deposit' }, { key: 'send', label: 'Send' }]}
              value={activeTab}
              onChange={setActiveTab}
            />
      </div>
        </CardHeader>
        {activeTab === 'deposit' ? <DepositSection 
          chain={chain}
          setChain={setChain}
          depositAmount={depositAmount}
          setDepositAmount={setDepositAmount}
          depositAddress={depositAddress}
          setDepositAddress={setDepositAddress}
          latestDepositTx={latestDepositTx}
          depositFeeEst={depositFeeEst}
          availableBalance={getAvailableBalance(chain)}
          isMetaMaskConnected={state.walletConnections.metamask === 'connected'}
          onStartSepoliaDeposit={() => startSepoliaDeposit()}
          onStartDepositSimulation={() => console.log("Simulate Deposit placeholder")}
        /> : <SendSection 
          chain={chain}
          setChain={setChain}
          sendAmount={sendAmount}
          setSendAmount={setSendAmount}
          sendAddress={sendAddress}
          setSendAddress={setSendAddress}
          latestSendTx={latestSendTx}
          sendFeeEst={sendFeeEst}
          availableShielded={state.balances.namada.usdcShielded}
          isShieldedSyncing={!!state.isShieldedSyncing}
          isShieldedBalanceComputing={!!state.isShieldedBalanceComputing}
          sendShieldedSyncProgress={sendShieldedSyncProgress}
          isNamadaConnected={state.walletConnections.namada === 'connected'}
          onClickShieldedSync={() => { void triggerShieldedSync(setSendShieldedSyncProgress) }}
          onClickConnectNamada={() => { 
            void connectNamadaAction(
              { sdk, state, dispatch, showToast, getNamadaAccounts },
              {
                onSuccess: () => {
                  try { void fetchBalances({ kinds: ['namadaTransparentUsdc','namadaTransparentNam'], delayMs: 500 }) } catch {}
                }
              }
            )
          }}
          onClickSendNow={async () => {
            await sendNowViaOrbiterAction(
              { sdk, state, dispatch, showToast, getNamadaAccounts },
              { amountDisplay: sendAmount, destinationAddress: sendAddress, destinationChain: chain }
            )
          }}
          autoFillDisabled={state.walletConnections.metamask !== 'connected'}
          onClickAutoFill={() => {
              const metamaskAddress = state.addresses.ethereum || state.addresses.base || state.addresses.sepolia
              if (metamaskAddress) {
                setSendAddress(metamaskAddress)
              }
            }}
        />}
      </Card>

      {/* Shielded Balance Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between w-full">
            <div className="flex gap-2 items-center">
              <i className="fa-solid fa-shield text-title"></i>
              <div className="text-md font-semibold">USDC Balances on Namada</div>
            </div>
            <div className="flex items-center gap-3">
              {/* Sync status indicator - show spinner during auto-sync, dot otherwise */}
              <div className="flex items-center gap-2">
                {isAutoShieldedSyncing ? (
                  <Spinner size="sm" variant="accent" />
                ) : (
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${shieldSyncStatus === 'green'
                      ? 'bg-accent-green'
                      : shieldSyncStatus === 'yellow'
                        ? 'bg-yellow-500'
                        : 'bg-accent-red'
                      }`}
                  ></span>
                )}
              </div>
              <div className="flex items-center gap-3">
                {typeof balanceRefreshCountdown === 'number' ? (
                  <div className="text-xs text-button-text-inactive">
                    Refreshing balances in {balanceRefreshCountdown} seconds...
                  </div>
                ) : state.isShieldedSyncing && typeof shieldedSyncProgress === 'number' ? (
                  <div className="flex items-center gap-2 text-xs text-button-text-inactive">
                    <div className="w-32 h-2 bg-button-inactive/40 rounded-full overflow-hidden">
                      <div
                        className="h-2 bg-[#01daab] transition-all"
                        style={{ width: `${Math.max(0, Math.min(100, shieldedSyncProgress))}%` }}
                      />
                    </div>
                    <span>{Math.max(0, Math.min(100, shieldedSyncProgress))}%</span>
                  </div>
                ) : null}
                <Button
                  variant="ghost"
                  size="xs"
                  leftIcon={<i className="fas fa-rotate text-sm"></i>}
                  disabled={state.isShieldedSyncing || state.walletConnections.namada !== 'connected'}
                  onClick={() => { void triggerShieldedSync() }}
                >
                  Shielded Sync
                </Button>
                <div className="relative" ref={moreDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setShowMoreDropdown(!showMoreDropdown)}
                    className="text-button"
                  >
                    More
                  </button>
                  {showMoreDropdown && (
                    <MoreActionsMenu
                      onDebugOrbiter={async () => { try { await debugOrbiterAction({ sdk, state, dispatch, showToast, getNamadaAccounts }); setShowMoreDropdown(false) } catch {} }}
                      onClearShieldedContext={async () => {
                        try {
                          if (!isReady || !sdk) { showToast({ title: 'Namada SDK', message: 'SDK not ready', variant: 'error' }); return }
                          await clearShieldedContextAction({ sdk, state, dispatch, showToast, getNamadaAccounts })
                            setUsdcShieldedMinDenom(null)
                            dispatch({ type: 'MERGE_BALANCES', payload: { namada: { usdcShielded: '--', namShielded: '--' } } })
                            setShowMoreDropdown(false)
                          } catch (e: any) {
                            console.error('[Shielded Context] Clear error', e)
                            showToast({ title: 'Shielded Context', message: e?.message ?? 'Failed to clear', variant: 'error' })
                          }
                        }}
                      onClearTxHistory={async () => {
                        try {
                          await clearTxHistoryAction({ sdk, state, dispatch, showToast, getNamadaAccounts })
                            setShowMoreDropdown(false)
                          } catch (e: any) {
                            showToast({ title: 'Tx History', message: e?.message ?? 'Failed to clear', variant: 'error' })
                          }
                        }}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
        <div className="space-y-4">
          {/* USDC balance rows */}
          <div className="flex justify-start items-center gap-4">
            <div className="label-text mb-0 w-24 text-left">Transparent:</div>
            <div className="flex gap-2 items-center">
              <img src="/usdc-logo.svg" alt="USDC" className="h-5 w-5" />
              <div className="leading-none tracking-wide font-semibold text-[#01daab]">{state.balances.namada.usdcTransparent} USDC</div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="xs"
                leftIcon={<i className="fas fa-shield text-sm"></i>}
                disabled={isShielding}
                onClick={async () => {
                  try {
                    const usdcAddr = await getUSDCAddressFromRegistry()
                    if (!usdcAddr) {
                      showToast({ title: 'Shield', message: 'USDC address not found', variant: 'error' })
                      return
                    }
                    const available = state.balances.namada.usdcTransparent
                    const amt = typeof available === 'string' ? available.replace(/,/g, '') : String(available)
                    const n = new BigNumber(amt)
                    if (!n.isFinite() || n.lte(0)) {
                      showToast({ title: 'Shield', message: 'No transparent USDC available', variant: 'warning' })
                      return
                    }
                    const amountInBase = n.multipliedBy(1e6)
                    await shieldNowForToken(usdcAddr, 'USDC', { amountInBase })
                  } catch (e: any) {
                    console.error('[Shield USDC] Error', e)
                    showToast({ title: 'Shield', message: e?.message ?? 'Failed', variant: 'error' })
                    try { console.groupEnd() } catch { }
                  }
                }}
              >
                Shield Now
              </Button>
              {shieldFeeUsdc && (
                <div className="relative group inline-block ml-2">
                  <i className="fa-solid fa-gas-pump text-foreground-secondary/80 text-xs"></i>
                  <div className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block bg-card border border-border-muted text-foreground text-xs rounded-md px-2 py-1 whitespace-nowrap shadow-lg z-10">
                    Estimated fee: {shieldFeeUsdc}
                  </div>
                </div>
              )}
              {isShielding && <Spinner size="sm" variant="accent" />}
            </div>
          </div>
          <div className="flex justify-start items-center gap-4">
            <div className="label-text mb-0 pt-1 w-24 text-left">Shielded:</div>
            <div className="flex gap-2 items-center">
              <img src="/usdc-logo.svg" alt="USDC" className="h-5 w-5" />
              <div className="leading-none tracking-wide font-semibold text-[#e7bc59]">{state.balances.namada.usdcShielded} USDC</div>
              {state.isShieldedBalanceComputing && <Spinner size="sm" variant="accent" />}
            </div>
          </div>

          {/* NAM balance rows */}
          <div className="flex justify-start items-center gap-4 pt-4">
            <div className="label-text mb-0 w-24 text-left">Transparent:</div>
            <div className="flex gap-2 items-center">
              <img src="/namada-logo.svg" alt="NAM" className="h-5 w-5" />
              <div className="leading-none tracking-wide font-semibold text-[#01daab]">{state.balances.namada.namTransparent} NAM</div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="xs"
                leftIcon={<i className="fas fa-shield text-sm"></i>}
                disabled={isShielding}
                onClick={async () => {
                  try {
                    const namAddr = await getNAMAddressFromRegistry()
                    const tokenAddr = namAddr || (import.meta.env.VITE_NAMADA_NAM_TOKEN as string)
                    if (!tokenAddr) {
                      showToast({ title: 'Shield', message: 'NAM token address not found', variant: 'error' })
                      return
                    }
                    const amountInBase = new BigNumber(1)
                    await shieldNowForToken(tokenAddr, 'NAM', { amountInBase })
                  } catch (e: any) {
                    console.error('[Shield NAM] Error', e)
                    showToast({ title: 'Shield', message: e?.message ?? 'Failed', variant: 'error' })
                    try { console.groupEnd() } catch { }
                  }
                }}
              >
                Shield Now
              </Button>
              {shieldFeeNam && (
                <div className="relative group inline-block ml-2">
                  <i className="fa-solid fa-gas-pump text-foreground-secondary/80 text-xs"></i>
                  <div className="absolute left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block bg-card border border-border-muted text-foreground text-xs rounded-md px-2 py-1 whitespace-nowrap shadow-lg z-10">
                    Estimated fee: {shieldFeeNam}
                  </div>
                </div>
              )}
              {isShielding && <Spinner size="sm" variant="accent" />}
            </div>
          </div>
          <div className="flex justify-start items-center gap-4">
            <div className="label-text mb-0 pt-1 w-24 text-left">Shielded:</div>
            <div className="flex gap-2 items-center">
              <img src="/namada-logo.svg" alt="NAM" className="h-5 w-5" />
              <div className="leading-none tracking-wide font-semibold text-[#e7bc59]">{state.balances.namada.namShielded} NAM</div>
              {state.isShieldedBalanceComputing && <Spinner size="sm" variant="accent" />}
            </div>
          </div>

          {/* Info text */}
          <div className="info-text font-normal flex justify-center items-center gap-2 mt-12">
            <i className="fa-regular fa-circle-question text-muted-fg text-sm"></i>
            <span>
              To manage all your shielded assets and see your earned Shielded Rewards, visit
              <a href="https://namadillo.app" target="_blank" rel="noreferrer" className="ml-1 font-semibold underline text-foreground">namadillo.app</a>
            </span>
          </div>
        </div>
      </Card >
    </div >
  )
}

export default BridgeForm
