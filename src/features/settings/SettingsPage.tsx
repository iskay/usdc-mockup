import React from 'react'
import { Card, CardHeader, CardTitle } from '../../components/ui/Card'

export const SettingsPage: React.FC = () => {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <div className="p-6 text-center text-slate-400">
          <i className="fas fa-cog text-4xl mb-4 text-slate-600"></i>
          <p className="text-lg">Settings</p>
          <p className="text-sm">Configure your bridge preferences and wallet connections</p>
        </div>
      </Card>
    </div>
  )
}

export default SettingsPage
