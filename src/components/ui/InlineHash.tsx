import React from 'react'

type InlineHashProps = {
  value?: string | null
  explorerUrl?: string
}

export const InlineHash: React.FC<InlineHashProps> = ({ value, explorerUrl }) => {
  if (!value) return <>—</>
  const display = `${value.slice(0, 10)}...${value.slice(-8)}`
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

export default InlineHash


