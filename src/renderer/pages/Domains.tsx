import { useEffect, useMemo, useState } from 'react';
import { Globe, Plus, Search, RefreshCw } from 'lucide-react';
import type { DomainConfig } from '../../shared/types';
import { useDomainsStore } from '../stores/domains.store';
import { useAppStore } from '../stores/app.store';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { EmptyState } from '../components/common/EmptyState';
import { AddDomainDialog } from '../components/domains/AddDomainDialog';
import { DomainsTable } from '../components/domains/DomainsTable';
import { ConfigPreviewPanel } from '../components/domains/ConfigPreviewPanel';
import { PageShell } from '../components/layout/PageShell';

export function DomainsPage() {
  const { domains, loading, loaded, error, load } = useDomainsStore();
  const loadPreview = useAppStore((s) => s.loadPreview);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DomainConfig | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!loaded) void load();
    void loadPreview();
  }, [loaded, load, loadPreview]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return domains;
    return domains.filter(
      (d) =>
        d.domain.includes(q) ||
        d.name.toLowerCase().includes(q) ||
        `${d.target.host}:${d.target.port}`.includes(q),
    );
  }, [domains, search]);

  return (
    <PageShell
      title="Domains"
      meta={domains.length > 0 ? `${domains.filter((d) => d.enabled).length}/${domains.length} enabled` : undefined}
      actions={
        <>
          <Button variant="ghost" size="icon" title="Refresh" onClick={() => void load()}>
            <RefreshCw />
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus /> Add Domain
          </Button>
        </>
      }
      contentClassName="space-y-3"
    >
      {domains.length > 0 ? (
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            className="pl-8"
            placeholder="Filter domains"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      ) : null}

      {error ? (
        <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12.5px] text-destructive">
          {error}
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : loading && domains.length === 0 ? (
        <p className="py-12 text-center text-[12.5px] text-muted-foreground">Loading domains…</p>
      ) : domains.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No domains yet"
          description="Map a friendly local domain like app.local to a development server. Hosts entry, certificate and proxy route are generated automatically."
          action={
            <Button
              size="sm"
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus /> Add Domain
            </Button>
          }
        />
      ) : (
        <DomainsTable
          domains={filtered}
          onEdit={(d) => {
            setEditing(d);
            setDialogOpen(true);
          }}
        />
      )}

      <ConfigPreviewPanel />

      <AddDomainDialog open={dialogOpen} onClose={() => setDialogOpen(false)} editing={editing} />
    </PageShell>
  );
}
