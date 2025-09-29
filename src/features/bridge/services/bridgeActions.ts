import BigNumber from 'bignumber.js'
import React from 'react'
import { fetchChainIdFromRpc } from '../../../utils/shieldedSync'
import { buildOrbiterCctpMemo } from '../../../utils/ibcMemo'
import { getNAMAddressFromRegistry } from '../../../utils/namadaBalance'
import { estimateGasForToken } from '../utils/gas'
import { buildSignBroadcastUnshieldingIbc } from '../../../utils/txUnshieldIbc'
import { getNamadaTxExplorerUrl } from '../../../utils/explorer'
import { getPhaseMessage } from '../utils/txMessages'
import { evmHex20ToBase64_32 } from '../../../utils/ibcMemo'
import { getUSDCAddressFromRegistry, getAssetDecimalsByDisplay } from '../../../utils/namadaBalance'
import { fetchLatestHeight } from '../../../utils/noblePoller'
import { buildSignBroadcastShielding, type GasConfig as ShieldGasConfig } from '../../../utils/txShield'
import { depositForBurnSepolia } from '../../../utils/evmCctp'
import { encodeBech32ToBytes32 } from '../../../utils/forwarding'

type Deps = {
  sdk: any
  state: any
  dispatch: (action: any) => void
  showToast: (args: { title: string; message: string; variant: 'info' | 'warning' | 'success' | 'error'; action?: any }) => void
  getNamadaAccounts: () => Promise<readonly any[]>
}

type ShieldInputs = {
  tokenAddress: string
  display: string
  amountInBase?: BigNumber
  gas?: ShieldGasConfig
  onComplete?: () => void
}

type DepositInputs = {
  amount: string
  destinationAddress: string
  chain: string
  getAvailableBalance: (chain: string) => string
  validateForm: (amount: string, balance: string, address: string) => { isValid: boolean }
  txId?: string
}

type ConnectNamadaInputs = {
  onSuccess?: () => void
}

