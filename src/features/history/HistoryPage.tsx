import React from 'react'
import { Card, CardHeader, CardTitle } from '../../components/ui/Card'
import { useAppState } from '../../state/AppState'
import { getNamadaTxExplorerUrl } from '../../utils/explorer'
import { getEvmTxUrl, getEvmAddressUrl, getChainDisplayName } from '../../utils/chain'
import Spinner from '../../components/ui/Spinner'

export const HistoryPage: React.FC = () => {
  const { state } = useAppState()
  // Deduplicate transactions by id and keep the most recent (by updatedAt/createdAt)
  const txs = React.useMemo(() => {
    const latestById = new Map<string, any>()
    for (const tx of state.transactions) {
      const prev = latestById.get(tx.id)
      const currTs = (tx.updatedAt ?? tx.createdAt) as number
      const prevTs = prev ? ((prev.updatedAt ?? prev.createdAt) as number) : -1
      if (!prev || currTs > prevTs) {
        latestById.set(tx.id, tx)
      }
    }
    const arr = Array.from(latestById.values())
    arr.sort((a, b) => ((b.updatedAt ?? b.createdAt) as number) - ((a.updatedAt ?? a.createdAt) as number))
    return arr
  }, [state.transactions])
  const fmt = (n: number) => new Date(n).toLocaleString()
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>My Transactions</CardTitle>
        </CardHeader>
        {txs.length === 0 ? (
          <div className="p-6 text-center text-foreground-secondary">
            <i className="fas fa-history text-4xl mb-4 text-muted-fg"></i>
            <p className="text-lg font-semibold">No transactions yet</p>
            <p className="text-sm mt-2">Your bridge and payment history will appear here</p>
          </div>
        ) : (
          <div className="divide-y divide-border-muted">
            {txs.map((tx) => {
              const label = tx.kind === 'deposit' ? `${tx.fromChain} → Namada` : `Namada → ${tx.toChain}`
              // Format amount: shield transactions store in base units (1e6), others are already formatted
              const displayAmount = (tx as any).kind === 'shield'
                ? (parseFloat(tx.amount as string) / 1e6).toFixed(6).replace(/\.?0+$/, '')
                : tx.amount
              return (
                <div key={tx.id} className="flex items-start gap-4 p-4">
                  <span className="mt-1">
                    {tx.status === 'success' ? (
                      <i className="fa-solid fa-check-circle text-accent-green"></i>
                    ) : tx.status === 'error' ? (
                      <i className="fa-solid fa-circle-exclamation text-accent-red"></i>
                    ) : (
                      <Spinner size="sm" variant="accent" />
                    )}
                  </span>
                  <div className="flex-1">
                    <div className="flex justify-between">
                      <div className="text-sm font-semibold text-foreground">{tx.kind.toUpperCase()} • {displayAmount} USDC</div>
                      <div className="text-xs text-foreground-secondary">{fmt(tx.createdAt)}</div>
                    </div>
                    <div className="text-sm text-foreground-secondary mt-1">
                      <div className="flex justify-between"><span>Route</span><span className="text-foreground font-medium">{label}</span></div>
                      {tx.destination ? (
                        <div className="flex justify-between"><span>Destination</span><span className="font-mono text-xs text-foreground flex items-center gap-2">{tx.destination}
                          <button onClick={() => { navigator.clipboard.writeText(tx.destination as string) }} title="Copy to Clipboard" className="rounded px-1 py-0.5 hover:bg-button-active/10 active:scale-95 transition" style={{ transitionDelay: '0ms' }}><i className="fas fa-copy text-[11px]" /></button>
                          <button onClick={() => {
                            const chain = tx.kind === 'deposit' ? tx.fromChain : tx.toChain
                            const url = getEvmAddressUrl(chain as string, tx.destination as string)
                            if (url) window.open(url, '_blank')
                          }} title="View on Explorer" className="rounded px-1 py-0.5 hover:bg-button-active/10 active:scale-95 transition" style={{ transitionDelay: '0ms' }}><i className="fas fa-arrow-up-right-from-square text-[11px]" /></button>
                        </span></div>
                      ) : null}
                      {tx.stage ? <div className="flex justify-between"><span>Stage</span><span className="text-foreground font-medium">{tx.stage}</span></div> : null}
                      {tx.namadaHash ? (
                        <div className="flex justify-between"><span>Namada Tx</span><span className="font-mono text-xs text-foreground flex items-center gap-2">{tx.namadaHash}
                          <button onClick={() => { navigator.clipboard.writeText(tx.namadaHash as string) }} title="Copy to Clipboard" className="rounded px-1 py-0.5 hover:bg-button-active/10 active:scale-95 transition" style={{ transitionDelay: '0ms' }}><i className="fas fa-copy text-[11px]" /></button>
                          <button onClick={() => {
                            const hash = tx.namadaHash as string
                            const chainId = (tx as any).namadaChainId || ''
                            const url = getNamadaTxExplorerUrl(chainId, hash)
                            window.open(url, '_blank')
                          }} title="View on Explorer" className="rounded px-1 py-0.5 hover:bg-button-active/10 active:scale-95 transition" style={{ transitionDelay: '0ms' }}><i className="fas fa-arrow-up-right-from-square text-[11px]" /></button>
                        </span></div>
                      ) : null}
                      {(tx.evm?.hash || tx.sepoliaHash) ? (
                        <div className="flex justify-between">
                          <span>
                            {tx.evm ? 
                              `${getChainDisplayName(tx.evm.chain)} Tx` : 
                              `${getChainDisplayName(tx.fromChain as string)} Tx`
                            }
                          </span>
                          <span className="font-mono text-xs text-foreground flex items-center gap-2">
                            {tx.evm?.hash || tx.sepoliaHash}
                            <button onClick={() => { 
                              navigator.clipboard.writeText(tx.evm?.hash || tx.sepoliaHash as string) 
                            }} title="Copy to Clipboard" className="rounded px-1 py-0.5 hover:bg-button-active/10 active:scale-95 transition" style={{ transitionDelay: '0ms' }}>
                              <i className="fas fa-copy text-[11px]" />
                            </button>
                            <button onClick={() => {
                              const hash = tx.evm?.hash || tx.sepoliaHash as string
                              const chain = tx.evm?.chain || tx.fromChain as string
                              const url = getEvmTxUrl(chain, hash)
                              if (url) window.open(url, '_blank')
                            }} title="View on Explorer" className="rounded px-1 py-0.5 hover:bg-button-active/10 active:scale-95 transition" style={{ transitionDelay: '0ms' }}>
                              <i className="fas fa-arrow-up-right-from-square text-[11px]" />
                            </button>
                          </span>
                        </div>
                      ) : null}
                      <div className="flex justify-between"><span>Status</span><span className="text-foreground font-medium">{tx.status}</span></div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

export default HistoryPage
