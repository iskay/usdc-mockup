import React from 'react'
import BigNumber from 'bignumber.js'
import { PixelRow } from '../../../components/layout/Pixels'
import { SelectMenu } from '../../../components/ui/SelectMenu'
import { Input } from '../../../components/ui/Input'
import { Button } from '../../../components/ui/Button'
import Spinner from '../../../components/ui/Spinner'
import InlineHash from '../../../components/ui/InlineHash'
import InlineAddress from '../../../components/ui/InlineAddress'
import { getChainOptions } from '../config'
import { useEvmConfig } from '../../../state/EvmConfigProvider'
import { validateAmount, validateForm } from '../utils/validation'
import { getNamadaTxExplorerUrl } from '../../../utils/explorer'
import { getEvmTxUrl, getEvmAddressUrl, getChainDisplayName } from '../../../utils/chain'

type Props = {
  chain: string
  setChain: (v: string) => void
  sendAmount: string
  setSendAmount: (v: string) => void
  sendAddress: string
  setSendAddress: (v: string) => void
  latestSendTx: any
  sendFeeEst: string | null
  availableShielded: string
  isShieldedSyncing: boolean
  isShieldedBalanceComputing: boolean
  sendShieldedSyncProgress: number | null
  isNamadaConnected: boolean
  onClickShieldedSync: () => void | Promise<void>
  onClickConnectNamada: () => void | Promise<void>
  onClickSendNow: () => void | Promise<void>
  autoFillDisabled: boolean
  onClickAutoFill: () => void | Promise<void>
}