export async function debugOrbiterAction({ sdk, state, dispatch, showToast, getNamadaAccounts }: Deps) {
  if (state.walletConnections.namada !== 'connected') {
    showToast({ title: 'Namada', message: 'Connect Namada Keychain first', variant: 'error' })
    return
  }
  if (!sdk) {
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
  const transferToken = 'tnam1pkkyepxa05mn9naftfpqy3l665tehe859ccp2wts'
  const amountInBase = new BigNumber(100)
  const channelId = 'channel-27'
  const receiver = 'noble15xt7kx5mles58vkkfxvf0lq78sw04jajvfgd4d'
  const memo = buildOrbiterCctpMemo({ destinationDomain: 0, evmRecipientHex20: '0x9dcadbfa2bca34faa28840c4fc391fc421a57921' })

  const namAddr = await getNAMAddressFromRegistry()
  const namToken = namAddr || (import.meta.env.VITE_NAMADA_NAM_TOKEN as string)
  const gas = await estimateGasForToken(namToken, ['IbcTransfer'], '90000')
  const chain = { chainId, nativeTokenAddress: gas.gasToken }

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

  const allAccounts = [...(await getNamadaAccounts())]
  const shieldedAccount = (allAccounts || []).find((a) => typeof a?.pseudoExtendedKey === 'string' && a.pseudoExtendedKey.length > 0)
  const pseudoExtendedKey = shieldedAccount?.pseudoExtendedKey as string | undefined
  if (!pseudoExtendedKey) {
    showToast({ title: 'Debug Orbiter', message: 'No shielded account with pseudoExtendedKey found', variant: 'error' })
    return
  }

  let refundTarget: string | undefined
  try {
    const namada: any = (window as any).namada
    const signer = await namada?.getSigner?.()
    const disposable = await signer?.genDisposableKeypair?.()
    refundTarget = disposable?.address
  } catch {}

  const result = await buildSignBroadcastUnshieldingIbc(
    { sdk: sdk as any, accountPublicKey, ownerAddress: ownerAddressForWrapper, source: pseudoExtendedKey, receiver, tokenAddress: transferToken, amountInBase, gas, chain, channelId, gasSpendingKey: pseudoExtendedKey, refundTarget, memo },
    (phase) => {
      const msg = getPhaseMessage('orbiter', phase)
      if (msg) showToast({ title: 'Debug Orbiter', message: msg, variant: 'info' })
    }
  )
  const ibcHash = (result.ibc.response as any)?.hash
  const hashDisplay = ibcHash ? `${ibcHash.slice(0, 8)}...${ibcHash.slice(-8)}` : 'OK'
  const explorerUrl = getNamadaTxExplorerUrl(chainId, ibcHash)
  showToast({ title: 'Debug Orbiter', message: `Submitted: ${hashDisplay} (100 units)`, variant: 'success', ...(ibcHash && { action: { label: 'View on explorer', onClick: () => window.open(explorerUrl, '_blank'), icon: React.createElement('i', { className: 'fas fa-external-link-alt text-xs' }) } }) })
}

export async function clearShieldedContextAction({ sdk, dispatch, showToast }: Deps) {
  const chainId = await fetchChainIdFromRpc((sdk as any).url)
  // call existing helper directly through BridgeForm props
  // the caller will clear local balances and dropdown
  await (await import('../../../utils/shieldedSync')).clearShieldedContext(sdk as any, chainId)
  showToast({ title: 'Shielded Context', message: 'Cleared', variant: 'success' })
}

export async function clearTxHistoryAction({ dispatch, showToast }: Deps) {
  const { createTxService } = await import('../../../services/txService')
  const svc = createTxService(dispatch)
  svc.clearHistory()
  showToast({ title: 'Tx History', message: 'Cleared (local only)', variant: 'success' })
}

type SendInputs = {
  amountDisplay: string
  destinationAddress: string
  destinationChain: string
}

export async function sendNowViaOrbiterAction({ sdk, state, dispatch, showToast, getNamadaAccounts }: Deps, inputs: SendInputs) {
  if (state.walletConnections.namada !== 'connected') {
    showToast({ title: 'Namada', message: 'Connect Namada Keychain first', variant: 'error' }); return
  }
  if (!sdk) { showToast({ title: 'Namada SDK', message: 'SDK not ready', variant: 'error' }); return }

  const transparent = state.addresses.namada.transparent
  const shielded = state.addresses.namada.shielded || ''
  if (!transparent || !shielded) { showToast({ title: 'Send', message: 'Missing Namada addresses', variant: 'error' }); return }

  const chainId = await fetchChainIdFromRpc((sdk as any).url)
  const usdcToken = await getUSDCAddressFromRegistry()
  if (!usdcToken) { showToast({ title: 'Send', message: 'USDC token address not found', variant: 'error' }); return }

  const amountInBase = new BigNumber(inputs.amountDisplay).multipliedBy(1e6)
  if (!amountInBase.isFinite() || amountInBase.isLessThanOrEqualTo(0)) { showToast({ title: 'Send', message: 'Invalid amount', variant: 'error' }); return }

  const channelId = (import.meta as any)?.env?.VITE_CHANNEL_ID_ON_NAMADA as string || 'channel-27'
  const receiver = 'noble15xt7kx5mles58vkkfxvf0lq78sw04jajvfgd4d'
  const memo = buildOrbiterCctpMemo({ destinationDomain: 0, evmRecipientHex20: inputs.destinationAddress })
  const mintRecipientB64 = evmHex20ToBase64_32(inputs.destinationAddress)

  const gas = await estimateGasForToken(usdcToken, ['IbcTransfer'], '90000')
  const chainSett = { chainId, nativeTokenAddress: gas.gasToken }

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
  const allAccounts = [...(await getNamadaAccounts())]
  const shieldedAccount = (allAccounts || []).find((a) => typeof a?.pseudoExtendedKey === 'string' && a.pseudoExtendedKey.length > 0)
  const pseudoExtendedKey = shieldedAccount?.pseudoExtendedKey as string | undefined
  if (!pseudoExtendedKey) { showToast({ title: 'Send', message: 'No shielded account with pseudoExtendedKey found', variant: 'error' }); return }

  // Optional refund target
  let refundTarget: string | undefined
  try {
    const namada: any = (window as any).namada
    const signer = await namada?.getSigner?.()
    const disposable = await signer?.genDisposableKeypair?.()
    refundTarget = disposable?.address
  } catch {}

  // Generate a stable transaction ID once at the beginning
  const txId = `send_${Date.now()}`
  let transactionAdded = false

  const result = await buildSignBroadcastUnshieldingIbc(
    { sdk: sdk as any, accountPublicKey, ownerAddress: ownerAddressForWrapper, source: pseudoExtendedKey, receiver, tokenAddress: usdcToken, amountInBase, gas, chain: chainSett, channelId, gasSpendingKey: pseudoExtendedKey, memo, refundTarget },
    (phase) => {
      const msg = getPhaseMessage('send', phase)
      if (msg) showToast({ title: 'Send', message: msg, variant: 'info' })
      if (msg) {
        if (!transactionAdded) {
          // Add transaction only once on first phase message
          dispatch({ type: 'ADD_TRANSACTION', payload: { id: txId, kind: 'send', amount: inputs.amountDisplay, fromChain: 'namada', toChain: 'sepolia', destination: inputs.destinationAddress, stage: msg, status: 'pending', namadaChainId: chainId, createdAt: Date.now(), updatedAt: Date.now() } })
          transactionAdded = true
        } else {
          // Update existing transaction for subsequent phase messages
          dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: txId, changes: { stage: msg } } })
        }
      }
    }
  )

  const ibcHash = (result.ibc.response as any)?.hash
  dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: txId, changes: { hash: ibcHash, namadaHash: ibcHash, stage: 'Submitted to Namada' } } })
  const hashDisplay = ibcHash ? `${ibcHash.slice(0, 8)}...${ibcHash.slice(-8)}` : 'OK'
  const explorerUrl = getNamadaTxExplorerUrl(chainId, ibcHash)
  showToast({ title: 'Send', message: `Submitted: ${hashDisplay} (${inputs.amountDisplay} USDC)`, variant: 'info', ...(ibcHash && { action: { label: 'View on explorer', onClick: () => window.open(explorerUrl, '_blank'), icon: React.createElement('i', { className: 'fas fa-external-link-alt text-xs' }) } }) })

  // Start dedicated worker for this tx to poll Noble + Sepolia in isolation
  try {
    const nobleRpc = (import.meta as any)?.env?.VITE_NOBLE_RPC as string
    const startHeight = (await fetchLatestHeight(nobleRpc)) + 1
    const destinationCallerB64 = (import.meta as any)?.env?.VITE_PAYMENT_DESTINATION_CALLER ? evmHex20ToBase64_32((import.meta as any).env.VITE_PAYMENT_DESTINATION_CALLER as string) : ''
    const sepoliaRpc = (import.meta as any)?.env?.VITE_SEPOLIA_RPC as string
    const usdcAddr = (import.meta as any)?.env?.VITE_USDC_SEPOLIA as string
    const worker = new Worker(new URL('../../../workers/OrbiterTxWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (ev: MessageEvent) => {
      const data = ev.data as any
      if (data.type === 'update' && data.id === txId) {
        const changes: any = {}
        if (data.data.stage) changes.stage = data.data.stage
        if (data.data.status) changes.status = data.data.status
        if (data.data.sepoliaHash) changes.sepoliaHash = data.data.sepoliaHash
        if (data.data.errorMessage) changes.errorMessage = data.data.errorMessage
        if (Object.keys(changes).length > 0) {
          dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: txId, changes } })
        }
      } else if (data.type === 'complete' && data.id === txId) {
        if (data.data?.sepoliaHash) {
          dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: txId, changes: { sepoliaHash: data.data.sepoliaHash, stage: 'Minted on Sepolia', status: 'success' } } })
        }
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
          recipient: inputs.destinationAddress,
          amountBaseUnits: amountInBase.toString(),
          timeoutMs: 5 * 60 * 1000,
          intervalMs: 5000,
        },
      }
    })
  } catch (e) {
    console.warn('[Polling Worker] spawn/start failed', e)
  }
}

