import {
  LayoutDashboard,
  Globe,
  Activity,
  ShieldCheck,
  ScrollText,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useAppStore, type Page } from '../../stores/app.store';
import { cn } from '../../lib/utils';

const sections: { label: string | null; items: { page: Page; label: string; icon: typeof Globe }[] }[] = [
  {
    label: null,
    items: [
      { page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { page: 'domains', label: 'Domains', icon: Globe },
    ],
  },
  {
    label: 'Observe',
    items: [
      { page: 'traffic', label: 'Traffic', icon: Activity },
      { page: 'logs', label: 'Logs', icon: ScrollText },
    ],
  },
  {
    label: 'System',
    items: [
      { page: 'certificates', label: 'Certificates', icon: ShieldCheck },
      { page: 'settings', label: 'Settings', icon: SettingsIcon },
    ],
  },
];

export function Sidebar() {
  const { page, setPage, platform, proxy } = useAppStore();
  const proxyUp = proxy?.state === 'running' || proxy?.state === 'reloading';
  const proxyBad = proxy?.state === 'error' || proxy?.state === 'port-conflict' || proxy?.state === 'invalid-config';

  return (
    <aside className="flex w-48 shrink-0 flex-col border-r border-border bg-card/60">
      <div className="flex items-center gap-2 px-3.5 pb-2 pt-3.5">
        <svg viewBox="0 0 512 512" className="size-5 shrink-0" aria-hidden="true">
          <rect x="14" y="14" width="484" height="484" rx="112" fill="#16233c" />
          <path d="M 100 322 H 412" stroke="#3d5a8f" strokeWidth="26" strokeLinecap="round" />
          <path d="M 116 322 Q 256 98 396 322" stroke="#4c8dfa" strokeWidth="40" strokeLinecap="round" fill="none" />
          <circle cx="116" cy="322" r="36" fill="#0b101c" stroke="#4c8dfa" strokeWidth="18" />
          <circle cx="396" cy="322" r="36" fill="#0b101c" stroke="#4c8dfa" strokeWidth="18" />
        </svg>
        <span className="text-[12.5px] font-semibold tracking-tight">LocalBridge</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-1.5">
        {sections.map((section, index) => (
          <div key={index} className={cn(index > 0 && 'mt-4')}>
            {section.label ? (
              <p className="mb-1 px-2 text-[10px] font-medium uppercase tracking-[0.09em] text-muted-foreground/60">
                {section.label}
              </p>
            ) : null}
            <div className="space-y-px">
              {section.items.map(({ page: p, label, icon: Icon }) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={cn(
                    'flex h-7.5 w-full items-center gap-2 rounded-[5px] px-2 text-[12.5px] transition-colors',
                    page === p
                      ? 'bg-accent font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                  )}
                >
                  <Icon className={cn('size-3.75', page === p ? 'text-primary' : 'opacity-70')} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="space-y-1 border-t border-border px-3.5 py-2.5 font-mono text-[10.5px] text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <span
            className={cn(
              'size-1.5 rounded-full',
              proxyUp ? 'bg-success' : proxyBad ? 'bg-destructive' : 'bg-muted-foreground/40',
            )}
          />
          proxy {proxy?.state ?? '—'}
        </p>
        <p className="text-muted-foreground/70">
          {platform ? `v${platform.appVersion} · ${platform.storageEngine}` : '…'}
        </p>
      </div>
    </aside>
  );
}
