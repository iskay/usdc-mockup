import React, { useState } from 'react'
import { PixelRow } from '../../../components/layout/Pixels'
import { SelectMenu } from '../../../components/ui/SelectMenu'
import { Input } from '../../../components/ui/Input'
import { Button } from '../../../components/ui/Button'
import Spinner from '../../../components/ui/Spinner'
import InlineHash from '../../../components/ui/InlineHash'
import InlineAddress from '../../../components/ui/InlineAddress'
import { useAppState } from '../../../state/AppState'
import { useToast } from '../../../components/ui/Toast'
import { getChainOptions } from '../config'
import { useEvmConfig } from '../../../state/EvmConfigProvider'
import { validateAmount, validateForm } from '../utils/validation'
import { getNamadaTxExplorerUrl } from '../../../utils/explorer'
import { getEvmTxUrl, getChainDisplayName } from '../../../utils/chain'
import { GaslessToggle } from '../components/GaslessToggle'
import { startGaslessDepositAction } from '../services/gaslessActions'

type Props = {
  chain: string
  setChain: (v: string) => void
  depositAmount: string
  setDepositAmount: (v: string) => void
  depositAddress: string
  setDepositAddress: (v: string) => void
  latestDepositTx: any
  depositFeeEst: string | null
  availableBalance: string
  isMetaMaskConnected: boolean
  onStartEvmDeposit: () => void | Promise<void>
  onStartDepositSimulation: () => void | Promise<void>
  getNamadaAccounts: () => Promise<readonly any[]>
}

const shorten = (addr: string) => (addr?.length > 10 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr)

