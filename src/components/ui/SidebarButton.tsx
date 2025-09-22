import React from 'react'

export type SidebarButtonProps = {
  text: string
  icon: string | React.ReactNode
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
      className={`flex items-center gap-3 rounded-2xl px-6 py-2 text-md font-medium transition-colors ${
        active 
          ? 'navbutton-active' 
          : 'navbutton-inactive'
      }`}
    >
      {typeof icon === 'string' ? (
        <i className={`${icon} w-4 text-center`}></i>
      ) : (
        icon
      )}
      <span>{text}</span>
    </button>
  )
}

export default SidebarButton
