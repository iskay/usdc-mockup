import React from 'react'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  left?: React.ReactNode
  right?: React.ReactNode
  rightSize?: 'sm' | 'md' | 'lg'
}

export const Input: React.FC<InputProps> = ({ className, left, right, rightSize = 'md', disabled, ...props }) => {
  return (
    <div className={`relative ${className ?? ''}`}>
      {left ? <div className={`absolute inset-y-0 left-3 flex items-center ${disabled ? 'opacity-50' : ''}`}>{left}</div> : null}
      {(() => {
        const paddingLeftClass = left ? 'pl-9' : 'pl-3'
        let paddingRightClass = 'pr-3'
        if (right) {
          paddingRightClass = rightSize === 'lg' ? 'pr-28' : rightSize === 'sm' ? 'pr-10' : 'pr-14'
        }
        return (
          <input
            className={`input-style ${disabled ? 'input-style-disabled' : ''} ${paddingLeftClass} ${paddingRightClass}`}
            disabled={disabled}
            {...props}
          />
        )
      })()}
      {right ? <div className={`absolute inset-y-0 right-3 flex items-center ${disabled ? 'opacity-50' : ''}`}>{right}</div> : null}
    </div>
  )
}

export default Input


