import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { useToastStore } from '../../stores/toast.store';
import { cn } from '../../lib/utils';

const icons = {
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
  default: Info,
};

const colors = {
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-destructive',
  default: 'text-primary',
};

export function Toaster() {
  const { toasts, dismiss } = useToastStore();
  return (
    <div className="pointer-events-none fixed bottom-3 right-3 z-100 flex w-80 flex-col gap-1.5">
      {toasts.map((t) => {
        const Icon = icons[t.variant];
        return (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-2.5 rounded-md border border-border bg-popover p-2.5 shadow-lg shadow-black/30"
          >
            <Icon className={cn('mt-px size-3.5 shrink-0', colors[t.variant])} />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium leading-snug">{t.title}</p>
              {t.description ? (
                <p className="mt-0.5 whitespace-pre-wrap wrap-break-word text-[11px] leading-snug text-muted-foreground">
                  {t.description}
                </p>
              ) : null}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="text-muted-foreground/60 hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
