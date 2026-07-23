import { cn } from '../../lib/utils';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}

export function Switch({ checked, onCheckedChange, disabled, id, ...rest }: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45',
        checked ? 'bg-primary/85' : 'bg-muted-foreground/25',
      )}
      {...rest}
    >
      <span
        className={cn(
          'pointer-events-none block size-3 rounded-full bg-white/95 shadow-sm transition-transform',
          checked ? 'translate-x-3.25' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
