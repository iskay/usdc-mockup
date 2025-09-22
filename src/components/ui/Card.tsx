import React from 'react'

type CardProps = React.HTMLAttributes<HTMLDivElement>

export const Card: React.FC<CardProps> = ({ className, ...props }) => (
  <div
    className={`rounded-3xl border border-card-border bg-card p-8 pt-4 mx-8 ${
      className ?? ''
    }`}
    {...props}
  />
)

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className,
  ...props
}) => (
  <div className={`mb-8 flex items-center justify-between ${className ?? ''}`} {...props} />
)

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  className,
  ...props
}) => (
  <h3 className={`text-lg font-semibold text-foreground ${className ?? ''}`} {...props} />
)

export default Card