const SendSection: React.FC<Props> = ({
  chain,
  setChain,
  sendAmount,
  setSendAmount,
  sendAddress,
  setSendAddress,
  latestSendTx,
  sendFeeEst,
  availableShielded,
  isShieldedSyncing,
  isShieldedBalanceComputing,
  sendShieldedSyncProgress,
  isNamadaConnected,
  onClickShieldedSync,
  onClickConnectNamada,
  onClickSendNow,
  autoFillDisabled,
  onClickAutoFill,
}) => {
  const { config } = useEvmConfig()
  
  // Generate chains dynamically from config
  const chains = config ? getChainOptions() : [{ label: 'Sepolia', value: 'sepolia', iconUrl: '/ethereum-logo.svg' }]
  
  // Get chain config for estimated times
  const chainConfig = config?.chains.find(c => c.key === chain)
  
  // Show total shielded balance (no fee subtraction)
  const calculateAvailableAmount = () => {
    return availableShielded
  }
  
  const availableAmount = calculateAvailableAmount()
  return (
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
          disabled={!!latestSendTx || !isNamadaConnected}
          left={<i className="fa-regular fa-paper-plane text-muted-fg/80"></i>}
          rightSize="lg"
          right={
            <span className="inline-flex items-center gap-2 text-muted-fg">
              <img src="/usdc-logo.svg" className="h-5 w-5" alt="USDC" />
              <span className="text-xs font-semibold text-muted-fg">USDC</span>
              <button
                type="button"
                onClick={() => setSendAmount(availableAmount)}
                disabled={!isNamadaConnected}
                className={`rounded-md font-semibold px-2 py-1 text-xs text-muted-fg hover:bg-sidebar-selected ${!isNamadaConnected ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                Max
              </button>
            </span>
          }
        />
        <div className="info-text ml-4 flex items-center gap-2">
          <span>Available: {availableAmount} USDC</span>
          {availableShielded === '--' && !isShieldedSyncing && !isShieldedBalanceComputing && (
            <button 
              type="button" 
              onClick={onClickShieldedSync} 
              disabled={!isNamadaConnected}
              className={`text-button text-xs ${!isNamadaConnected ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Click to Shielded Sync
            </button>
          )}
          {isShieldedSyncing && sendShieldedSyncProgress !== null && (
            <div className="flex items-center gap-2 text-xs text-button-text-inactive">
              <div className="w-16 h-1.5 bg-button-inactive/40 rounded-full overflow-hidden">
                <div className="h-1.5 bg-[#01daab] transition-all" style={{ width: `${Math.max(0, Math.min(100, sendShieldedSyncProgress || 0))}%` }} />
              </div>
              <span>{Math.max(0, Math.min(100, sendShieldedSyncProgress || 0))}%</span>
            </div>
          )}
        </div>
        {(() => {
          const validation = validateAmount(sendAmount, availableShielded)
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
            onClick={onClickAutoFill}
            disabled={autoFillDisabled}
            className={`text-button ${autoFillDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            Auto Fill
          </button>
        </div>
        <Input placeholder="0x..." value={sendAddress} onChange={(e) => setSendAddress(e.target.value)} disabled={!!latestSendTx || !isNamadaConnected} left={<i className="mx-1 fa-regular fa-user text-muted-fg"></i>} />
        {(() => {
          const validation = validateForm(sendAmount, availableAmount, sendAddress)
          return validation.addressError && sendAddress !== '' ? (
            <div className="text-red-400 text-sm ml-4 mt-1">{validation.addressError}</div>
          ) : null
        })()}
      </div>

      <div>
        <div className="label-text">Network</div>
        <SelectMenu value={chain} onChange={setChain} options={chains} disabled={!!latestSendTx} />
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
          <span className="info-text font-semibold text-muted-fg">{chainConfig?.estimatedTimes?.send ?? '2 - 5 minutes'}</span>
        </div>
      </div>

      {(() => {
        const validation = validateForm(sendAmount, availableAmount, sendAddress)
        if (!latestSendTx) {
          if (!isNamadaConnected) {
            return (
              <div className="flex justify-center">
                <Button
                  variant="big-connect"
                  leftIcon={<img src="/namada-logo.svg" alt="" className="h-5 w-5" />}
                  onClick={onClickConnectNamada}
                >
                  Connect to Namada
                </Button>
              </div>
            )
          }
          return (
            <div className="flex justify-center">
              <Button 
                variant="submit" 
                disabled={!validation.isValid} 
                onClick={onClickSendNow} 
                leftIcon={<img src="/rocket.svg" alt="" className="h-5 w-5" />}
              >
                Send USDC
              </Button>
            </div>
          )
        }
        const statusText = latestSendTx?.stage || 'Pending confirmation...'
        return (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-border-muted bg-card p-4">
              <div className="flex items-center gap-2 mb-2">
                {latestSendTx?.stage?.includes('Minted on') ? (
                  <i className="fa-solid fa-check-circle text-accent-green"></i>
                ) : (
                  <Spinner size="sm" variant="accent" />
                )}
                <div className="text-sm font-semibold text-foreground">{statusText}</div>
              </div>
              <div className="text-sm text-foreground-secondary">
                <div className="flex justify-between"><span>Amount</span><span className="font-semibold text-foreground">{sendAmount} USDC</span></div>
                <div className="flex justify-between"><span>Destination</span><span className="font-semibold text-foreground flex items-center gap-2">
                  <InlineAddress 
                    value={sendAddress} 
                    explorerUrl={getEvmAddressUrl(
                      latestSendTx?.evm?.chain || chain, 
                      sendAddress
                    )} 
                  />
                </span></div>
                <div className="flex justify-between"><span>Namada Send Tx</span><span className="font-mono text-xs text-foreground flex items-center gap-2">
                  <InlineHash value={latestSendTx?.namadaHash as string | undefined} explorerUrl={latestSendTx?.namadaHash ? getNamadaTxExplorerUrl(String(latestSendTx.namadaChainId || ''), latestSendTx.namadaHash as string) : undefined} />
                </span></div>
                <div className="flex justify-between"><span>
                  {latestSendTx?.evm ? 
                    `${getChainDisplayName(latestSendTx.evm.chain)} Receive Tx` :
                    `${getChainDisplayName(chain)} Receive Tx`
                  }
                </span><span className="font-mono text-xs text-foreground flex items-center gap-2">
                  <InlineHash 
                    value={latestSendTx?.evm?.hash || latestSendTx?.sepoliaHash as string | undefined} 
                    explorerUrl={
                      (latestSendTx?.evm?.hash || latestSendTx?.sepoliaHash) ? 
                        getEvmTxUrl(
                          latestSendTx?.evm?.chain || chain, 
                          latestSendTx?.evm?.hash || latestSendTx?.sepoliaHash as string
                        ) : 
                        undefined
                    } 
                  />
                </span></div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default SendSection


