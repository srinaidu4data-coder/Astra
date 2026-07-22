import { cn } from '@/lib/utils'
import type { HTMLAttributes } from 'react'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('glass rounded-xl p-8 md:p-9', className)}
      {...props}
    />
  )
}

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        'text-[17px] font-medium tracking-tight text-white/95',
        className,
      )}
      {...props}
    />
  )
}

export function CardDesc({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn('mt-1 text-[13px] leading-relaxed text-white/45', className)}
      {...props}
    />
  )
}
