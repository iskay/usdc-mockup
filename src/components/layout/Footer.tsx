import React from 'react'
import { PixelRow } from './Pixels'

export const Footer: React.FC = () => {
  return (
    <footer className="mt-auto py-6">
      <div className="flex justify-center gap-4 items-center">
        <div className="mb-0"><PixelRow size={8} /></div>
        <span className="text-center text-sm text-muted-fg">Demo by Knowable</span>
      </div>
    </footer>
  )
}

export default Footer
