import React, { useState } from 'react'

export type TabItem = { key: string; label: string }

export type TabsProps = {
  items: TabItem[]
  value?: string
  onChange?: (key: string) => void
  className?: string
}

export const Tabs: React.FC<TabsProps> = ({ items, value, onChange, className }) => {
  const [internal, setInternal] = useState(items[0]?.key)
  const active = value ?? internal

  const handleChange = (key: string) => {
    if (onChange) onChange(key)
    else setInternal(key)
  }

  return (
    <div className={`inline-flex bg-header-bg p-0 ${className ?? ''}`}>
      {items.map((t, index) => {
        const isActive = t.key === active
        const isFirst = index === 0
        const isLast = index === items.length - 1
        
        return (
          <button
            key={t.key}
            onClick={() => handleChange(t.key)}
            className={`px-4 py-1 text-sm font-medium border-b border-transparent ${
              isFirst ? 'rounded-bl-xs rounded-tl-xs' : ''
            } ${
              isLast ? 'rounded-br-xs rounded-tr-xs' : ''
            } ${
              isActive ? 'bg-accent-yellow text-accent-yellow-text' : 'text-title hover:border-b-title/80 hover:rounded-none'
            }`}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

export default Tabs


