import React from 'react'
import { Card, CardHeader, CardTitle } from '../../components/ui/Card'

export const HistoryPage: React.FC = () => {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Transaction History</CardTitle>
        </CardHeader>
        <div className="p-6 text-center text-slate-400">
          <i className="fas fa-history text-4xl mb-4 text-slate-600"></i>
          <p className="text-lg">No transactions yet</p>
          <p className="text-sm">Your bridge and payment history will appear here</p>
        </div>
      </Card>
    </div>
  )
}

export default HistoryPage
