import React, { useEffect, useRef, useState } from 'react'

export type SelectMenuOption<T extends string | number = string> = {
  label: string
  value: T
  iconUrl?: string
}

export type SelectMenuProps<T extends string | number = string> = {
  value: T
  onChange: (value: T) => void
  options: Array<SelectMenuOption<T>>
  placeholder?: string
  className?: string
}

export function SelectMenu<T extends string | number = string>({
  value,
  onChange,
  options,
  placeholder,
  className,
}: SelectMenuProps<T>) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  const selected = options.find((o) => String(o.value) === String(value))

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [])

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="input-style py-3 pr-9 pl-3 text-left"
      >
        <span className="inline-flex items-center gap-2">
          {selected?.iconUrl ? (
            <img src={selected.iconUrl} alt="" className="h-4 w-4" />
          ) : null}
          <span>{selected?.label ?? placeholder ?? 'Select'}</span>
        </span>
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-fg">▾</span>
      </button>
      {open ? (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border-muted bg-sidebar-bg p-1 shadow-lg">
          {options.map((o) => {
            const isActive = String(o.value) === String(value)
            return (
              <button
                key={String(o.value)}
                type="button"
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm ${
                  isActive ? 'bg-sidebar-selected text-sidebar-active' : 'text-foreground-secondary hover:bg-emerald-600/60'
                }`}
              >
                {o.iconUrl ? <img src={o.iconUrl} alt="" className="h-4 w-4" /> : null}
                <span>{o.label}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

export default SelectMenu