export async function shieldNowForTokenAction({ sdk, state, dispatch, showToast }: Deps, inputs: ShieldInputs) {
  if (state.walletConnections.namada !== 'connected') {
    showToast({ title: 'Namada', message: 'Connect Namada Keychain first', variant: 'error' })
    return
  }
  if (!sdk) {
    showToast({ title: 'Namada SDK', message: 'SDK not ready', variant: 'error' })
    return
  }

  const chainId = await fetchChainIdFromRpc((sdk as any).url)
  const transparent = state.addresses.namada.transparent
  const shielded = state.addresses.namada.shielded || ''
  if (!transparent || !shielded) {
    showToast({ title: 'Shield', message: 'Missing Namada addresses', variant: 'error' })
    return
  }

  try {
    // Drive user toasts by build/sign/submit phases coming from txShield
    const decimals = getAssetDecimalsByDisplay(inputs.display, 6)
    const defaultAmountInBase = new BigNumber(1).multipliedBy(new BigNumber(10).pow(decimals))
    let amountInBase = inputs.amountInBase ?? defaultAmountInBase
    
    // Determine public key presence (affects fee estimate via potential RevealPk)
    const publicKey = (await (sdk as any).rpc.queryPublicKey(transparent)) || ''

    // Compute gas dynamically using indexer
    const txKinds: string[] = ['ShieldingTransfer']
    if (!publicKey) txKinds.unshift('RevealPk')
    let gas = await estimateGasForToken(inputs.tokenAddress, txKinds)

    // Allow explicit override of gas only for limit/price, but enforce selected gas token
    if (inputs.gas) {
      gas = {
        gasToken: gas.gasToken,
        gasLimit: inputs.gas.gasLimit,
        gasPriceInMinDenom: inputs.gas.gasPriceInMinDenom,
      }
    }

    // If using the same token for gas as the token being shielded, subtract gas fees from amount
    if (gas.gasToken === inputs.tokenAddress) {
      const gasFeeInMinDenom = new BigNumber(gas.gasLimit).multipliedBy(gas.gasPriceInMinDenom)
      amountInBase = BigNumber.max(amountInBase.minus(gasFeeInMinDenom), 0)
      console.info(`[Shield ${inputs.display.toUpperCase()}] Subtracting gas fees: ${gasFeeInMinDenom.toString()} from amount`)
    }

    const chain = { chainId, nativeTokenAddress: gas.gasToken }
    const label = inputs.display.toUpperCase()
    console.group(`[Shield ${label}]`)
    console.info('Inputs', { chainId, token: inputs.tokenAddress, transparent, shielded, amountInBase: amountInBase.toString(), gas: { token: gas.gasToken, gasLimit: gas.gasLimit.toString(), gasPrice: gas.gasPriceInMinDenom.toString() }, publicKeyPresent: !!publicKey })
    if (!publicKey) {
      showToast({ title: 'Shield', message: 'Public key not revealed. A reveal tx will be appended.', variant: 'info' })
    }

    const { txs, signed, response: res } = await buildSignBroadcastShielding({
      sdk: sdk as any,
      transparent,
      shielded,
      tokenAddress: inputs.tokenAddress,
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
    const explorerUrl = getNamadaTxExplorerUrl(chainId, hash)
    showToast({ 
      title: 'Shield', 
      message: `Submitted: ${hashDisplay}`, 
      variant: 'success',
      ...(hash && {
        action: {
          label: 'View on explorer',
          onClick: () => window.open(explorerUrl, '_blank'),
          icon: React.createElement('i', { className: 'fas fa-external-link-alt text-xs' })
        }
      })
    })

    // Centralize shield tracking in service
    try {
      const { createTxService } = await import('../../../services/txService')
      const svc = createTxService(dispatch)
      const txId = `shield_${Date.now()}`
      svc.trackShield({ txId, amount: amountInBase.toString(), tokenSymbol: (inputs.display.toUpperCase() as any), namadaHash: hash, namadaChainId: chainId })
    } catch {}
    
    console.groupEnd()
    inputs.onComplete?.()
  } catch (error: any) {
    console.error('[Shield] Error:', error)
    showToast({ title: 'Shield', message: error?.message ?? 'Shield transaction failed', variant: 'error' })
    console.groupEnd()
  }
}

export async function startSepoliaDepositAction({ sdk, dispatch, showToast }: Deps, inputs: DepositInputs) {
  if (!window.ethereum) {
    showToast({ title: 'MetaMask Not Found', message: 'Please install the MetaMask extension', variant: 'error' })
    return
  }

  const validation = inputs.validateForm(inputs.amount, inputs.getAvailableBalance(inputs.chain), inputs.destinationAddress)
  if (!validation.isValid) return

  // Fetch the current Namada chain ID
  const chainId = await fetchChainIdFromRpc((sdk as any).url)

  const txId = inputs.txId || `dep_${Date.now()}`
  dispatch({
    type: 'ADD_TRANSACTION',
    payload: {
      id: txId,
      kind: 'deposit',
      amount: inputs.amount,
      fromChain: 'sepolia',
      toChain: 'namada',
      destination: inputs.destinationAddress,
      status: 'submitting',
      namadaChainId: chainId,
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
    console.log('   Namada recipient:', inputs.destinationAddress)
    
    if (!lcdUrl) throw new Error('VITE_NOBLE_LCD_URL not set')
    const url = `${lcdUrl}/noble/forwarding/v1/address/${channelId}/${inputs.destinationAddress}/`
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
    amountUsdc: inputs.amount,
    forwardingAddressBytes32: mintRecipient,
    usdcAddress: usdcAddr,
    tokenMessengerAddress: tokenMessenger,
    destinationDomain,
  })

  dispatch({ type: 'UPDATE_TRANSACTION', payload: { id: txId, changes: { status: 'pending', hash: txHash } } })
  showToast({ title: 'Deposit', message: 'Pending confirmation…', variant: 'warning' })

  // Notify backend tracker with Noble forwarding address for auto-registration
  try {
    const backendBase = (import.meta as any)?.env?.VITE_BACKEND_BASE || 'http://localhost:8080'
    const channelId = (import.meta as any)?.env?.VITE_NOBLE_TO_NAMADA_CHANNEL || 'channel-136'
    console.log('📨 Notifying backend tracker:', { backendBase, forwardingAddress, recipient: inputs.destinationAddress, channelId })
    await fetch(`${backendBase.replace(/\/$/, '')}/api/track`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: forwardingAddress, recipient: inputs.destinationAddress, channel: channelId }),
    })
  } catch (e: any) {
    console.warn('Tracker notify failed:', e?.message || e)
  }

  // Start centralized tracking via TxService (keeps UI dual-write for now)
  try {
    const { createTxService } = await import('../../../services/txService')
    const svc = createTxService(dispatch)
    void svc.trackDeposit({ txId, amountUsdc: inputs.amount, forwardingAddress, namadaReceiver: inputs.destinationAddress, sepoliaHash: txHash })
  } catch (e) {
    console.warn('[TxService] trackDeposit start failed', e)
  }
}

