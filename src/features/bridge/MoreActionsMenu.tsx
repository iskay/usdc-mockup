import React from 'react'

type MoreActionsMenuProps = {
  onDebugOrbiter: () => void
  onClearShieldedContext: () => void
  onClearTxHistory: () => void
}

export const MoreActionsMenu: React.FC<MoreActionsMenuProps> = ({ onDebugOrbiter, onClearShieldedContext, onClearTxHistory }) => {
  return (
    <div className="absolute right-0 mt-2 w-72 rounded-xl border border-button-text-inactive bg-button-inactive text-button-text-inactive p-1 shadow-lg z-50">
      <button
        type="button"
        onClick={onDebugOrbiter}
        className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm hover:bg-button-active/10"
      >
        <i className="fa-solid fa-rocket text-sm"></i>
        <span>Debug Orbiter</span>
      </button>
      <button
        type="button"
        onClick={onClearShieldedContext}
        className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm hover:bg-button-active/10"
      >
        <i className="fa-solid fa-delete-left text-sm"></i>
        <span>Clear Shielded Context</span>
      </button>
      <button
        type="button"
        onClick={onClearTxHistory}
        className="flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-sm hover:bg-button-active/10"
      >
        <i className="fa-solid fa-broom text-sm"></i>
        <span>Debug: Clear Tx History</span>
      </button>
    </div>
  )
}

export default MoreActionsMenu


