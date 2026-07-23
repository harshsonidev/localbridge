import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Standard page chrome: a fixed 44px header bar with the page title on
 * the left and actions on the right, above a scrollable content area.
 */
export function PageShell({
  title,
  meta,
  actions,
  children,
  contentClassName,
}: {
  title: string;
  /** Small muted annotation next to the title (counts, state...). */
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h1 className="text-[13px] font-semibold tracking-tight">{title}</h1>
          {meta ? <span className="truncate text-[11.5px] text-muted-foreground">{meta}</span> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      <div className={cn('min-h-0 flex-1 overflow-y-auto p-4', contentClassName)}>{children}</div>
    </div>
  );
}
