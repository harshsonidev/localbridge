import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { useAppStore } from '../../stores/app.store';
import { toast } from '../../stores/toast.store';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { cn } from '../../lib/utils';

function CodeBlock({ content, path }: { content: string; path: string }) {
  return (
    <div>
      <div className="flex items-center justify-between border-b border-border/60 px-3 py-1.5">
        <p className="truncate font-mono text-[10.5px] text-muted-foreground/70">{path}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(content);
            toast.info('Copied to clipboard');
          }}
        >
          <Copy /> Copy
        </Button>
      </div>
      <pre className="max-h-72 overflow-auto px-3 py-2.5 font-mono text-[11px] leading-relaxed text-foreground/85">
        {content || '# empty - no enabled domains yet'}
      </pre>
    </div>
  );
}

export function ConfigPreviewPanel() {
  const preview = useAppStore((s) => s.preview);
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'hosts' | 'caddyfile'>('hosts');

  return (
    <Card>
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-foreground/85">
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          Generated configuration
        </span>
        {preview && preview.warnings.length > 0 ? (
          <span className="text-[11px] text-warning">
            {preview.warnings.length} warning{preview.warnings.length > 1 ? 's' : ''}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/60">hosts file · Caddyfile</span>
        )}
      </button>

      {expanded ? (
        <div className="border-t border-border/60">
          {preview && preview.warnings.length > 0 ? (
            <div className="space-y-1 border-b border-border/60 bg-warning/5 px-3 py-2">
              {preview.warnings.map((w) => (
                <p key={w} className="text-[11px] leading-snug text-warning">
                  {w}
                </p>
              ))}
            </div>
          ) : null}

          <div className="flex gap-0.5 border-b border-border/60 px-2 pt-1.5">
            {(['hosts', 'caddyfile'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  'rounded-t-sm border-b-2 px-2.5 pb-1.5 pt-1 text-[11.5px] font-medium transition-colors',
                  tab === t
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t === 'hosts' ? 'Hosts file' : 'Caddyfile'}
              </button>
            ))}
          </div>

          {preview ? (
            tab === 'hosts' ? (
              <CodeBlock content={preview.hostsFile || preview.hostsBlock} path={preview.hostsFilePath} />
            ) : (
              <CodeBlock content={preview.caddyfile} path={preview.caddyfilePath} />
            )
          ) : (
            <p className="py-6 text-center text-[11.5px] text-muted-foreground">Loading…</p>
          )}
        </div>
      ) : null}
    </Card>
  );
}