export async function connectNamadaAction({ sdk, state, dispatch, showToast, getNamadaAccounts }: Deps, inputs: ConnectNamadaInputs) {
  try {
    const { useNamadaKeychain } = await import('../../../utils/namada')
    const { fetchChainIdFromRpc } = await import('../../../utils/shieldedSync')
    const { connect, checkConnection, getDefaultAccount, getAccounts, isAvailable } = useNamadaKeychain()
    const available = await isAvailable()
    if (!available) {
      showToast({ title: 'Namada Keychain', message: 'Please install the Namada Keychain extension', variant: 'error' })
      return
    }
    const chainId = await fetchChainIdFromRpc((sdk as any).url)
    await connect(chainId)
    const ok = await checkConnection(chainId)
    if (ok) {
      const acct: any = await getDefaultAccount()
      dispatch({ type: 'SET_WALLET_CONNECTION', payload: { namada: 'connected' } })
      let shieldedAddr: string | undefined
      try {
        const accounts: any[] = (await getAccounts()) as any[]
        const parent = Array.isArray(accounts) ? accounts.find((a) => a?.address === acct?.address) : undefined
        const child = parent?.id ? accounts.find((a) => (a?.parentId === parent.id) && typeof a?.address === 'string' && String(a?.type || '').toLowerCase().includes('shielded')) : undefined
        if (child?.address && String(child.address).startsWith('z')) shieldedAddr = child.address as string
      } catch {}
      if (acct?.address) {
        dispatch({
          type: 'SET_ADDRESSES',
          payload: {
            ...state.addresses,
            namada: { ...state.addresses.namada, transparent: acct.address, shielded: shieldedAddr || state.addresses.namada.shielded },
          },
        })
      }
      showToast({ title: 'Namada Keychain', message: 'Connected', variant: 'success' })
      inputs.onSuccess?.()
    } else {
      showToast({ title: 'Namada Keychain', message: 'Failed to connect', variant: 'error' })
    }
  } catch (e: any) {
    showToast({ title: 'Namada Keychain', message: e?.message ?? 'Connection failed', variant: 'error' })
  }
}