const DepositSection: React.FC<Props> = ({
  chain,
  setChain,
  depositAmount,
  setDepositAmount,
  depositAddress,
  setDepositAddress,
  latestDepositTx,
  depositFeeEst,
  availableBalance,
  isMetaMaskConnected,
  onStartEvmDeposit,
  onStartDepositSimulation,
  getNamadaAccounts,
}) => {
  const { state, dispatch } = useAppState()
  const { showToast } = useToast()
  const { config } = useEvmConfig()
  const [gaslessEnabled, setGaslessEnabled] = useState(false)
  
  // Generate chains dynamically from config
  const chains = config ? getChainOptions() : [{ label: 'Sepolia', value: 'sepolia', iconUrl: '/ethereum-logo.svg' }]

  // Check if gas-less is supported for this chain using config
  const chainConfig = config?.chains.find(c => c.key === chain)
  const showGaslessOption = chainConfig?.gasless?.enabled === true && isMetaMaskConnected

  return (
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
          disabled={!!latestDepositTx || !isMetaMaskConnected}
          left={<i className="fa-regular fa-paper-plane text-muted-fg/80"></i>}
          rightSize="lg"
          right={
            <span className="inline-flex items-center gap-2 text-muted-fg">
              <img src="/usdc-logo.svg" className="h-5 w-5" alt="USDC" />
              <span className="text-xs font-semibold text-muted-fg">USDC</span>
              <button
                type="button"
                onClick={() => setDepositAmount(availableBalance)}
                disabled={!isMetaMaskConnected}
                className={`rounded-md font-semibold px-2 py-1 text-xs text-muted-fg hover:bg-sidebar-selected ${!isMetaMaskConnected ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Max
              </button>
            </span>
          }
        />
        <div className="info-text ml-4">Available: {availableBalance} USDC</div>
        {(() => {
          const validation = validateAmount(depositAmount, availableBalance)
          return !validation.isValid && depositAmount ? (
            <div className="text-red-400 text-sm ml-4 mt-1">{validation.error}</div>
          ) : null
        })()}
      </div>

      <div>
        <div className="label-text">Network</div>
        <SelectMenu value={chain} onChange={setChain} options={chains} disabled={!!latestDepositTx} />
        <div className="info-text ml-4">
          My Address: {chain === 'namada' ? shorten(state.addresses.namada.transparent) : (state.walletConnections.metamask === 'connected' ? shorten(state.addresses.sepolia || state.addresses.ethereum || state.addresses.base || state.addresses.polygon || state.addresses.arbitrum) : (
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
                        polygon: account,
                        arbitrum: account,
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

      {/* Gas-less Toggle - only show for supported EVM chains */}
      {showGaslessOption && (
        <GaslessToggle
          enabled={gaslessEnabled}
          onToggle={setGaslessEnabled}
          chain={chain}
          amount={depositAmount}
          userAddress={state.addresses.sepolia || state.addresses.ethereum || state.addresses.base || state.addresses.polygon || state.addresses.arbitrum}
          availableBalance={availableBalance}
        />
      )}

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
        <Input placeholder="tnam..." value={depositAddress} onChange={(e) => setDepositAddress(e.target.value)} disabled={!!latestDepositTx || !isMetaMaskConnected} left={<i className="mx-1 fa-regular fa-user text-muted-fg"></i>} />
        {(() => {
          const validation = validateForm(depositAmount, availableBalance, depositAddress)
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
          <span className="info-text font-semibold text-muted-fg">{chainConfig?.estimatedTimes?.deposit ?? '2 - 3 minutes'}</span>
        </div>
      </div>

      {(() => {
        const selected = chains.find((c) => c.value === chain)
        const isConnected = state.walletConnections.metamask === 'connected'
        const validation = validateForm(depositAmount, availableBalance, depositAddress)
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

        if (!latestDepositTx) {
          return (
            <div className="flex justify-center">
              <Button
                variant="submit"
                disabled={!validation.isValid || !isMetaMaskConnected}
                onClick={async () => {
                  if (gaslessEnabled) {
                    // Execute gas-less deposit action
                    await startGaslessDepositAction({
                      sdk: null, // Not needed for gas-less transactions
                      state,
                      dispatch,
                      showToast,
                      getNamadaAccounts
                    }, {
                      chain,
                      amount: depositAmount,
                      destinationAddress: depositAddress,
                      validateForm,
                      getAvailableBalance: () => availableBalance
                    })
                  } else {
                    void onStartEvmDeposit()
                  }
                }}
                leftIcon={<img src="/rocket.svg" alt="" className="h-5 w-5" />}
              >
                Deposit USDC
              </Button>
            </div>
          )
        }

        const statusText = latestDepositTx?.stage || 'Pending confirmation...'

        return (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-border-muted bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                {latestDepositTx?.stage === 'Received on Namada' ? (
                  <i className="fa-solid fa-check-circle text-accent-green"></i>
                ) : (
                  <Spinner size="sm" variant="accent" />
                )}
                <div className="text-sm font-semibold text-foreground">{statusText}</div>
              </div>
              <div className="text-sm text-foreground-secondary">
                <div className="flex justify-between"><span>Amount</span><span className="font-semibold text-foreground">{depositAmount} USDC</span></div>
                <div className="flex justify-between"><span>Destination</span><span className="font-semibold text-foreground"><InlineAddress value={depositAddress} /></span></div>
                <div className="flex justify-between"><span>On</span><span className="font-semibold text-foreground">
                  {latestDepositTx?.evm ? 
                    `${getChainDisplayName(latestDepositTx.evm.chain)} → Namada` :
                    `${chains.find(c => c.value === chain)?.label} → Namada`
                  }
                </span></div>
                <div className="flex justify-between"><span>
                  {latestDepositTx?.evm ? 
                    `${getChainDisplayName(latestDepositTx.evm.chain)} Send Tx` :
                    `${getChainDisplayName(chain)} Send Tx`
                  }
                </span><span className="font-mono text-xs text-foreground flex items-center gap-2">
                  <InlineHash 
                    value={latestDepositTx?.evm?.hash || latestDepositTx?.sepoliaHash as string | undefined} 
                    explorerUrl={
                      (latestDepositTx?.evm?.hash || latestDepositTx?.sepoliaHash) ? 
                        getEvmTxUrl(
                          latestDepositTx?.evm?.chain || chain, 
                          latestDepositTx?.evm?.hash || latestDepositTx?.sepoliaHash as string
                        ) : 
                        undefined
                    } 
                  />
                </span></div>
                <div className="flex justify-between"><span>Namada Receive Tx</span><span className="font-mono text-xs text-foreground flex items-center gap-2">
                  <InlineHash
                    value={latestDepositTx?.namadaHash as string | undefined}
                    explorerUrl={latestDepositTx?.namadaHash ? getNamadaTxExplorerUrl(String(latestDepositTx.namadaChainId || ''), latestDepositTx.namadaHash as string) : undefined}
                  />
                </span></div>
              </div>
            </div>
            <div className="text-center">
              <div className="text-xs text-muted-fg mb-3">You can view the ongoing status of this transaction in the My Transactions page</div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default DepositSection


