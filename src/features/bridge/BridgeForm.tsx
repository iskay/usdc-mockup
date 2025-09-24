import React, { useEffect, useRef, useState } from 'react'
import BigNumber from 'bignumber.js'
import { Card, CardHeader } from '../../components/ui/Card'
import { OutArrowIcon, CopyIcon } from '../../components/ui/Icons'
import { Tabs } from '../../components/ui/Tabs'
import { SelectMenu } from '../../components/ui/SelectMenu'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useAppState } from '../../state/AppState'
import { useToast } from '../../components/ui/Toast'
import { PixelRow, pixelColors } from '../../components/layout/Pixels'
import Spinner from '../../components/ui/Spinner'
import { depositForBurnSepolia } from '../../utils/evmCctp'
import { encodeBech32ToBytes32 } from '../../utils/forwarding'
import { estimateDepositFeesUSD } from '../../utils/evmFee'
import { fetchUsdcBalanceForSelectedChain } from '../../utils/evmBalance'
import { getNamadaUSDCBalance, getNamadaNAMBalance } from '../../utils/namadaBalance'
import { useNamadaSdk } from '../../state/NamadaSdkProvider'
import { useNamadaKeychain } from '../../utils/namada'
import { ensureMaspReady, runShieldedSync, clearShieldedContext, type DatedViewingKey, fetchChainIdFromRpc } from '../../utils/shieldedSync'
import { fetchShieldedBalances, formatMinDenom } from '../../utils/shieldedBalance'
import { fetchLatestHeight as fetchNobleLatestHeight, pollNobleForDeposit } from '../../utils/noblePoller'
import { fetchLatestHeight as fetchNamadaLatestHeight, pollNamadaForDeposit } from '../../utils/namadaPoller'
import { useBalanceService } from '../../services/balanceService'
import { getUSDCAddressFromRegistry, getNAMAddressFromRegistry, getAssetDecimalsByDisplay } from '../../utils/namadaBalance'
import { buildSignBroadcastShielding, type GasConfig as ShieldGasConfig } from '../../utils/txShield'
import { buildSignBroadcastUnshieldingIbc } from '../../utils/txUnshieldIbc'
import { buildOrbiterCctpMemo, evmHex20ToBase64_32 } from '../../utils/ibcMemo'
import { fetchLatestHeight, pollNobleForOrbiter } from '../../utils/noblePoller'
import { pollSepoliaUsdcMint } from '../../utils/evmPoller'
import { fetchBlockHeightByTimestamp, fetchGasEstimateForKinds, fetchGasPriceTable, fetchGasPriceForTokenAddress, fetchGasEstimateIbcUnshieldingTransfer } from '../../utils/indexer'
import { type TxProps } from '@namada/sdk-multicore'

