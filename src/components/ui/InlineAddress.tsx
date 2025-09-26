import React from 'react'

type InlineAddressProps = {
  value?: string | null
  explorerUrl?: string
  shorten?: boolean
}

export const InlineAddress: React.FC<InlineAddressProps> = ({ value, explorerUrl, shorten = true }) => {
  if (!value) return <>—</>
  const display = shorten ? `${value.slice(0, 10)}...${value.slice(-8)}` : value
  return (
    <>
      <span>{display}</span>
      <button
        onClick={() => { navigator.clipboard.writeText(value) }}
        title="Copy to Clipboard"
        className="rounded px-1 py-0.5 hover:bg-button-active/10 active:scale-95 transition"
        style={{ transitionDelay: '0ms' }}
      >
        <i className="fas fa-copy text-[11px]" />
      </button>
      {explorerUrl && (
        <button
          onClick={() => window.open(explorerUrl, '_blank')}
          title="View on Explorer"
          className="rounded px-1 py-0.5 hover:bg-button-active/10 active:scale-95 transition"
          style={{ transitionDelay: '0ms' }}
        >
          <i className="fas fa-arrow-up-right-from-square text-[11px]" />
        </button>
      )}
    </>
  )
}

export default InlineAddress


