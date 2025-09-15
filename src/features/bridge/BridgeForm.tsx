import React, { useEffect, useRef, useState } from 'react'
import { Card, CardHeader } from '../../components/ui/Card'
import { Tabs } from '../../components/ui/Tabs'
import { SelectMenu } from '../../components/ui/SelectMenu'
import { Input } from '../../components/ui/Input'
import { Button } from '../../components/ui/Button'
import { useAppState } from '../../state/AppState'
import { useToast } from '../../components/ui/Toast'
import { PixelRow, pixelColors } from '../../components/layout/Pixels'
import Spinner from '../../components/ui/Spinner'
import { fetchUsdcBalanceForSelectedChain } from '../../utils/evmBalance'
import { getNamadaUSDCBalance } from '../../utils/namadaBalance'

type ChainBalances = {
  [chain: string]: {
    usdc: string
  }
}

const chains = [
  { label: 'Sepolia', value: 'sepolia', iconUrl: '/ethereum-logo.svg' },
  { label: 'Ethereum', value: 'ethereum', iconUrl: '/ethereum-logo.svg' },
  { label: 'Base', value: 'base', iconUrl: '/base-logo.svg' },
  // { label: 'Polygon', value: 'polygon', iconUrl: '/polygon-logo.svg' },
  // { label: 'Arbitrum', value: 'arbitrum', iconUrl: '/arb-logo.svg' },
]

