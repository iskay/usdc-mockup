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
    <div className={`inline-flex rounded-xl bg-[#0e1114] p-1 ${className ?? ''}`}>
      {items.map((t) => {
        const isActive = t.key === active
        return (
          <button
            key={t.key}
            onClick={() => handleChange(t.key)}
            className={`px-3 py-1 text-sm font-medium rounded-md ${
              isActive ? 'bg-emerald-500/40 text-sidebar-active' : 'text-foreground-secondary hover:bg-sidebar-selected'
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


