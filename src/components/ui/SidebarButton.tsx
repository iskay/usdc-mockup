import React from 'react'

export type SidebarButtonProps = {
  text: string
  icon: string
  active?: boolean
  onClick?: () => void
}

export const SidebarButton: React.FC<SidebarButtonProps> = ({ 
  text, 
  icon, 
  active = false, 
  onClick 
}) => {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 rounded-xl px-4 py-2 text-md font-semibold transition-colors ${
        active 
          ? 'text-sidebar-active bg-sidebar-selected' 
          : 'text-sidebar-fg'
      }`}
    >
      <i className={`${icon} w-4 text-center`}></i>
      <span>{text}</span>
    </button>
  )
}

export default SidebarButton