export const BridgeForm: React.FC = () => {
  const { state, dispatch } = useAppState()
  const { showToast } = useToast()
  const [activeTab, setActiveTab] = useState('deposit')
  const [chain, setChain] = useState('sepolia')
  const [depositAmount, setDepositAmount] = useState('')
  const [depositAddress, setDepositAddress] = useState('')
  const [sendAmount, setSendAmount] = useState('')
  const [sendAddress, setSendAddress] = useState('')
  const [shieldSyncStatus, setShieldSyncStatus] = useState<'green' | 'yellow' | 'red'>('green')
  const [evmChainId, setEvmChainId] = useState<string | null>(null)

  type TxStatus = 'idle' | 'submitting' | 'pending' | 'success'
  type TxState = { status: TxStatus; hash?: string }
  const [depositTx, setDepositTx] = useState<TxState>({ status: 'idle' })
  const [sendTx, setSendTx] = useState<TxState>({ status: 'idle' })
  const depositRunId = useRef(0)
  const sendRunId = useRef(0)

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

  const resetDeposit = () => {
    depositRunId.current++
    setDepositTx({ status: 'idle' })
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
        // Update balances in app state
        const updated = { ...state.balances }
        // @ts-ignore dynamic key is safe by design
        updated[chain] = { usdc: formattedBalance }
        dispatch({ type: 'SET_BALANCES', payload: updated })
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

  // Fetch Namada USDC balance for transparent account when Namada is connected
  useEffect(() => {
    const run = async () => {
      try {
        if (state.walletConnections.namada !== 'connected') {
          // Clear balance when not connected
          const updated = { ...state.balances }
          updated.namada = { ...updated.namada, usdcTransparent: '--' }
          dispatch({ type: 'SET_BALANCES', payload: updated })
          return
        }
        const addr = state.addresses.namada.transparent
        if (!addr) {
          // Clear balance when no address
          const updated = { ...state.balances }
          updated.namada = { ...updated.namada, usdcTransparent: '--' }
          dispatch({ type: 'SET_BALANCES', payload: updated })
          return
        }
        const res = await getNamadaUSDCBalance(addr)
        if (!res) {
          // Show -- when balance unavailable
          const updated = { ...state.balances }
          updated.namada = { ...updated.namada, usdcTransparent: '--' }
          dispatch({ type: 'SET_BALANCES', payload: updated })
          return
        }
        const updated = { ...state.balances }
        updated.namada = { ...updated.namada, usdcTransparent: res.formattedBalance }
        dispatch({ type: 'SET_BALANCES', payload: updated })
      } catch {
        // Show -- on error
        const updated = { ...state.balances }
        updated.namada = { ...updated.namada, usdcTransparent: '--' }
        dispatch({ type: 'SET_BALANCES', payload: updated })
      }
    }
    void run()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.walletConnections.namada, state.addresses.namada.transparent])

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
          <span className="info-text font-semibold text-muted-fg">$2.14</span>
        </div>
        <div className="flex justify-between">
          <div className="flex gap-2 items-baseline">
            <i className="fa-solid fa-stopwatch text-foreground-secondary text-xs"></i>
            <div className="info-text text-foreground-secondary">Estimated deposit time</div>
          </div>
          <span className="info-text font-semibold text-muted-fg">20 - 25 minutes</span>
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
                onClick={startDepositSimulation}
                leftIcon={<img src="/rocket.svg" alt="" className="h-5 w-5" />}
              >
                Deposit USDC
              </Button>
            </div>
          )
        }

        const statusText =
          depositTx.status === 'submitting' ? 'Submitting transaction...'
            : depositTx.status === 'pending' ? 'Pending confirmation...'
              : 'Success'

        return (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-border-muted bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                {depositTx.status === 'success' ? (
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
                <div className="flex justify-between"><span>Tx Hash</span><span className="font-mono text-xs text-foreground">{depositTx.hash?.slice(0, 10)}...{depositTx.hash?.slice(-8)}</span></div>
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
        <div className="info-text ml-4">Available: {state.balances.namada.usdcShielded} USDC</div>
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
          <span className="info-text font-semibold text-muted-fg">$0.12</span>
        </div>
        <div className="flex justify-between">
          <div className="flex gap-2 items-baseline">
            <i className="fa-solid fa-stopwatch text-foreground-secondary text-xs"></i>
            <div className="info-text text-foreground-secondary">Estimated send time</div>
          </div>
          <span className="info-text font-semibold text-muted-fg">5 - 10 minutes</span>
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
                    const { connect, checkConnection, getDefaultAccount, isAvailable } = useNamadaKeychain()
                    const available = await isAvailable()
                    if (!available) {
                      showToast({ title: 'Namada Keychain', message: 'Please install the Namada Keychain extension', variant: 'error' })
                      return
                    }
                    await connect()
                    const ok = await checkConnection()
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
              <Button variant="submit" disabled={!validation.isValid} onClick={startSendSimulation} leftIcon={<img src="/rocket.svg" alt="" className="h-5 w-5" />}>Send USDC</Button>
            </div>
          )
        }

        const statusText =
          sendTx.status === 'submitting' ? 'Submitting transaction...'
            : sendTx.status === 'pending' ? 'Pending confirmation...'
              : 'Success'

        return (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-border-muted bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                {sendTx.status === 'success' ? (
                  <i className="fa-solid fa-check-circle text-accent-green"></i>
                ) : (
                  <Spinner size="sm" variant="accent" />
                )}
                <div className="text-sm font-semibold text-foreground">{statusText}</div>
              </div>
              <div className="text-sm text-foreground-secondary">
                <div className="flex justify-between"><span>Amount</span><span className="font-semibold text-foreground">{sendAmount} USDC</span></div>
                <div className="flex justify-between"><span>Destination</span><span className="font-semibold text-foreground">{shorten(sendAddress)}</span></div>
                <div className="flex justify-between"><span>On chain</span><span className="font-semibold text-foreground">{chains.find(c => c.value === chain)?.label}</span></div>
                <div className="flex justify-between"><span>Tx Hash</span><span className="font-mono text-xs text-foreground">{sendTx.hash?.slice(0, 10)}...{sendTx.hash?.slice(-8)}</span></div>
              </div>
            </div>
            <div className="text-center">
              <div className="text-sm text-foreground-secondary mb-3">You can view the status of this transaction in the My Transactions page</div>
              <Button variant="ghost" size="sm" leftIcon={<i className="fas fa-rotate text-sm"></i>} onClick={resetSend}>Start new transaction</Button>
            </div>
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
              {/* Sync status indicator - placeholder: green */}
              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${shieldSyncStatus === 'green'
                    ? 'bg-accent-green'
                    : shieldSyncStatus === 'yellow'
                      ? 'bg-yellow-500'
                      : 'bg-accent-red'
                    }`}
                ></span>
              </div>
              <Button
                variant="ghost"
                size="xs"
                leftIcon={<i className="fas fa-rotate text-sm"></i>}
                onClick={() =>
                  setShieldSyncStatus(
                    shieldSyncStatus === 'green' ? 'yellow' : shieldSyncStatus === 'yellow' ? 'red' : 'green'
                  )
                }
              >
                Shielded Sync
              </Button>
            </div>
          </div>
        </CardHeader>
        <div className="space-y-4">
          {/* Balance row */}
          <div className="flex justify-start items-center gap-4">
            <div className="label-text mb-0 w-24 text-left">Transparent:</div>
            <div className="flex gap-2 items-center">
              <img src="/usdc-logo.svg" alt="USDC" className="h-5 w-5" />
              <div className="leading-none tracking-wide font-semibold text-[#01daab]">{state.balances.namada.usdcTransparent} USDC</div>
            </div>
            <div className="flex">
              <Button
                variant="primary"
                size="xs"
                leftIcon={<i className="fas fa-shield text-sm"></i>}
                onClick={() =>
                  setShieldSyncStatus(
                    shieldSyncStatus === 'green' ? 'yellow' : shieldSyncStatus === 'yellow' ? 'red' : 'green'
                  )
                }
              >
                Shield Now
              </Button>
            </div>
          </div>
          <div className="flex justify-start items-center gap-4">
            <div className="label-text mb-0 pt-1 w-24 text-left">Shielded:</div>
            <div className="flex gap-2 items-center">
              <img src="/usdc-logo.svg" alt="USDC" className="h-5 w-5" />
              <div className="leading-none tracking-wide font-semibold text-[#e7bc59]">{state.balances.namada.usdcShielded} USDC</div>
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
      </Card>
    </div>
  )
}

export default BridgeForm


