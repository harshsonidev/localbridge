import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border py-12 text-center">
      <Icon className="size-5 text-muted-foreground/50" />
      <h3 className="mt-2.5 text-[12.5px] font-medium">{title}</h3>
      <p className="mt-1 max-w-xs text-[11.5px] leading-relaxed text-muted-foreground">{description}</p>
      {action ? <div className="mt-3.5">{action}</div> : null}
    </div>
  );
}
