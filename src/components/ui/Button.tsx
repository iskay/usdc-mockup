import React from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'big-connect' | 'submit'
type ButtonSize = 'sm' | 'md' | 'lg'

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

function getVariantClasses(variant: ButtonVariant): string {
  switch (variant) {
    case 'big-connect':
      return 'big-connect-button'
    case 'submit':
      return 'submit-button'
    case 'secondary':
      return 'bg-slate-800 text-slate-100 hover:bg-slate-700 border border-slate-700'
    case 'ghost':
      return 'bg-transparent text-foreground-secondary hover:bg-muted-fg/20 border border-border-muted'
    case 'primary':
    default:
      return 'bg-emerald-500 text-black hover:bg-emerald-400'
  }
}

function getSizeClasses(size: ButtonSize): string {
  switch (size) {
    case 'sm':
      return 'h-9 px-3 text-sm'
    case 'lg':
      return 'h-11 px-6 text-lg'
    case 'md':
    default:
      return 'h-10 px-4'
  }
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  leftIcon,
  rightIcon,
  className,
  children,
  ...props
}) => {
  const base = 'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:opacity-50 disabled:pointer-events-none'
  const classes = `${base} ${getVariantClasses(variant)} ${getSizeClasses(size)} ${className ?? ''}`

  return (
    <button className={classes} {...props}>
      {leftIcon ? <span className="shrink-0">{leftIcon}</span> : null}
      <span>{children}</span>
      {rightIcon ? <span className="shrink-0">{rightIcon}</span> : null}
    </button>
  )
}

export default Button


