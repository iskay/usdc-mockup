import React, { useState } from 'react'
import { SidebarButton } from '../ui/SidebarButton'

type NavItem = { label: string; icon: string; key: string }

const nav: NavItem[] = [
  { label: 'Deposit & Send', icon: 'fas fa-exchange-alt', key: 'bridge' },
  { label: 'History', icon: 'fas fa-history', key: 'history' },
  // { label: 'Settings', icon: 'fas fa-cog', key: 'settings' },
]

export type SidebarProps = {
  activeTab: string
  onTabChange: (tab: string) => void
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange }) => {
  return (
    <aside className="hidden md:flex w-80 shrink-0 flex-col gap-6 bg-sidebar-bg p-8">
      <div className="mb-2 flex items-center gap-4 px-2 text-[1.3em] text-sidebar-fg font-semibold">
        <i className="fa-solid fa-bridge-lock text-sidebar-fg text-xl" />
        USDC Dot Delivery
      </div>
      <nav className="flex flex-col gap-4 pl-4">
        {nav.map((n) => (
          <SidebarButton
            key={n.key}
            text={n.label}
            icon={n.icon}
            active={activeTab === n.key}
            onClick={() => onTabChange(n.key)}
          />
        ))}
      </nav>
    </aside>
  )
}

export default Sidebar


