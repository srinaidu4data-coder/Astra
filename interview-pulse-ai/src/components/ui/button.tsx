import { cn } from '@/lib/utils'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'

/** Material 3 button shapes — pill filled / outlined / text */
const buttonVariants = cva(
  [
    'inline-flex cursor-pointer items-center justify-center gap-2',
    'rounded-full text-[14px] font-medium tracking-[0.01em]',
    'transition-[background,box-shadow,color,border-color] duration-150',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8ab4f8]/50',
    'disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-38',
    'select-none',
  ].join(' '),
  {
    variants: {
      variant: {
        default:
          'bg-[#8ab4f8] text-[#062e6f] hover:bg-[#aecbfa] hover:shadow-[0_1px_2px_rgba(0,0,0,0.3),0_1px_3px_1px_rgba(0,0,0,0.15)]',
        secondary:
          'bg-transparent text-[#8ab4f8] border border-[#8ab4f8]/50 hover:bg-[#8ab4f8]/12',
        ghost: 'text-[#8ab4f8] hover:bg-[#8ab4f8]/10',
        success:
          'bg-[#81c995]/15 text-[#81c995] border border-[#81c995]/35 hover:bg-[#81c995]/22',
        danger:
          'bg-transparent text-[#f28b82] border border-[#f28b82]/40 hover:bg-[#f28b82]/12',
      },
      size: {
        default: 'h-10 min-h-10 px-6 max-md:min-h-11 max-md:h-11',
        sm: 'h-9 px-4 text-[13px] max-md:min-h-10 max-md:h-10',
        lg: 'h-12 px-7 text-[15px] max-md:min-h-12 max-md:h-12',
        icon: 'h-10 w-10 max-md:h-11 max-md:w-11',
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
