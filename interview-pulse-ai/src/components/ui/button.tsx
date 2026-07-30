import { cn } from '@/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl text-sm font-medium tracking-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#20B8CD]/40 disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-40 active:opacity-90 select-none',
  {
    variants: {
      variant: {
        default: 'bg-[#20B8CD] text-[#0C0C0C] hover:bg-[#1AA5B8]',
        secondary:
          'bg-[#141414] text-[#E8E8E6] border border-[#20B8CD]/25 hover:border-[#20B8CD]/50 hover:text-[#20B8CD]',
        ghost: 'text-white/50 hover:bg-[#141414] hover:text-[#20B8CD]',
        success:
          'bg-transparent text-[#20B8CD] border border-[#20B8CD]/35 hover:bg-[#20B8CD]/10',
        danger:
          'bg-transparent text-[#E85D5D] border border-[#E85D5D]/30 hover:bg-[#E85D5D]/10',
      },
      size: {
        default: 'h-10 min-h-10 px-4 max-md:min-h-11 max-md:h-11',
        sm: 'h-8 px-3 text-xs max-md:min-h-10 max-md:h-10 max-md:px-3.5',
        lg: 'h-11 px-5 max-md:min-h-12 max-md:h-12 max-md:text-[15px]',
        icon: 'h-9 w-9 max-md:h-11 max-md:w-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({
  className,
  variant,
  size,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}