const chains = [
  { label: 'Sepolia', value: 'sepolia', iconUrl: '/ethereum-logo.svg' },
  // { label: 'Ethereum', value: 'ethereum', iconUrl: '/ethereum-logo.svg' },
  // { label: 'Base', value: 'base', iconUrl: '/base-logo.svg' },
  // { label: 'Polygon', value: 'polygon', iconUrl: '/polygon-logo.svg' },
  // { label: 'Arbitrum', value: 'arbitrum', iconUrl: '/arb-logo.svg' },
]

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
  const [sendShieldedSyncProgress, setSendShieldedSyncProgress] = useState<number | null>(null)
  const [showMoreDropdown, setShowMoreDropdown] = useState(false)
  const [balanceRefreshCountdown, setBalanceRefreshCountdown] = useState<number | null>(null)
  const shieldedSyncInProgressRef = useRef(false)
  const moreDropdownRef = useRef<HTMLDivElement | null>(null)
  const { sdk, rpc, isReady } = useNamadaSdk()
  const { getDefaultAccount, getAccounts: getNamadaAccounts, isAvailable: isNamadaAvailable } = useNamadaKeychain()

  // Reusable gas estimation function
  const estimateGasForToken = async (
    candidateToken: string,
    txKinds: string[],
    fallbackGasLimit: string = '50000'
  ): Promise<ShieldGasConfig> => {
    // Validate candidate token and fallback to NAM if invalid
    let selectedGasToken = candidateToken
    try {
      const validity = await fetchGasPriceForTokenAddress(candidateToken)
      if (!validity?.isValid) {
        const namAddr = await getNAMAddressFromRegistry()
        selectedGasToken = namAddr || (import.meta.env.VITE_NAMADA_NAM_TOKEN as string)
      }
    } catch {
      const namAddr = await getNAMAddressFromRegistry()
      selectedGasToken = namAddr || (import.meta.env.VITE_NAMADA_NAM_TOKEN as string)
    }

    // Fetch gas estimate and price
    try {
      const [estimate, priceTable] = await Promise.all([
        fetchGasEstimateForKinds(txKinds),
        fetchGasPriceTable().catch(() => []),
      ])
      const priceEntry = priceTable.find((p) => p.token === selectedGasToken)
      const gasLimit = new BigNumber(estimate?.avg ?? fallbackGasLimit)
      const gasPriceInMinDenom = new BigNumber(priceEntry?.gasPrice ?? '0.000001')
      return {
        gasToken: selectedGasToken,
        gasLimit,
        gasPriceInMinDenom,
      }
    } catch (e) {
      console.warn('[Gas Estimation] Failed, using fallback defaults', e)
      return {
        gasToken: selectedGasToken,
        gasLimit: new BigNumber(fallbackGasLimit),
        gasPriceInMinDenom: new BigNumber('0.000001'),
      }
    }
  }

  // Estimate USD fee for Send section using combined IBC unshielding estimate
  useEffect(() => {
    const handle = window.setTimeout(async () => {
      try {
        console.info('[DepositFeeEst] run start', { chain, depositAmount, depositAddress })
        if (chain !== 'sepolia') { console.info('[DepositFeeEst] skip: not sepolia'); setDepositFeeEst(null); return }
        const tokenMessenger = (import.meta as any)?.env?.VITE_SEPOLIA_TOKEN_MESSENGER as string
        const usdcAddr = (import.meta as any)?.env?.VITE_USDC_SEPOLIA as string
        if (!tokenMessenger || !usdcAddr) { console.warn('[DepositFeeEst] missing env', { tokenMessenger: !!tokenMessenger, usdcAddr: !!usdcAddr }); setDepositFeeEst(null); return }
        // Ensure wallet is connected before estimating to allow signer-based estimation
        if (!(window as any).ethereum) { console.warn('[DepositFeeEst] no ethereum provider'); setDepositFeeEst(null); return }
        const accounts: string[] = await (window as any).ethereum.request?.({ method: 'eth_accounts' })
        if (!accounts || accounts.length === 0) { console.warn('[DepositFeeEst] no accounts; connect metamask to enable estimates'); setDepositFeeEst(null); return }

        // Check Noble forwarding registration for the current recipient address
        let nobleRegistered = false
        try {
          const channelId = (import.meta as any)?.env?.VITE_NOBLE_TO_NAMADA_CHANNEL || 'channel-136'
          const lcdUrl = (import.meta as any)?.env?.VITE_NOBLE_LCD_URL
          if (depositAddress && lcdUrl) {
            const url = `${lcdUrl}/noble/forwarding/v1/address/${channelId}/${depositAddress}/`
            console.info('[DepositFeeEst] Noble exists check', { url })
            const res = await fetch(url)
            if (res.ok) {
              const data = await res.json()
              nobleRegistered = !!data?.exists
              console.info('[DepositFeeEst] Noble exists result', data)
            }
          }
        } catch (e) {
          console.warn('[DepositFeeEst] Noble exists check failed', e)
        }

        const est = await estimateDepositFeesUSD({ amountUsdc: depositAmount || '0', usdcAddress: usdcAddr, tokenMessengerAddress: tokenMessenger })
        const total = nobleRegistered ? (est.totalUsd - est.nobleRegUsd) : est.totalUsd
        console.info('[DepositFeeEst] result', { ...est, nobleRegistered, displayedTotal: total })
        setDepositFeeEst(`$${total.toFixed(4)}`)
      } catch {
        console.warn('[DepositFeeEst] estimation failed')
        setDepositFeeEst(null)
      }
    }, 500)
    return () => window.clearTimeout(handle)
  }, [chain, depositAmount, depositAddress])
  useEffect(() => {
    const run = async () => {
      try {
        if (!isReady || !sdk) return
        const usdcToken = await getUSDCAddressFromRegistry()
        const namAddr = await getNAMAddressFromRegistry()
        const gasTokenCandidate = usdcToken || namAddr || (import.meta.env.VITE_NAMADA_NAM_TOKEN as string)
        const estimate = await fetchGasEstimateIbcUnshieldingTransfer()
        const gas = await estimateGasForToken(gasTokenCandidate, ['IbcTransfer'], String(estimate.avg || 75000))
        // Convert min-denom fee to USD by assuming USDC: 1 token == $1. For NAM, show token amount + suffix.
        const feeInMinDenom = new BigNumber(gas.gasLimit).multipliedBy(gas.gasPriceInMinDenom)
        // Determine decimals: USDC has 6, NAM typically 6 as well; if unknown, default 6
        const decimals = 6
        const feeDisplayUnits = feeInMinDenom
        const isUSDC = gas.gasToken === usdcToken
        const formatted = isUSDC
          ? `$${feeDisplayUnits.toFixed(4)}`
          : `${feeDisplayUnits.toFixed(6)} NAM`
        setSendFeeEst(formatted)
      } catch (e) {
        setSendFeeEst(null)
      }
    }
    run()
    // Re-estimate when SDK readiness changes or when user changes amount/destination (optional minimal triggers)
  }, [isReady, sdk, sendAmount, sendAddress])

  // Handle clicking outside the more dropdown to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (moreDropdownRef.current && !moreDropdownRef.current.contains(event.target as Node)) {
        setShowMoreDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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

  // Reusable function: triggers the same logic as clicking the Shielded Sync button
  const triggerShieldedSync = async () => {
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
      showToast({ title: 'Shielded Sync', message: 'Completed', variant: 'success' })
      setShieldedSyncProgress(100)
    } catch (e: any) {
      console.error('[Shielded Sync] Error', e)
      showToast({ title: 'Shielded Sync', message: e?.message ?? 'Failed', variant: 'error' })
    } finally {
      setTimeout(() => setShieldedSyncProgress(null), 1500)
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
    if (state.walletConnections.namada !== 'connected') {
      showToast({ title: 'Namada', message: 'Connect Namada Keychain first', variant: 'error' })
      return
    }
    if (!isReady || !sdk) {
      showToast({ title: 'Namada SDK', message: 'SDK not ready', variant: 'error' })
      return
    }
    setIsShielding(true)
    const chainId = await fetchChainIdFromRpc((sdk as any).url)
    const transparent = state.addresses.namada.transparent
    const shielded = state.addresses.namada.shielded || ''
    if (!transparent || !shielded) {
      showToast({ title: 'Shield', message: 'Missing Namada addresses', variant: 'error' })
      setIsShielding(false)
      return
    }
    try {
      // Drive user toasts by build/sign/submit phases coming from txShield
      const decimals = getAssetDecimalsByDisplay(display, 6)
      const defaultAmountInBase = new BigNumber(1).multipliedBy(new BigNumber(10).pow(decimals))
      const amountInBase = opts?.amountInBase ?? defaultAmountInBase
      // Determine public key presence (affects fee estimate via potential RevealPk)
      const publicKey = (await (sdk as any).rpc.queryPublicKey(transparent)) || ''

      // Compute gas dynamically using indexer
      const txKinds: string[] = ['ShieldingTransfer']
      if (!publicKey) txKinds.unshift('RevealPk')
      let gas = await estimateGasForToken(tokenAddress, txKinds)

      // Allow explicit override of gas only for limit/price, but enforce selected gas token
      if (opts?.gas) {
        gas = {
          gasToken: gas.gasToken,
          gasLimit: opts.gas.gasLimit,
          gasPriceInMinDenom: opts.gas.gasPriceInMinDenom,
        }
      }

      const chain = { chainId, nativeTokenAddress: gas.gasToken }
      const label = display.toUpperCase()
      console.group(`[Shield ${label}]`)
      console.info('Inputs', { chainId, token: tokenAddress, transparent, shielded, amountInBase: amountInBase.toString(), gas: { token: gas.gasToken, gasLimit: gas.gasLimit.toString(), gasPrice: gas.gasPriceInMinDenom.toString() }, publicKeyPresent: !!publicKey })
      if (!publicKey) {
        showToast({ title: 'Shield', message: 'Public key not revealed. A reveal tx will be appended.', variant: 'info' })
      }

      const { txs, signed, response: res } = await buildSignBroadcastShielding({
        sdk: sdk as any,
        transparent,
        shielded,
        tokenAddress,
        amountInBase,
        gas,
        chain,
        publicKey,
        onPhase: (phase) => {
          if (phase === 'building') {
            showToast({ title: 'Shield', message: 'Building shielding transaction', variant: 'info' })
          } else if (phase === 'signing') {
            showToast({ title: 'Shield', message: 'Waiting for approval', variant: 'info' })
          } else if (phase === 'submitting') {
            showToast({ title: 'Shield', message: 'Submitting transaction...', variant: 'info' })
          }
        },
      })
      console.info('Built txs:', { count: txs?.length })
      console.info('Signed txs:', { count: signed?.length, firstLen: signed?.[0]?.length })
      console.info('Broadcast result:', res)
      const hash = (res as any)?.hash
      const hashDisplay = hash ? `${hash.slice(0, 8)}...${hash.slice(-8)}` : 'OK'
      const explorerUrl = chainId.startsWith('housefire') 
        ? `https://testnet.namada.world/transactions/${hash?.toLowerCase()}`
        : `https://namada.world/transactions/${hash?.toLowerCase()}`
      showToast({ 
        title: 'Shield', 
        message: `Submitted: ${hashDisplay}`, 
        variant: 'success',
        ...(hash && {
          action: {
            label: 'View on explorer',
            onClick: () => window.open(explorerUrl, '_blank'),
            icon: <i className="fas fa-external-link-alt text-xs" />
          }
        })
      })
      
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
        await refreshShieldedAfterTx(chainId)
        clearInterval(countdownInterval)
        setBalanceRefreshCountdown(null)
      }, 10000)
      
      console.groupEnd()
    } catch (error: any) {
      console.error('[Shield] Error:', error)
      showToast({ title: 'Shield', message: error?.message ?? 'Shield transaction failed', variant: 'error' })
      console.groupEnd()
    } finally {
      setIsShielding(false)
    }
  }


  type TxStatus = 'idle' | 'submitting' | 'pending' | 'success'
  type TxState = {
    status: TxStatus
    hash?: string
    namadaHash?: string
    sepoliaHash?: string
    stage?: string
    namadaChainId?: string
  }
  const [depositTx, setDepositTx] = useState<TxState>({ status: 'idle' })
  const [sendTx, setSendTx] = useState<TxState>({ status: 'idle' })
  const depositRunId = useRef(0)
  const sendRunId = useRef(0)
  const currentDepositTxIdRef = useRef<string | null>(null)
  const currentSendTxIdRef = useRef<string | null>(null)
  const [depositFeeEst, setDepositFeeEst] = useState<string | null>(null)

  // Persist Send form pending state across navigation by syncing with global transactions
  useEffect(() => {
    try {
      // Initialize from most recent pending send tx if no current id
      if (!currentSendTxIdRef.current) {
        const pending = state.transactions.find((t) => t.kind === 'send' && t.status === 'pending')
        if (pending) {
          currentSendTxIdRef.current = pending.id
          if (pending.amount) setSendAmount(pending.amount)
          if (pending.destination) setSendAddress(pending.destination)
          setSendTx((t) => ({
            ...t,
            status: pending.stage === 'Minted on Sepolia' ? 'success' : 'pending',
            stage: pending.stage,
            namadaHash: pending.namadaHash,
            sepoliaHash: pending.sepoliaHash,
            namadaChainId: pending.namadaChainId,
          }))
        }
      } else {
        const tx = state.transactions.find((t) => t.id === currentSendTxIdRef.current)
        if (tx) {
          setSendTx((t) => ({
            ...t,
            status: tx.stage === 'Minted on Sepolia' ? 'success' : 'pending',
            stage: tx.stage,
            namadaHash: tx.namadaHash,
            sepoliaHash: tx.sepoliaHash,
            namadaChainId: tx.namadaChainId,
          }))
        }
      }
    } catch {}
  }, [state.transactions])

  const generateHash = () => `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`

  const startDepositSimulation = () => {
    const hash = generateHash()
    const amountNow = depositAmount
    const toNow = depositAddress
    const myRun = ++depositRunId.current
    setDepositTx({ status: 'submitting', hash })
    const txId = `dep_${Date.now()}`
    dispatch({
      type: 'ADD_TRANSACTION',
      payload: {
        id: txId,
        kind: 'deposit',
        amount: amountNow,
        fromChain: chain,
        toChain: 'namada',
        destination: toNow,
        hash,
        status: 'submitting',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    })
    showToast({ title: 'Deposit', message: 'Submitting transaction…', variant: 'info' })
    window.setTimeout(() => {
      if (depositRunId.current === myRun) {
        setDepositTx((t) => ({ ...t, status: 'pending' }))
      }
      dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: txId, changes: { status: 'pending' } } })
      showToast({ title: 'Deposit', message: 'Pending confirmation…', variant: 'warning' })
    }, 5000)
    window.setTimeout(() => {
      if (depositRunId.current === myRun) {
        setDepositTx((t) => ({ ...t, status: 'success' }))
      }
      dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: txId, changes: { status: 'success' } } })
      showToast({ title: 'Deposit', message: `Success • ${amountNow} USDC to ${toNow ? toNow.slice(0, 6) + '…' + toNow.slice(-4) : 'Namada'}`, variant: 'success' })
    }, 30000)
  }

  const startSepoliaDeposit = async () => {
    try {
      if (!window.ethereum) {
        showToast({ title: 'MetaMask Not Found', message: 'Please install the MetaMask extension', variant: 'error' })
        return
      }

      const amountNow = depositAmount
      const toNow = depositAddress
      const validation = validateForm(amountNow, getAvailableBalance(chain), toNow)
      if (!validation.isValid) return

      setDepositTx({ status: 'submitting' })
      const txId = currentDepositTxIdRef.current || `dep_${Date.now()}`
      if (!currentDepositTxIdRef.current) currentDepositTxIdRef.current = txId
      dispatch({
        type: 'ADD_TRANSACTION',
        payload: {
          id: txId,
          kind: 'deposit',
          amount: amountNow,
          fromChain: 'sepolia',
          toChain: 'namada',
          destination: toNow,
          status: 'submitting',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      })

      const forwardingAddress = await (async () => {
        const channelId = (import.meta as any)?.env?.VITE_NOBLE_TO_NAMADA_CHANNEL || 'channel-136'
        const lcdUrl = (import.meta as any)?.env?.VITE_NOBLE_LCD_URL
        console.log('🔍 Fetching Noble forwarding address...')
        console.log('   Channel:', channelId)
        console.log('   LCD URL:', lcdUrl)
        console.log('   Namada recipient:', toNow)
        
        if (!lcdUrl) throw new Error('VITE_NOBLE_LCD_URL not set')
        const url = `${lcdUrl}/noble/forwarding/v1/address/${channelId}/${toNow}/`
        console.log('   Fetching:', url)
        
        const res = await fetch(url)
        if (!res.ok) {
          const errorText = await res.text()
          console.error('   LCD response error:', res.status, errorText)
          throw new Error(`Failed to fetch forwarding address: ${res.status} - ${errorText}`)
        }
        const data = await res.json()
        console.log('   LCD response:', data)
        if (!data?.address) throw new Error('No forwarding address returned')
        console.log('   ✅ Forwarding address:', data.address)
        return data.address as string
      })()

      console.log('🔧 Encoding forwarding address to bytes32...')
      const mintRecipient = encodeBech32ToBytes32(forwardingAddress)
      console.log('   ✅ Encoded bytes32:', mintRecipient)
      
      const tokenMessenger = (import.meta as any)?.env?.VITE_SEPOLIA_TOKEN_MESSENGER as string
      const usdcAddr = (import.meta as any)?.env?.VITE_USDC_SEPOLIA as string
      const destinationDomain = Number((import.meta as any)?.env?.VITE_NOBLE_DOMAIN_ID ?? 4)
      
      console.log('📋 Contract addresses:')
      console.log('   TokenMessenger:', tokenMessenger)
      console.log('   USDC:', usdcAddr)
      console.log('   Destination Domain:', destinationDomain)
      
      if (!tokenMessenger) throw new Error('VITE_SEPOLIA_TOKEN_MESSENGER not set')
      if (!usdcAddr) throw new Error('VITE_USDC_SEPOLIA not set')

      const { txHash } = await depositForBurnSepolia({
        amountUsdc: amountNow,
        forwardingAddressBytes32: mintRecipient,
        usdcAddress: usdcAddr,
        tokenMessengerAddress: tokenMessenger,
        destinationDomain,
      })

      setDepositTx({ status: 'pending', hash: txHash, sepoliaHash: txHash, stage: 'Burned on Sepolia' })
      dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: txId, changes: { status: 'pending', hash: txHash } } })
      showToast({ title: 'Deposit', message: 'Pending confirmation…', variant: 'warning' })

      // Notify backend tracker with Noble forwarding address for auto-registration
      try {
        const backendBase = (import.meta as any)?.env?.VITE_BACKEND_BASE || 'http://localhost:8080'
        const channelId = (import.meta as any)?.env?.VITE_NOBLE_TO_NAMADA_CHANNEL || 'channel-136'
        console.log('📨 Notifying backend tracker:', { backendBase, forwardingAddress, recipient: toNow, channelId })
        await fetch(`${backendBase.replace(/\/$/, '')}/api/track`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ address: forwardingAddress, recipient: toNow, channel: channelId }),
        })
      } catch (e: any) {
        console.warn('Tracker notify failed:', e?.message || e)
      }

      // Start Noble deposit polling
      try {
        const nobleRpc = (import.meta as any)?.env?.VITE_NOBLE_RPC as string
        if (!nobleRpc) throw new Error('VITE_NOBLE_RPC not set')
        const startHeight = (await fetchNobleLatestHeight(nobleRpc)) + 1
        const expectedAmountUusdc = `${Math.round(Number(amountNow) * 1e6)}uusdc`
        const namadaReceiver = toNow
        console.log('[Deposit Poller] Starting Noble poll', { nobleRpc, startHeight, forwardingAddress, expectedAmountUusdc, namadaReceiver })
        void pollNobleForDeposit({
          nobleRpc,
          startHeight,
          forwardingAddress,
          expectedAmountUusdc,
          namadaReceiver,
        }, (u) => {
          try {
            if (u.receivedFound) {
              showToast({ title: 'Deposit', message: 'Received on Noble', variant: 'success' })
              setDepositTx((t) => ({ ...t, stage: 'Received on Noble' }))
              dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: txId, changes: { stage: 'Received on Noble' } } })
              // On Noble receipt, refresh Namada transparent balances
              try { void fetchBalances({ kinds: ['namadaTransparentUsdc','namadaTransparentNam'], delayMs: 500 }) } catch {}
              // Start Namada poller once Noble receipt is detected
              const namadaRpc = (import.meta as any)?.env?.VITE_NAMADA_RPC_URL as string
              if (namadaRpc) {
                void (async () => {
                  try {
                    const latestN = await fetchNamadaLatestHeight(namadaRpc)
                    const nStart = Math.max(1, latestN - 3) // small safety window
                    console.log('[Deposit Poller] Starting Namada poll', { namadaRpc, latestN, nStart, forwardingAddress, namadaReceiver })
                    await pollNamadaForDeposit({
                      namadaRpc,
                      startHeight: nStart,
                      forwardingAddress,
                      namadaReceiver,
                      denom: 'uusdc',
                    }, async (nu) => {
                      if (nu.ackFound) {
                        showToast({ title: 'Deposit', message: 'Received on Namada', variant: 'success' })
                        // Get chain ID for explorer link
                        const chainId = await fetchChainIdFromRpc((sdk as any).url)
                        setDepositTx((t) => ({ ...t, status: 'success', namadaHash: nu.namadaTxHash, stage: 'Received on Namada', namadaChainId: chainId }))
                        dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: txId, changes: { status: 'success', namadaHash: nu.namadaTxHash, stage: 'Received on Namada', namadaChainId: chainId } } })
                          // On Namada receipt, run shielded sync then refresh shielded balances
                          try { void fetchBalances({ kinds: ['shieldedSync','namadaShieldedBalances'], delayMs: 500 }) } catch {}
                      }
                    })
                  } catch (e) {
                    console.warn('[Deposit Poller] Namada poll start failed', e)
                  }
                })()
              } else {
                console.warn('[Deposit Poller] VITE_NAMADA_RPC_URL not set; Namada poller not started')
              }
            }
            if (u.forwardFound) {
              showToast({ title: 'Deposit', message: 'Forwarding to Namada', variant: 'success' })
              setDepositTx((t) => ({ ...t, stage: 'Forwarding to Namada' }))
              dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: txId, changes: { stage: 'Forwarding to Namada' } } })
            }
          } catch {}
        })
      } catch (e) {
        console.warn('[Deposit Poller] Noble poll start failed', e)
      }
    } catch (err: any) {
      setDepositTx({ status: 'idle' })
      showToast({ title: 'Deposit Failed', message: err?.message ?? 'Transaction failed', variant: 'error' })
    }
  }

  const resetDeposit = () => {
    depositRunId.current++
      setDepositTx({ status: 'idle' })
      currentDepositTxIdRef.current = null
    setDepositAmount('')
    setDepositAddress('')
  }

  const startSendSimulation = () => {
    const hash = generateHash()
    const amountNow = sendAmount
    const toNow = sendAddress
    const myRun = ++sendRunId.current
    setSendTx({ status: 'submitting', hash })
    const txId = `send_${Date.now()}`
    dispatch({
      type: 'ADD_TRANSACTION',
      payload: {
        id: txId,
        kind: 'send',
        amount: amountNow,
        fromChain: 'namada',
        toChain: chain,
        destination: toNow,
        hash,
        status: 'submitting',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    })
    showToast({ title: 'Send', message: 'Submitting transaction…', variant: 'info' })
    window.setTimeout(() => {
      if (sendRunId.current === myRun) {
        setSendTx((t) => ({ ...t, status: 'pending' }))
      }
      dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: txId, changes: { status: 'pending' } } })
      showToast({ title: 'Send', message: 'Pending confirmation…', variant: 'warning' })
    }, 5000)
    window.setTimeout(() => {
      if (sendRunId.current === myRun) {
        setSendTx((t) => ({ ...t, status: 'success' }))
      }
      dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: txId, changes: { status: 'success' } } })
      showToast({ title: 'Send', message: `Success • ${amountNow} USDC to ${toNow ? toNow.slice(0, 6) + '…' + toNow.slice(-4) : chains.find(c => c.value === chain)?.label}`, variant: 'success' })
    }, 30000)
  }

  const sendNowViaOrbiter = async () => {
    try {
      if (state.walletConnections.namada !== 'connected') {
        showToast({ title: 'Namada', message: 'Connect Namada Keychain first', variant: 'error' })
        return
      }
      if (!isReady || !sdk) {
        showToast({ title: 'Namada SDK', message: 'SDK not ready', variant: 'error' })
        return
      }
      const transparent = state.addresses.namada.transparent
      const shielded = state.addresses.namada.shielded || ''
      if (!transparent || !shielded) {
        showToast({ title: 'Send', message: 'Missing Namada addresses', variant: 'error' })
        return
      }
      console.group('[Send Orbiter] Inputs')
      console.info('Form', { amount: sendAmount, address: sendAddress, chain })
      const validation = validateForm(sendAmount, state.balances.namada.usdcShielded, sendAddress)
      if (!validation.isValid) {
        showToast({ title: 'Send', message: 'Please fix errors in the form', variant: 'error' })
        console.groupEnd()
        return
      }

      const chainId = await fetchChainIdFromRpc((sdk as any).url)
      const usdcToken = await getUSDCAddressFromRegistry()
      if (!usdcToken) {
        showToast({ title: 'Send', message: 'USDC token address not found', variant: 'error' })
        return
      }

      // Amount: convert display (6 decimals) to min-denom integer
      const amountInBase = new BigNumber(sendAmount).multipliedBy(1e6)
      if (!amountInBase.isFinite() || amountInBase.isLessThanOrEqualTo(0)) {
        showToast({ title: 'Send', message: 'Invalid amount', variant: 'error' })
        console.groupEnd()
        return
      }

      const channelId = (import.meta as any)?.env?.VITE_CHANNEL_ID_ON_NAMADA as string || 'channel-27'
      const receiver = 'noble15xt7kx5mles58vkkfxvf0lq78sw04jajvfgd4d'
      const memo = buildOrbiterCctpMemo({
        destinationDomain: 0,
        evmRecipientHex20: sendAddress,
      })
      const mintRecipientB64 = evmHex20ToBase64_32(sendAddress)

      const namAddr = await getNAMAddressFromRegistry()
      const namToken = namAddr || (import.meta.env.VITE_NAMADA_NAM_TOKEN as string)
      const txKinds: string[] = ['IbcTransfer']
      const gas = await estimateGasForToken(namToken, txKinds, '90000')
      const chainSett = { chainId, nativeTokenAddress: gas.gasToken }
      console.info('Resolved', { chainId, usdcToken, amountInBase: amountInBase.toString(), channelId, receiver, gas: { token: gas.gasToken, gasLimit: gas.gasLimit.toString(), gasPrice: gas.gasPriceInMinDenom.toString() } })

      // Ensure extension is connected before generating disposable keys
      try {
        const namada: any = (window as any).namada
        if (namada && typeof namada.connect === 'function') {
          const connected = await namada?.isConnected?.(chainId)
          if (!connected) await namada.connect(chainId)
        }
      } catch {}

      // Wrapper signer
      let accountPublicKey = ''
      let ownerAddressForWrapper = transparent
      try {
        const namada: any = (window as any).namada
        const signer = await namada?.getSigner?.()
        const disposableWrapper = await signer?.genDisposableKeypair?.()
        if (disposableWrapper?.publicKey && disposableWrapper?.address) {
          accountPublicKey = disposableWrapper.publicKey
          ownerAddressForWrapper = disposableWrapper.address
        } else {
          accountPublicKey = (await (sdk as any).rpc.queryPublicKey(transparent)) || ''
        }
      } catch {
        accountPublicKey = (await (sdk as any).rpc.queryPublicKey(transparent)) || ''
      }

      // Shielded pseudo key for paying gas
      const allAccounts = (await getNamadaAccounts()) as any[]
      const shieldedAccount = (allAccounts || []).find((a) => typeof a?.pseudoExtendedKey === 'string' && a.pseudoExtendedKey.length > 0)
      const pseudoExtendedKey = shieldedAccount?.pseudoExtendedKey as string | undefined
      if (!pseudoExtendedKey) {
        showToast({ title: 'Send', message: 'No shielded account with pseudoExtendedKey found', variant: 'error' })
        console.groupEnd()
        return
      }

      setSendTx({ status: 'submitting' })

      // Optional refund target
      let refundTarget: string | undefined
      try {
        const namada: any = (window as any).namada
        const signer = await namada?.getSigner?.()
        const disposable = await signer?.genDisposableKeypair?.()
        refundTarget = disposable?.address
      } catch {}

      const result = await buildSignBroadcastUnshieldingIbc(
        {
          sdk: sdk as any,
          accountPublicKey,
          ownerAddress: ownerAddressForWrapper,
          source: pseudoExtendedKey,
          receiver,
          tokenAddress: usdcToken,
          amountInBase,
          gas,
          chain: chainSett,
          channelId,
          gasSpendingKey: pseudoExtendedKey,
          memo,
          refundTarget,
        },
        (phase) => {
          const map: Record<string, string> = {
            'building:ibc': 'Building IBC transfer',
            'signing:ibc': 'Approve IBC in Keychain',
            'submitting:ibc': 'Submitting IBC transfer...'
          }
          const msg = map[phase]
          if (msg) showToast({ title: 'Send', message: msg, variant: 'info' })
          if (msg) setSendTx((t) => ({ ...t, stage: msg }))
          if (msg) {
            // Reflect stage globally pre-submission with a stable id
            if (!currentSendTxIdRef.current) {
              currentSendTxIdRef.current = `send_${Date.now()}`
              dispatch({
                type: 'ADD_TRANSACTION',
                payload: {
                  id: currentSendTxIdRef.current,
                  kind: 'send',
                  amount: sendAmount,
                  fromChain: 'namada',
                  toChain: 'sepolia',
                  destination: sendAddress,
                  stage: msg,
                  status: 'pending',
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                },
              })
            } else {
              dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: currentSendTxIdRef.current, changes: { stage: msg } } })
            }
          }
        }
      )

      const ibcHash = (result.ibc.response as any)?.hash
      setSendTx({ status: 'success', hash: ibcHash, namadaHash: ibcHash, stage: 'Submitted to Namada', namadaChainId: chainId })
      // Merge into the same global tx id created earlier or create if missing
      const txId = currentSendTxIdRef.current || `send_${Date.now()}`
      if (!currentSendTxIdRef.current) {
        currentSendTxIdRef.current = txId
        dispatch({
          type: 'ADD_TRANSACTION',
          payload: {
            id: txId,
            kind: 'send',
            amount: sendAmount,
            fromChain: 'namada',
            toChain: 'sepolia',
            destination: sendAddress,
            hash: ibcHash,
            namadaHash: ibcHash,
            stage: 'Submitted to Namada',
            status: 'pending',
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        })
      } else {
        dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: txId, changes: { hash: ibcHash, namadaHash: ibcHash, stage: 'Submitted to Namada' } } })
      }
      const hashDisplay = ibcHash ? `${ibcHash.slice(0, 8)}...${ibcHash.slice(-8)}` : 'OK'
      const explorerUrl = chainId.startsWith('housefire')
        ? `https://testnet.namada.world/transactions/${ibcHash?.toLowerCase()}`
        : `https://namada.world/transactions/${ibcHash?.toLowerCase()}`
      showToast({
        title: 'Send',
        message: `Submitted: ${hashDisplay} (${sendAmount} USDC)`,
        variant: 'info',
        ...(ibcHash && {
          action: {
            label: 'View on explorer',
            onClick: () => window.open(explorerUrl, '_blank'),
            icon: <i className="fas fa-external-link-alt text-xs" />,
          }
        })
      })
      
      // Delay then refresh shielded balances with countdown (mirror shield flow)
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
        await refreshShieldedAfterTx(chainId)
        clearInterval(countdownInterval)
        setBalanceRefreshCountdown(null)
      }, 10000)
      console.groupEnd()

      // Start dedicated worker for this tx to poll Noble + Sepolia in isolation
      try {
        const nobleRpc = (import.meta as any)?.env?.VITE_NOBLE_RPC as string
        const startHeight = (await fetchLatestHeight(nobleRpc)) + 1
        const destinationCallerB64 = (import.meta as any)?.env?.VITE_PAYMENT_DESTINATION_CALLER ? evmHex20ToBase64_32((import.meta as any).env.VITE_PAYMENT_DESTINATION_CALLER as string) : ''
        const sepoliaRpc = (import.meta as any)?.env?.VITE_SEPOLIA_RPC as string
        const usdcAddr = (import.meta as any)?.env?.VITE_USDC_SEPOLIA as string
        const worker = new Worker(new URL('../../workers/OrbiterTxWorker.ts', import.meta.url), { type: 'module' })
        worker.onmessage = (ev: MessageEvent) => {
          const data = ev.data as any
          if (data.type === 'update' && data.id === txId) {
            const changes: any = {}
            if (data.data.stage) changes.stage = data.data.stage
            if (typeof data.data.nobleAckFound === 'boolean') changes.nobleAckFound = data.data.nobleAckFound
            if (typeof data.data.nobleCctpFound === 'boolean') changes.nobleCctpFound = data.data.nobleCctpFound
            if (Object.keys(changes).length) {
              setSendTx((t) => ({ ...t, ...changes }))
              dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: txId, changes } })
            }
          } else if (data.type === 'complete' && data.id === txId) {
            if (data.data?.sepoliaHash) {
              setSendTx((t) => ({ ...t, sepoliaHash: data.data.sepoliaHash, stage: 'Minted on Sepolia' }))
              dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: txId, changes: { sepoliaHash: data.data.sepoliaHash, stage: 'Minted on Sepolia', status: 'success' } } })
            }
            worker.terminate()
          } else if (data.type === 'error' && data.id === txId) {
            console.error('[OrbiterTxWorker] error', data.error)
            worker.terminate()
          }
        }
        worker.postMessage({
          type: 'start',
          payload: {
            id: txId,
            noble: {
              rpcUrl: nobleRpc,
              startHeight,
              memoJson: memo,
              receiver,
              amount: amountInBase.toString(),
              destinationCallerB64,
              mintRecipientB64,
              destinationDomain: 0,
              channelId,
              timeoutMs: 5 * 60 * 1000,
              intervalMs: 5000,
            },
            sepolia: {
              rpcUrl: sepoliaRpc,
              usdcAddress: usdcAddr,
              recipient: sendAddress,
              amountBaseUnits: amountInBase.toString(),
              timeoutMs: 5 * 60 * 1000,
              intervalMs: 5000,
            },
          }
        })
      } catch (e) {
        console.warn('[Polling Worker] spawn/start failed', e)
      }
    } catch (e: any) {
      console.error('[Send Orbiter] Error', e)
      showToast({ title: 'Send', message: e?.message ?? 'Failed', variant: 'error' })
      setSendTx({ status: 'idle' })
      try { console.groupEnd() } catch {}
    }
  }

  const resetSend = () => {
    sendRunId.current++
    setSendTx({ status: 'idle' })
    setSendAmount('')
    setSendAddress('')
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

  // Auto-refresh Namada transparent USDC every 5s
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
    }, 5000)
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

  // Auto-refresh Namada shielded balances every 30s (perform shielded sync first) - DISABLED
  // useEffect(() => {
  //   let timer: number | null = null
  //   if (!isReady || !sdk) return
  //   if (state.walletConnections.namada !== 'connected') return

  //   const tick = async () => {
  //     if (shieldedSyncInProgressRef.current) return
  //     if (isShieldedSyncing) return // another sync (e.g. manual) is running
  //     try {
  //       shieldedSyncInProgressRef.current = true
  //       const available = await isNamadaAvailable()
  //       if (!available) return

  //       const allAccounts = (await getNamadaAccounts()) as any[]
  //       const shielded = (allAccounts || []).filter((a) => typeof a?.viewingKey === 'string' && a.viewingKey.length > 0)
  //       const vks: DatedViewingKey[] = []
  //       for (const a of shielded) {
  //         let birthday = 0
  //         if (typeof a?.timestamp === 'number' && a.timestamp > 0) {
  //           try { birthday = await fetchBlockHeightByTimestamp(a.timestamp) } catch { }
  //         }
  //         vks.push({ key: String(a.viewingKey), birthday })
  //       }
  //       if (vks.length === 0) return

  //       // Show spinner during auto sync/fetch
  //       setIsAutoShieldedSyncing(true)

  //       const chainId = await fetchChainIdFromRpc((sdk as any).url)
  //       const paramsUrl = (import.meta as any)?.env?.VITE_MASP_PARAMS_BASE_URL as string | undefined
  //       await ensureMaspReady({ sdk: sdk as any, chainId, paramsUrl })
  //       await runShieldedSync({
  //         sdk: sdk as any,
  //         viewingKeys: vks,
  //         chainId,
  //         maspIndexerUrl: (import.meta as any)?.env?.VITE_NAMADA_MASP_INDEXER_URL as string | undefined,
  //       })

  //       try {
  //         const firstVk = vks[0]?.key
  //         if (firstVk) {
  //           const [usdcAddr, namAddr] = await Promise.all([
  //             getUSDCAddressFromRegistry(),
  //             getNAMAddressFromRegistry(),
  //           ])
  //           const tokens = [usdcAddr, namAddr].filter((x): x is string => typeof x === 'string' && x.length > 0)
  //           if (tokens.length > 0) {
  //             const balances = await fetchShieldedBalances(sdk as any, firstVk, tokens, chainId)
  //             const map = new Map<string, string>(balances)
  //             if (usdcAddr) {
  //               const usdcMin = map.get(usdcAddr) || '0'
  //               setUsdcShieldedMinDenom(usdcMin)
  //               dispatch({ type: 'MERGE_BALANCES', payload: { namada: { usdcShielded: formatMinDenom(usdcMin, 'USDC') } } })
  //             }
  //             if (namAddr) {
  //               const namMin = map.get(namAddr) || '0'
  //               dispatch({ type: 'MERGE_BALANCES', payload: { namada: { namShielded: formatMinDenom(namMin, 'NAM') } } })
  //             }
  //           }
  //         }
  //       } catch { }
  //     } catch {
  //       // Silent; periodic background sync
  //     } finally {
  //       shieldedSyncInProgressRef.current = false
  //       setIsAutoShieldedSyncing(false)
  //     }
  //   }

  //   timer = window.setInterval(() => { void tick() }, 30000)
  //   return () => { if (timer) window.clearInterval(timer) }
  //   // eslint-disable-next-line react-hooks/exhaustive-deps
  // }, [isReady, sdk, state.walletConnections.namada])

  const shorten = (addr: string) => (addr?.length > 10 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr)

  const validateAmount = (amount: string, availableBalance: string) => {
    if (!amount || amount.trim() === '') {
      return { isValid: false, error: 'Please enter an amount' }
    }
    const numAmount = parseFloat(amount)
    const numAvailable = parseFloat(availableBalance)
    if (isNaN(numAmount) || numAmount <= 0) {
      return { isValid: false, error: 'Please enter a valid amount' }
    }
    if (numAmount > numAvailable) {
      return { isValid: false, error: 'Amount exceeds available balance' }
    }
    return { isValid: true, error: null }
  }

  const validateForm = (amount: string, availableBalance: string, address: string) => {
    const amountValidation = validateAmount(amount, availableBalance)
    const hasAddress = address && address.trim() !== ''
    return {
      isValid: amountValidation.isValid && hasAddress,
      amountError: amountValidation.error,
      addressError: !hasAddress ? 'Please enter a destination address' : null
    }
  }

  const renderDepositSection = () => (
    <div className="space-y-6 text-left">
      <div>
        <div className="flex gap-2 items-end mt-[-1em] text-title font-bold text-2xl">
          <div>Shield USDC from any EVM chain with one click</div>
          <div className="mb-2"><PixelRow size={7} /></div>
        </div>
        <div className="mb-10 text-sm text-accent-green">Deposit USDC into Namada's shielded pool to earn rewards and make fully-private transactions</div>
        <div className="label-text">Deposit</div>
        <Input
          placeholder="Enter an amount"
          value={depositAmount}
          onChange={(e) => setDepositAmount(e.target.value)}
          disabled={depositTx.status !== 'idle'}
          left={<i className="fa-regular fa-paper-plane text-muted-fg/80"></i>}
          rightSize="lg"
          right={
            <span className="inline-flex items-center gap-2 text-muted-fg">
              <img src="/usdc-logo.svg" className="h-5 w-5" alt="USDC" />
              <span className="text-xs font-semibold text-muted-fg">USDC</span>
              <button
                type="button"
                onClick={() => setDepositAmount(getAvailableBalance(chain))}
                className="rounded-md font-semibold px-2 py-1 text-xs text-muted-fg hover:bg-sidebar-selected"
              >
                Max
              </button>
            </span>
          }
        />
        <div className="info-text ml-4">Available: {getAvailableBalance(chain)} USDC</div>
        {(() => {
          const validation = validateAmount(depositAmount, getAvailableBalance(chain))
          return !validation.isValid && depositAmount ? (
            <div className="text-red-400 text-sm ml-4 mt-1">{validation.error}</div>
          ) : null
        })()}
      </div>

      <div>
        <div className="label-text">Network</div>
        <SelectMenu value={chain} onChange={setChain} options={chains} className={depositTx.status !== 'idle' ? 'opacity-60 pointer-events-none' : ''} />
        <div className="info-text ml-4">
          My Address: {chain === 'namada' ? shorten(state.addresses.namada.transparent) : (state.walletConnections.metamask === 'connected' ? shorten((state.addresses as any)[chain]) : (
            <button
              type="button"
              onClick={async () => {
                try {
                  if (!window.ethereum) {
                    showToast({ title: 'MetaMask Not Found', message: 'Please install the MetaMask extension', variant: 'error' })
                    return
                  }
                  dispatch({ type: 'SET_WALLET_CONNECTION', payload: { metamask: 'connecting' } })
                  const accounts: string[] = await window.ethereum.request({ method: 'eth_requestAccounts' })
                  if (accounts && accounts.length > 0) {
                    const account = accounts[0]
                    dispatch({ type: 'SET_WALLET_CONNECTION', payload: { metamask: 'connected' } })
                    dispatch({
                      type: 'SET_ADDRESSES',
                      payload: {
                        ...state.addresses,
                        ethereum: account,
                        base: account,
                        sepolia: account,
                      },
                    })
                    showToast({ title: 'MetaMask Connected', message: `Connected: ${account.slice(0, 6)}...${account.slice(-4)}`, variant: 'success' })
                  } else {
                    dispatch({ type: 'SET_WALLET_CONNECTION', payload: { metamask: 'disconnected' } })
                  }
                } catch (err: any) {
                  dispatch({ type: 'SET_WALLET_CONNECTION', payload: { metamask: 'error' } })
                  showToast({ title: 'Connection Failed', message: err?.message ?? 'Unable to connect MetaMask', variant: 'error' })
                }
              }}
              className="text-button ml-1"
            >
              Connect MetaMask
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <div className="label-text">To Namada address</div>
          <button
            type="button"
            onClick={() => {
              const namadaAddress = state.addresses.namada.transparent
              if (namadaAddress) {
                setDepositAddress(namadaAddress)
              }
            }}
            disabled={state.walletConnections.namada !== 'connected'}
            className={`text-button ${state.walletConnections.namada !== 'connected' ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Auto Fill
          </button>
        </div>
        <Input placeholder="tnam..." value={depositAddress} onChange={(e) => setDepositAddress(e.target.value)} disabled={depositTx.status !== 'idle'} left={<i className="mx-1 fa-regular fa-user text-muted-fg"></i>} />
        {(() => {
          const validation = validateForm(depositAmount, getAvailableBalance(chain), depositAddress)
          return validation.addressError && depositAddress !== '' ? (
            <div className="text-red-400 text-sm ml-4 mt-1">{validation.addressError}</div>
          ) : null
        })()}
      </div>

      <div className="grid grid-cols-1 gap-2 border border-border-muted rounded-xl mt-8 p-4">
        <div className="flex justify-between">
          <div className="flex gap-2 items-baseline">
            <i className="fa-solid fa-gas-pump text-foreground-secondary text-xs"></i>
            <div className="info-text text-foreground-secondary">Estimated fees</div>
          </div>
          <span className="info-text font-semibold text-muted-fg">{depositFeeEst ?? '$--'}</span>
        </div>
        <div className="flex justify-between">
          <div className="flex gap-2 items-baseline">
            <i className="fa-solid fa-stopwatch text-foreground-secondary text-xs"></i>
            <div className="info-text text-foreground-secondary">Estimated deposit time</div>
          </div>
          <span className="info-text font-semibold text-muted-fg">2 - 3 minutes</span>
        </div>
      </div>

      {(() => {
        const selected = chains.find((c) => c.value === chain)
        const isConnected = state.walletConnections.metamask === 'connected'
        const validation = validateForm(depositAmount, getAvailableBalance(chain), depositAddress)
        if (!isConnected) {
          return (
            <div className="flex justify-center">
              <Button
                variant="big-connect"
                leftIcon={<img src={selected?.iconUrl ?? '/ethereum-logo.svg'} alt="" className="h-5 w-5" />}
                onClick={async () => {
                  try {
                    if (!window.ethereum) {
                      showToast({ title: 'MetaMask Not Found', message: 'Please install the MetaMask extension', variant: 'error' })
                      return
                    }
                    dispatch({ type: 'SET_WALLET_CONNECTION', payload: { metamask: 'connecting' } })
                    const accounts: string[] = await window.ethereum.request({ method: 'eth_requestAccounts' })
                    if (accounts && accounts.length > 0) {
                      const account = accounts[0]
                      dispatch({ type: 'SET_WALLET_CONNECTION', payload: { metamask: 'connected' } })
                      dispatch({
                        type: 'SET_ADDRESSES',
                        payload: {
                          ...state.addresses,
                          ethereum: account,
                          base: account,
                          sepolia: account,
                        },
                      })
                      showToast({ title: 'MetaMask Connected', message: `Connected: ${account.slice(0, 6)}...${account.slice(-4)}`, variant: 'success' })
                    } else {
                      dispatch({ type: 'SET_WALLET_CONNECTION', payload: { metamask: 'disconnected' } })
                    }
                  } catch (err: any) {
                    dispatch({ type: 'SET_WALLET_CONNECTION', payload: { metamask: 'error' } })
                    showToast({ title: 'Connection Failed', message: err?.message ?? 'Unable to connect MetaMask', variant: 'error' })
                  }
                }}
              >
                {`Connect to ${selected?.label ?? ''}`}
              </Button>
            </div>
          )
        }

        if (depositTx.status === 'idle') {
          return (
            <div className="flex justify-center">
              <Button
                variant="submit"
                disabled={!validation.isValid}
                onClick={() => {
                  if (chain === 'sepolia') {
                    void startSepoliaDeposit()
                  } else {
                    startDepositSimulation()
                  }
                }}
                leftIcon={<img src="/rocket.svg" alt="" className="h-5 w-5" />}
              >
                Deposit USDC
              </Button>
            </div>
          )
        }

        const statusText = depositTx.stage || (depositTx.status === 'submitting' ? 'Submitting transaction...' : 'Pending confirmation...')

        return (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-border-muted bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                {depositTx.stage === 'Received on Namada' ? (
                  <i className="fa-solid fa-check-circle text-accent-green"></i>
                ) : (
                  <Spinner size="sm" variant="accent" />
                )}
                <div className="text-sm font-semibold text-foreground">{statusText}</div>
              </div>
              <div className="text-sm text-foreground-secondary">
                <div className="flex justify-between"><span>Amount</span><span className="font-semibold text-foreground">{depositAmount} USDC</span></div>
                <div className="flex justify-between"><span>Destination</span><span className="font-semibold text-foreground">{shorten(depositAddress)}</span></div>
                <div className="flex justify-between"><span>On</span><span className="font-semibold text-foreground">{chains.find(c => c.value === chain)?.label} → Namada</span></div>
                <div className="flex justify-between"><span>Sepolia Send Tx</span><span className="font-mono text-xs text-foreground flex items-center gap-2">
                  {depositTx.sepoliaHash ? (
                    <>
                      <span>{depositTx.sepoliaHash.slice(0, 10)}...{depositTx.sepoliaHash.slice(-8)}</span>
                      <button onClick={() => { navigator.clipboard.writeText(depositTx.sepoliaHash as string) }} title="Copy to Clipboard" className="rounded px-1 py-0.5 hover:bg-button-active/10 active:scale-95 transition" style={{ transitionDelay: '0ms' }}><i className="fas fa-copy text-[11px]" /></button>
                      <button onClick={() => window.open(`https://sepolia.etherscan.io/tx/${depositTx.sepoliaHash}`, '_blank')} title="View on Explorer" className="rounded px-1 py-0.5 hover:bg-button-active/10 active:scale-95 transition" style={{ transitionDelay: '0ms' }}><i className="fas fa-arrow-up-right-from-square text-[11px]" /></button>
                    </>
                  ) : '—'}
                </span></div>
                <div className="flex justify-between"><span>Namada Receive Tx</span><span className="font-mono text-xs text-foreground flex items-center gap-2">
                  {depositTx.namadaHash ? (
                    <>
                      <span>{(depositTx.namadaHash as string).slice(0, 10)}...{(depositTx.namadaHash as string).slice(-8)}</span>
                      <button onClick={() => { navigator.clipboard.writeText(depositTx.namadaHash as string) }} title="Copy to Clipboard" className="rounded px-1 py-0.5 hover:bg-button-active/10 active:scale-95 transition" style={{ transitionDelay: '0ms' }}><i className="fas fa-copy text-[11px]" /></button>
                      <button onClick={() => {
                        const hash = depositTx.namadaHash as string
                        const url = (String(depositTx.namadaChainId || '').startsWith('housefire')
                          ? `https://testnet.namada.world/transactions/${hash.toLowerCase()}`
                          : `https://namada.world/transactions/${hash.toLowerCase()}`)
                        window.open(url, '_blank')
                      }} title="View on Explorer" className="rounded px-1 py-0.5 hover:bg-button-active/10 active:scale-95 transition" style={{ transitionDelay: '0ms' }}><i className="fas fa-arrow-up-right-from-square text-[11px]" /></button>
                    </>
                  ) : '—'}
                </span></div>
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-fg mb-3">You can view the ongoing status of this transaction in the My Transactions page</div>
              <Button variant="ghost" size="sm" leftIcon={<i className="fas fa-rotate text-sm"></i>} onClick={resetDeposit}>Start new transaction</Button>
            </div>
          </div>
        )
      })()}
    </div>
  )

  const renderSendSection = () => (
    <div className="space-y-6 text-left">

      <div>
        <div className="flex gap-2 items-end mt-[-1em] text-title font-bold text-2xl">
          <div>Send USDC to any EVM chain privately</div>
          <div className="mb-2"><PixelRow size={7} /></div>
        </div>
        <div className="mb-10 text-sm text-accent-green">Make fully-private payments from Namada's shielded pool to the destination of your choice</div>
        <div className="label-text">Send</div>
        <Input
          placeholder="Enter an amount"
          value={sendAmount}
          onChange={(e) => setSendAmount(e.target.value)}
          disabled={sendTx.status !== 'idle'}
          left={<i className="fa-regular fa-paper-plane text-muted-fg/80"></i>}
          rightSize="lg"
          right={
            <span className="inline-flex items-center gap-2 text-muted-fg">
              <img src="/usdc-logo.svg" className="h-5 w-5" alt="USDC" />
              <span className="text-xs font-semibold text-muted-fg">USDC</span>
              <button
                type="button"
                onClick={() => setSendAmount(state.balances.namada.usdcShielded)}
                className="rounded-md font-semibold px-2 py-1 text-xs text-muted-fg hover:bg-sidebar-selected"
              >
                Max
              </button>
            </span>
          }
        />
        <div className="info-text ml-4 flex items-center gap-2">
          <span>Available: {state.balances.namada.usdcShielded} USDC</span>
          {state.balances.namada.usdcShielded === '--' && state.walletConnections.namada === 'connected' && !state.isShieldedSyncing && !state.isShieldedBalanceComputing && (
            <button
              type="button"
              onClick={async () => {
                try {
                  setSendShieldedSyncProgress(0)
                  await fetchBalances({
                    kinds: ['shieldedSync','namadaShieldedBalances'],
                    delayMs: 0,
                    force: true,
                    onProgress: (evt) => {
                      if (evt.step === 'shieldedSyncStarted') setSendShieldedSyncProgress(0)
                      if (evt.step === 'shieldedSyncProgress' && typeof evt.data === 'number') setSendShieldedSyncProgress(evt.data)
                      if (evt.step === 'shieldedSyncFinished') setSendShieldedSyncProgress(100)
                    },
                  })
                  showToast({ title: 'Shielded Sync', message: 'Completed', variant: 'success' })
                  setTimeout(() => setSendShieldedSyncProgress(null), 1500)
                } catch (e: any) {
                  console.error('[Send Shielded Sync] Error', e)
                  showToast({ title: 'Shielded Sync', message: e?.message ?? 'Failed', variant: 'error' })
                  setTimeout(() => setSendShieldedSyncProgress(null), 1500)
                }
              }}
              className="text-button text-xs"
            >
              Click to Shielded Sync
            </button>
          )}
          {state.isShieldedSyncing && sendShieldedSyncProgress !== null && (
            <div className="flex items-center gap-2 text-xs text-button-text-inactive">
              <div className="w-16 h-1.5 bg-button-inactive/40 rounded-full overflow-hidden">
                <div
                  className="h-1.5 bg-[#01daab] transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, sendShieldedSyncProgress || 0))}%` }}
                />
              </div>
              <span>{Math.max(0, Math.min(100, sendShieldedSyncProgress || 0))}%</span>
            </div>
          )}
        </div>
        {(() => {
          const validation = validateAmount(sendAmount, state.balances.namada.usdcShielded)
          return !validation.isValid && sendAmount ? (
            <div className="text-red-400 text-sm ml-4 mt-1">{validation.error}</div>
          ) : null
        })()}
      </div>

      <div>
        <div className="flex items-baseline justify-between">
          <div className="label-text">To address</div>
          <button
            type="button"
            onClick={() => {
              const metamaskAddress = state.addresses.ethereum || state.addresses.base || state.addresses.sepolia
              if (metamaskAddress) {
                setSendAddress(metamaskAddress)
              }
            }}
            disabled={state.walletConnections.metamask !== 'connected'}
            className={`text-button ${state.walletConnections.metamask !== 'connected' ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Auto Fill
          </button>
        </div>
        <Input placeholder="0x..." value={sendAddress} onChange={(e) => setSendAddress(e.target.value)} disabled={sendTx.status !== 'idle'} left={<i className="mx-1 fa-regular fa-user text-muted-fg"></i>} />
        {(() => {
          const validation = validateForm(sendAmount, state.balances.namada.usdcShielded, sendAddress)
          return validation.addressError && sendAddress !== '' ? (
            <div className="text-red-400 text-sm ml-4 mt-1">{validation.addressError}</div>
          ) : null
        })()}
      </div>

      <div>
        <div className="label-text">Network</div>
        <SelectMenu value={chain} onChange={setChain} options={chains} className={sendTx.status !== 'idle' ? 'opacity-60 pointer-events-none' : ''} />
      </div>

      <div className="grid grid-cols-1 gap-2 border border-border-muted rounded-xl mt-8 p-4">
        <div className="flex justify-between">
          <div className="flex gap-2 items-baseline">
            <i className="fa-solid fa-gas-pump text-foreground-secondary text-xs"></i>
            <div className="info-text text-foreground-secondary">Estimated fees</div>
          </div>
          <span className="info-text font-semibold text-muted-fg">{sendFeeEst ?? '—'}</span>
        </div>
        <div className="flex justify-between">
          <div className="flex gap-2 items-baseline">
            <i className="fa-solid fa-stopwatch text-foreground-secondary text-xs"></i>
            <div className="info-text text-foreground-secondary">Estimated send time</div>
          </div>
          <span className="info-text font-semibold text-muted-fg">2 - 5 minutes</span>
        </div>
      </div>

      {(() => {
        const selected = chains.find((c) => c.value === chain)
        const isConnected = state.walletConnections.namada === 'connected'
        const validation = validateForm(sendAmount, state.balances.namada.usdcShielded, sendAddress)
        if (!isConnected) {
          return (
            <div className="flex justify-center">
              <Button
                variant="big-connect"
                leftIcon={<img src='/namada-logo.svg' alt="" className="h-5 w-5" />}
                onClick={async () => {
                  try {
                    const { useNamadaKeychain } = await import('../../utils/namada')
                    const { fetchChainIdFromRpc } = await import('../../utils/shieldedSync')
                    const { connect, checkConnection, getDefaultAccount, isAvailable } = useNamadaKeychain()
                    const available = await isAvailable()
                    if (!available) {
                      showToast({ title: 'Namada Keychain', message: 'Please install the Namada Keychain extension', variant: 'error' })
                      return
                    }
                    // Get current chain ID from SDK
                    const chainId = await fetchChainIdFromRpc((sdk as any).url)
                    await connect(chainId)
                    const ok = await checkConnection(chainId)
                    if (ok) {
                      const acct = await getDefaultAccount()
                      dispatch({ type: 'SET_WALLET_CONNECTION', payload: { namada: 'connected' } })
                      if (acct?.address) {
                        dispatch({
                          type: 'SET_ADDRESSES',
                          payload: {
                            ...state.addresses,
                            namada: { ...state.addresses.namada, transparent: acct.address },
                          },
                        })
                      }
                      showToast({ title: 'Namada Keychain', message: 'Connected', variant: 'success' })
                    } else {
                      showToast({ title: 'Namada Keychain', message: 'Failed to connect', variant: 'error' })
                    }
                  } catch (e: any) {
                    showToast({ title: 'Namada Keychain', message: e?.message ?? 'Connection failed', variant: 'error' })
                  }
                }}
              >
                {`Connect to Namada`}
              </Button>
            </div>
          )
        }

        if (sendTx.status === 'idle') {
          return (
            <div className="flex justify-center">
              <Button variant="submit" disabled={!validation.isValid} onClick={sendNowViaOrbiter} leftIcon={<img src="/rocket.svg" alt="" className="h-5 w-5" />}>Send USDC</Button>
            </div>
          )
        }

        const statusText = sendTx.stage || (sendTx.status === 'submitting' ? 'Submitting transaction...' : sendTx.status === 'pending' ? 'Pending confirmation...' : 'Success')

        return (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-border-muted bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                {sendTx.stage === 'Minted on Sepolia' ? (
                  <i className="fa-solid fa-check-circle text-accent-green"></i>
                ) : (
                  <Spinner size="sm" variant="accent" />
                )}
                <div className="text-sm font-semibold text-foreground">{statusText}</div>
              </div>
              <div className="text-sm text-foreground-secondary">
                <div className="flex justify-between"><span>Amount</span><span className="font-semibold text-foreground">{sendAmount} USDC</span></div>
                <div className="flex justify-between"><span>Destination</span><span className="font-semibold text-foreground flex items-center gap-2">{shorten(sendAddress)}
                  <button onClick={() => { navigator.clipboard.writeText(sendAddress) }} title="Copy to Clipboard" className="rounded px-1 py-0.5 hover:bg-button-active/10 active:scale-95 transition" style={{ transitionDelay: '0ms' }}><i className="fas fa-copy text-[11px]" /></button>
                  <button onClick={() => window.open(`https://sepolia.etherscan.io/address/${sendAddress}`, '_blank')} title="View on Explorer" className="rounded px-1 py-0.5 hover:bg-button-active/10 active:scale-95 transition" style={{ transitionDelay: '0ms' }}><i className="fas fa-arrow-up-right-from-square text-[11px]" /></button>
                </span></div>
                <div className="flex justify-between"><span>On chain</span><span className="font-semibold text-foreground">{chains.find(c => c.value === chain)?.label}</span></div>
                <div className="flex justify-between"><span>Namada Send Tx</span><span className="font-mono text-xs text-foreground flex items-center gap-2">
                  {sendTx.namadaHash ? (
                    <>
                      <span>{(sendTx.namadaHash as string).slice(0, 10)}...{(sendTx.namadaHash as string).slice(-8)}</span>
                      <button onClick={() => { navigator.clipboard.writeText(sendTx.namadaHash as string) }} title="Copy to Clipboard" className="rounded px-1 py-0.5 hover:bg-button-active/10 active:scale-95 transition" style={{ transitionDelay: '0ms' }}><i className="fas fa-copy text-[11px]" /></button>
                      <button onClick={() => {
                        const hash = sendTx.namadaHash as string
                        const url = (String(sendTx.namadaChainId || '').startsWith('housefire')
                          ? `https://testnet.namada.world/transactions/${hash.toLowerCase()}`
                          : `https://namada.world/transactions/${hash.toLowerCase()}`)
                        window.open(url, '_blank')
                      }} title="View on Explorer" className="rounded px-1 py-0.5 hover:bg-button-active/10 active:scale-95 transition" style={{ transitionDelay: '0ms' }}><i className="fas fa-arrow-up-right-from-square text-[11px]" /></button>
                    </>
                  ) : '—'}
                </span></div>
                <div className="flex justify-between"><span>Sepolia Receive Tx</span><span className="font-mono text-xs text-foreground flex items-center gap-2">
                  {sendTx.sepoliaHash ? (
                    <>
                      <span>{sendTx.sepoliaHash.slice(0, 10)}...{sendTx.sepoliaHash.slice(-8)}</span>
                      <button onClick={() => { navigator.clipboard.writeText(sendTx.sepoliaHash as string) }} title="Copy to Clipboard" className="rounded px-1 py-0.5 hover:bg-button-active/10 active:scale-95 transition" style={{ transitionDelay: '0ms' }}><i className="fas fa-copy text-[11px]" /></button>
                      <button onClick={() => window.open(`https://sepolia.etherscan.io/tx/${sendTx.sepoliaHash}`, '_blank')} title="View on Explorer" className="rounded px-1 py-0.5 hover:bg-button-active/10 active:scale-95 transition" style={{ transitionDelay: '0ms' }}><i className="fas fa-arrow-up-right-from-square text-[11px]" /></button>
                    </>
                  ) : '—'}
                </span></div>
              </div>
            </div>
            {sendTx.stage && sendTx.stage !== 'Building IBC transfer' && (
              <div className="text-center">
                <div className="text-sm text-foreground-secondary mb-3">You can follow the status of this transaction in the My Transactions page</div>
                <Button variant="ghost" size="sm" leftIcon={<i className="fas fa-rotate text-sm"></i>} onClick={resetSend}>Start new transaction</Button>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )

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
        {activeTab === 'deposit' ? renderDepositSection() : renderSendSection()}
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
                  onClick={async () => {
                    try {
                      setShieldedSyncProgress(0)
                      await fetchBalances({
                        kinds: ['shieldedSync','namadaShieldedBalances'],
                        delayMs: 0,
                        force: true,
                        onProgress: (evt) => {
                          if (evt.step === 'shieldedSyncStarted') setShieldedSyncProgress(0)
                          if (evt.step === 'shieldedSyncProgress' && typeof evt.data === 'number') setShieldedSyncProgress(evt.data)
                          if (evt.step === 'shieldedSyncFinished') setShieldedSyncProgress(100)
                        },
                      })
                      showToast({ title: 'Shielded Sync', message: 'Completed', variant: 'success' })
                      setTimeout(() => setShieldedSyncProgress(null), 1500)
                    } catch (e: any) {
                      console.error('[Shielded Sync] Error', e)
                      showToast({ title: 'Shielded Sync', message: e?.message ?? 'Failed', variant: 'error' })
                      setTimeout(() => setShieldedSyncProgress(null), 1500)
                    }
                  }}
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
                    <div className="absolute right-0 mt-2 w-72 rounded-xl border border-button-text-inactive bg-button-inactive text-button-text-inactive p-1 shadow-lg z-50">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            if (state.walletConnections.namada !== 'connected') {
                              showToast({ title: 'Namada', message: 'Connect Namada Keychain first', variant: 'error' })
                              return
                            }
                            if (!isReady || !sdk) {
                              showToast({ title: 'Namada SDK', message: 'SDK not ready', variant: 'error' })
                              return
                            }
                            const transparent = state.addresses.namada.transparent
                            const shielded = state.addresses.namada.shielded || ''
                            if (!transparent || !shielded) {
                              showToast({ title: 'IBC Debug', message: 'Missing Namada addresses', variant: 'error' })
                              return
                            }
                            const chainId = await fetchChainIdFromRpc((sdk as any).url)
                            
                            // Try to use custom USDC token, fallback to NAM
                            const customUsdcToken = 'tnam1pkkyepxa05mn9naftfpqy3l665tehe859ccp2wts'
                            const namAddr = await getNAMAddressFromRegistry()
                            const namToken = namAddr || (import.meta.env.VITE_NAMADA_NAM_TOKEN as string)
                            
                            // Use custom USDC if defined, otherwise NAM
                            const transferToken = customUsdcToken || namToken
                            if (!transferToken) {
                              showToast({ title: 'IBC Debug', message: 'No valid token address found', variant: 'error' })
                              return
                            }

                            // Use NAM as gas token for IBC debug (gas token separate from transfer token)
                            const txKinds: string[] = ['UnshieldingTransfer', 'IbcTransfer']
                            const gas = await estimateGasForToken(namToken, txKinds, '75000')
                            // Send 1 USDC (1 uusdc) or 1 NAM depending on token
                            const amountInBase = transferToken === customUsdcToken 
                              ? new BigNumber(1) // 1 uusdc = 1 USDC
                              : new BigNumber(1) // 1 NAM
                            const chain = { chainId, nativeTokenAddress: gas.gasToken }
                            const receiver = 'noble1duaw0gnpy6cfvw0ey9phnv0ehjmyhsyztkeutx'
                            const channelId = 'channel-27'
                            // Generate disposable wrapper signer (ephemeral payer)
                            let accountPublicKey = ''
                            let ownerAddressForWrapper = transparent
                            try {
                              const namada: any = (window as any).namada
                              const signer = await namada?.getSigner?.()
                              const disposableWrapper = await signer?.genDisposableKeypair?.()
                              if (disposableWrapper?.publicKey && disposableWrapper?.address) {
                                accountPublicKey = disposableWrapper.publicKey
                                ownerAddressForWrapper = disposableWrapper.address
                              } else {
                                accountPublicKey = (await (sdk as any).rpc.queryPublicKey(transparent)) || ''
                              }
                            } catch {
                              accountPublicKey = (await (sdk as any).rpc.queryPublicKey(transparent)) || ''
                            }

                            // Use shielded source directly with MASP gas spending key to avoid unshield-to-known-address
                            const allAccounts = (await getNamadaAccounts()) as any[]
                            const shieldedAccount = (allAccounts || []).find((a) => typeof a?.pseudoExtendedKey === 'string' && a.pseudoExtendedKey.length > 0)
                            const pseudoExtendedKey = shieldedAccount?.pseudoExtendedKey as string | undefined
                            if (!pseudoExtendedKey) {
                              showToast({ title: 'IBC Debug', message: 'No shielded account with pseudoExtendedKey found', variant: 'error' })
                              return
                            }

                            // Generate disposable refund target similar to Namadillo
                            let refundTarget: string | undefined
                            try {
                              const namada: any = (window as any).namada
                              const signer = await namada?.getSigner?.()
                              const disposable = await signer?.genDisposableKeypair?.()
                              refundTarget = disposable?.address
                            } catch {}

                            // We rely on gasSpendingKey for IBC to pay fees from MASP; do not pre-fund wrapper via MASP fee payment here (matches Namadillo)

                            const result = await buildSignBroadcastUnshieldingIbc(
                              {
                                sdk: sdk as any,
                                accountPublicKey,
                                ownerAddress: ownerAddressForWrapper,
                                source: pseudoExtendedKey,
                                receiver,
                                tokenAddress: transferToken,
                                amountInBase,
                                gas,
                                chain,
                                channelId,
                                gasSpendingKey: pseudoExtendedKey,
                                refundTarget,
                              },
                              (phase) => {
                                const map: Record<string, string> = {
                                  'building:unshield': 'Building unshielding tx',
                                  'signing:unshield': 'Approve unshielding in Keychain',
                                  'submitting:unshield': 'Submitting unshielding...',
                                  'building:ibc': 'Building IBC transfer',
                                  'signing:ibc': 'Approve IBC in Keychain',
                                  'submitting:ibc': 'Submitting IBC transfer...'
                                }
                                const msg = map[phase]
                                if (msg) showToast({ title: 'IBC Debug', message: msg, variant: 'info' })
                              }
                            )
                            const ibcHash = (result.ibc.response as any)?.hash
                            const hashDisplay = ibcHash ? `${ibcHash.slice(0, 8)}...${ibcHash.slice(-8)}` : 'OK'
                            const explorerUrl = chainId.startsWith('housefire')
                              ? `https://testnet.namada.world/transactions/${ibcHash?.toLowerCase()}`
                              : `https://namada.world/transactions/${ibcHash?.toLowerCase()}`
                            const tokenSymbol = transferToken === customUsdcToken ? 'USDC' : 'NAM'
                            showToast({
                              title: 'IBC Debug',
                              message: `Submitted: ${hashDisplay} (1 ${tokenSymbol})`,
                              variant: 'success',
                              ...(ibcHash && {
                                action: {
                                  label: 'View on explorer',
                                  onClick: () => window.open(explorerUrl, '_blank'),
                                  icon: <i className="fas fa-external-link-alt text-xs" />,
                                }
                              })
                            })
                            setShowMoreDropdown(false)
                          } catch (e: any) {
                            console.error('[IBC Debug] Error', e)
                            showToast({ title: 'IBC Debug', message: e?.message ?? 'Failed', variant: 'error' })
                          }
                        }}
                        className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm hover:bg-button-active/10"
                      >
                        <i className="fa-solid fa-paper-plane text-sm"></i>
                        <span>Debug IBC Outgoing</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            if (state.walletConnections.namada !== 'connected') {
                              showToast({ title: 'Namada', message: 'Connect Namada Keychain first', variant: 'error' })
                              return
                            }
                            if (!isReady || !sdk) {
                              showToast({ title: 'Namada SDK', message: 'SDK not ready', variant: 'error' })
                              return
                            }
                            const transparent = state.addresses.namada.transparent
                            const shielded = state.addresses.namada.shielded || ''
                            if (!transparent || !shielded) {
                              showToast({ title: 'Debug Orbiter', message: 'Missing Namada addresses', variant: 'error' })
                              return
                            }
                            const chainId = await fetchChainIdFromRpc((sdk as any).url)

                            // Hardcoded params per request
                            const transferToken = 'tnam1pkkyepxa05mn9naftfpqy3l665tehe859ccp2wts'
                            const amountInBase = new BigNumber(100) // 100 min-denom units
                            const channelId = 'channel-27'
                            const receiver = 'noble15xt7kx5mles58vkkfxvf0lq78sw04jajvfgd4d' // Noble Orbiter module address (testnet)
                            const memo = buildOrbiterCctpMemo({
                              destinationDomain: 0,
                              evmRecipientHex20: '0x9dcadbfa2bca34faa28840c4fc391fc421a57921',
                            })

                            // Gas token: use NAM
                            const namAddr = await getNAMAddressFromRegistry()
                            const namToken = namAddr || (import.meta.env.VITE_NAMADA_NAM_TOKEN as string)
                            const txKinds: string[] = ['IbcTransfer']
                            const gas = await estimateGasForToken(namToken, txKinds, '90000')
                            const chain = { chainId, nativeTokenAddress: gas.gasToken }

                            // Disposable wrapper if available
                            let accountPublicKey = ''
                            let ownerAddressForWrapper = transparent
                            try {
                              const namada: any = (window as any).namada
                              const signer = await namada?.getSigner?.()
                              const disposableWrapper = await signer?.genDisposableKeypair?.()
                              if (disposableWrapper?.publicKey && disposableWrapper?.address) {
                                accountPublicKey = disposableWrapper.publicKey
                                ownerAddressForWrapper = disposableWrapper.address
                              } else {
                                accountPublicKey = (await (sdk as any).rpc.queryPublicKey(transparent)) || ''
                              }
                            } catch {
                              accountPublicKey = (await (sdk as any).rpc.queryPublicKey(transparent)) || ''
                            }

                            // Use shielded source with MASP gas key
                            const allAccounts = (await getNamadaAccounts()) as any[]
                            const shieldedAccount = (allAccounts || []).find((a) => typeof a?.pseudoExtendedKey === 'string' && a.pseudoExtendedKey.length > 0)
                            const pseudoExtendedKey = shieldedAccount?.pseudoExtendedKey as string | undefined
                            if (!pseudoExtendedKey) {
                              showToast({ title: 'Debug Orbiter', message: 'No shielded account with pseudoExtendedKey found', variant: 'error' })
                              return
                            }

                            // Optional refund target
                            let refundTarget: string | undefined
                            try {
                              const namada: any = (window as any).namada
                              const signer = await namada?.getSigner?.()
                              const disposable = await signer?.genDisposableKeypair?.()
                              refundTarget = disposable?.address
                            } catch {}

                            const result = await buildSignBroadcastUnshieldingIbc(
                              {
                                sdk: sdk as any,
                                accountPublicKey,
                                ownerAddress: ownerAddressForWrapper,
                                source: pseudoExtendedKey,
                                receiver,
                                tokenAddress: transferToken,
                                amountInBase,
                                gas,
                                chain,
                                channelId,
                                gasSpendingKey: pseudoExtendedKey,
                                refundTarget,
                                memo,
                              },
                              (phase) => {
                                const map: Record<string, string> = {
                                  'building:ibc': 'Building IBC transfer (Orbiter)',
                                  'signing:ibc': 'Approve IBC in Keychain',
                                  'submitting:ibc': 'Submitting IBC transfer...',
                                  'submitted:ibc': 'IBC submitted',
                                }
                                const msg = map[phase]
                                if (msg) showToast({ title: 'Debug Orbiter', message: msg, variant: 'info' })
                              }
                            )

                            const ibcHash = (result.ibc.response as any)?.hash
                            const hashDisplay = ibcHash ? `${ibcHash.slice(0, 8)}...${ibcHash.slice(-8)}` : 'OK'
                            const explorerUrl = chainId.startsWith('housefire')
                              ? `https://testnet.namada.world/transactions/${ibcHash?.toLowerCase()}`
                              : `https://namada.world/transactions/${ibcHash?.toLowerCase()}`
                            showToast({
                              title: 'Debug Orbiter',
                              message: `Submitted: ${hashDisplay} (100 units)`,
                              variant: 'success',
                              ...(ibcHash && {
                                action: {
                                  label: 'View on explorer',
                                  onClick: () => window.open(explorerUrl, '_blank'),
                                  icon: <i className="fas fa-external-link-alt text-xs" />,
                                }
                              })
                            })
                            setShowMoreDropdown(false)
                          } catch (e: any) {
                            console.error('[Debug Orbiter] Error', e)
                            showToast({ title: 'Debug Orbiter', message: e?.message ?? 'Failed', variant: 'error' })
                          }
                        }}
                        className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm hover:bg-button-active/10"
                      >
                        <i className="fa-solid fa-rocket text-sm"></i>
                        <span>Debug Orbiter</span>
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            if (!isReady || !sdk) {
                              showToast({ title: 'Namada SDK', message: 'SDK not ready', variant: 'error' })
                              return
                            }
                            const chainId = await fetchChainIdFromRpc((sdk as any).url)
                            await clearShieldedContext(sdk as any, chainId)
                            // Reset displayed shielded balances after clearing context
                            setUsdcShieldedMinDenom(null)
                            dispatch({ type: 'MERGE_BALANCES', payload: { namada: { usdcShielded: '--', namShielded: '--' } } })
                            showToast({ title: 'Shielded Context', message: 'Cleared', variant: 'success' })
                            setShowMoreDropdown(false)
                          } catch (e: any) {
                            console.error('[Shielded Context] Clear error', e)
                            showToast({ title: 'Shielded Context', message: e?.message ?? 'Failed to clear', variant: 'error' })
                          }
                        }}
                        className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm hover:bg-button-active/10"
                      >
                        <i className="fa-solid fa-delete-left text-sm"></i>
                        <span>Clear Shielded Context</span>
                      </button>
                    </div>
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
              {isShielding && <Spinner size="sm" variant="accent" />}
              {/* <Button
                variant="primary"
                size="xs"
                leftIcon={<i className="fas fa-shield text-sm"></i>}
                onClick={async () => {
                  try {

                    const txs: TxProps[] = []
                    const txProps: TxProps[] = []

                    // Hardcoded test tx
                    const ownerAddress = "tnam1qrwml7ctgts0sj3938kdvtknpj5rzc4e5gzn0yf7"
                    const ownerPubKey = "tpknam1qqzh7p0dssqngnn872v4qsn5z4s0zms4u8d3d4m8lh48q8ppt8l87rx84vj"
                    const target = "tnam1qpncrgu9ry4qd6kenzw9pzevfwy0gkrcnqntvf2x"
                    const namAddress = "tnam1q9gr66cvu4hrzm0sd5kmlnjje82gs3xlfg3v6nu7"
                    const amount = new BigNumber(1)

                    const wrapperTxProps = {
                      chainId: "housefire-alpaca.cc0d3e0c033be",
                      feeAmount: new BigNumber(0.000001),
                      gasLimit: new BigNumber(75000),
                      token: namAddress,
                      publicKey: ownerPubKey,
                    }

                    const transferProps = {
                      data: [
                        {
                          source: ownerAddress,
                          target,
                          token: namAddress,
                          amount,
                        },
                      ],
                    }
                    const transferTx = await sdk.tx.buildTransparentTransfer(wrapperTxProps, transferProps)
                    txs.push(transferTx)
                    txProps.push(sdk.tx.buildBatch(txs))

                    const txsWithInner = txProps.map(({ args, hash, bytes, signingData }) => {
                      const innerTxHashes = sdk.tx.getInnerTxMeta(bytes)
                      return {
                        args,
                        hash,
                        bytes,
                        signingData,
                        innerTxHashes: innerTxHashes.map(([hash]: [string, any]) => hash),
                        memos: innerTxHashes.map(([, memo]: [string, any]) => memo),
                      }
                    })
                    console.log(txsWithInner)

                    const rawChecksums = await sdk.rpc.queryChecksums?.()
                    const checksums = Object.fromEntries(
                      Object.entries(rawChecksums || {}).map(([path, hash]) => [path, String(hash).toLowerCase()])
                    )

                    // When we try to deserialize our tx it also shows [] for commitments
                    const check = sdk.tx.deserialize(txsWithInner[0].bytes, checksums)
                    console.log(check.commitments)

                    const namada: any = (window as any).namada
                    if (!namada) throw new Error('Namada Keychain not available')
                    const signer = await namada.getSigner()
                    const signed = await signer?.sign(txsWithInner, ownerAddress, checksums)
                    console.log("signed:", signed)

                    if (!signed || !Array.isArray(signed) || signed.length === 0) {
                      throw new Error('Signing returned no bytes')
                    }
                    const res = await sdk.rpc.broadcastTx(signed[0])
                    console.log('broadcast result:', res)
                    showToast({ title: 'Debug tx', message: `Submitted: ${res?.hash ?? 'OK'}`, variant: 'success' })

                  } catch (e: any) {
                    console.error('[Debug tx] Error', e)
                    showToast({ title: 'Debug tx', message: e?.message ?? 'Failed', variant: 'error' })
                    try { console.groupEnd() } catch { }
                  }
                }}
              >
                Debug tx
              </Button> */}
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


