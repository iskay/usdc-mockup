import React from 'react'
import { Card, CardHeader, CardTitle } from '../../components/ui/Card'
import { useAppState } from '../../state/AppState'

export const HistoryPage: React.FC = () => {
  const { state } = useAppState()
  const txs = state.transactions
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
              const dot = tx.status === 'success' ? 'bg-emerald-500' : tx.status === 'pending' ? 'bg-yellow-500 animate-ping' : tx.status === 'submitting' ? 'bg-sky-500 animate-ping' : 'bg-red-500'
              const label = tx.kind === 'deposit' ? `${tx.fromChain} → Namada` : `Namada → ${tx.toChain}`
              return (
                <div key={tx.id} className="flex items-start gap-4 p-4">
                  <span className={`mt-1 h-2.5 w-2.5 rounded-full ${dot}`}></span>
                  <div className="flex-1">
                    <div className="flex justify-between">
                      <div className="text-sm font-semibold text-foreground">{tx.kind.toUpperCase()} • {tx.amount} USDC</div>
                      <div className="text-xs text-foreground-secondary">{fmt(tx.createdAt)}</div>
                    </div>
                    <div className="text-sm text-foreground-secondary mt-1">
                      <div className="flex justify-between"><span>Route</span><span className="text-foreground font-medium">{label}</span></div>
                      {tx.destination ? <div className="flex justify-between"><span>Destination</span><span className="font-mono text-xs text-foreground">{tx.destination}</span></div> : null}
                      {tx.hash ? <div className="flex justify-between"><span>Hash</span><span className="font-mono text-xs text-foreground">{tx.hash}</span></div> : null}
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
