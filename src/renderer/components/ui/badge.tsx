import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/**
 * Quiet status chip: small dot + label. Used for states like
 * running/stopped/valid/expired instead of loud colored pills.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] font-medium leading-4',
  {
    variants: {
      variant: {
        default: 'text-muted-foreground',
        success: 'text-foreground/90',
        warning: 'text-foreground/90',
        destructive: 'text-foreground/90',
        info: 'text-foreground/90',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

const dotColors = {
  default: 'bg-muted-foreground/50',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
  info: 'bg-primary',
} as const;

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Hide the status dot for purely informational chips. */
  noDot?: boolean;
}

export function Badge({ className, variant, noDot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {noDot ? null : (
        <span className={cn('size-1.5 shrink-0 rounded-full', dotColors[variant ?? 'default'])} />
      )}
      {children}
    </span>
  );
}
