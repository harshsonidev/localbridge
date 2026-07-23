import { useEffect, useMemo } from 'react';
import { Activity, Copy, Pause, Play, Trash2 } from 'lucide-react';
import type { TrafficRecord } from '../../shared/types';
import { useTrafficStore } from '../stores/traffic.store';
import { toast } from '../stores/toast.store';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { EmptyState } from '../components/common/EmptyState';
import { PageShell } from '../components/layout/PageShell';
import { cn } from '../lib/utils';

function statusColor(status: number): string {
  if (status >= 500) return 'text-destructive';
  if (status >= 400) return 'text-warning';
  if (status >= 300) return 'text-primary';
  return 'text-success';
}

function fullUrl(record: TrafficRecord): string {
  const scheme = record.protocol.startsWith('HTTP/') ? 'https' : 'http';
  return `${scheme}://${record.host}${record.path}${record.query ? `?${record.query}` : ''}`;
}

function asCurl(record: TrafficRecord): string {
  const parts = [`curl -X ${record.method} "${fullUrl(record)}"`];
  for (const [name, value] of Object.entries(record.requestHeaders)) {
    if (value === '[redacted]' || name.toLowerCase() === 'host') continue;
    parts.push(`  -H "${name}: ${value.replace(/"/g, '\\"')}"`);
  }
  return parts.join(' \\\n');
}

function formatSize(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} kB` : `${bytes} B`;
}

function HeaderTable({ headers }: { headers: Record<string, string> }) {
  const names = Object.keys(headers).sort();
  if (names.length === 0) {
    return <p className="py-4 text-center text-[11.5px] text-muted-foreground">No headers captured</p>;
  }
  return (
    <div className="overflow-auto rounded-md border border-border/70">
      <table className="w-full text-[11px]">
        <tbody>
          {names.map((name) => (
            <tr key={name} className="border-b border-border/40 last:border-0">
              <td className="whitespace-nowrap px-2.5 py-1 align-top font-medium text-muted-foreground">
                {name}
              </td>
              <td className="break-all px-2.5 py-1 font-mono">{headers[name]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TrafficPage() {
  const {
    records,
    selectedId,
    domainFilter,
    methodFilter,
    statusFilter,
    search,
    paused,
    select,
    setDomainFilter,
    setMethodFilter,
    setStatusFilter,
    setSearch,
    setPaused,
    load,
    clear,
  } = useTrafficStore();

  useEffect(() => {
    void load();
    if (paused) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [load, paused]);

  const domains = useMemo(() => ['all', ...new Set(records.map((r) => r.host))].sort(), [records]);
  const methods = useMemo(() => ['all', ...new Set(records.map((r) => r.method))].sort(), [records]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records
      .filter((r) => domainFilter === 'all' || r.host === domainFilter)
      .filter((r) => methodFilter === 'all' || r.method === methodFilter)
      .filter((r) => {
        switch (statusFilter) {
          case '2xx':
            return r.status >= 200 && r.status < 300;
          case '3xx':
            return r.status >= 300 && r.status < 400;
          case '4xx':
            return r.status >= 400 && r.status < 500;
          case '5xx':
          case 'errors':
            return r.status >= 500;
          default:
            return true;
        }
      })
      .filter((r) => query === '' || r.path.toLowerCase().includes(query) || r.host.includes(query));
  }, [records, domainFilter, methodFilter, statusFilter, search]);

  const selected = filtered.find((r) => r.id === selectedId) ?? null;

  return (
    <PageShell
      title="Traffic"
      meta={records.length > 0 ? `${filtered.length} of ${records.length} requests` : undefined}
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={() => setPaused(!paused)}>
            {paused ? <Play /> : <Pause />} {paused ? 'Resume' : 'Pause'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void clear()}>
            <Trash2 /> Clear
          </Button>
        </>
      }
      contentClassName="flex flex-col gap-3"
    >
      {records.length > 0 ? (
        <div className="flex shrink-0 items-center gap-2">
          <Select
            className="w-44"
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
            aria-label="Domain filter"
          >
            {domains.map((d) => (
              <option key={d} value={d}>
                {d === 'all' ? 'All domains' : d}
              </option>
            ))}
          </Select>
          <Select
            className="w-28"
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            aria-label="Method filter"
          >
            {methods.map((m) => (
              <option key={m} value={m}>
                {m === 'all' ? 'Any method' : m}
              </option>
            ))}
          </Select>
          <Select
            className="w-28"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            aria-label="Status filter"
          >
            <option value="all">Any status</option>
            <option value="2xx">2xx</option>
            <option value="3xx">3xx</option>
            <option value="4xx">4xx</option>
            <option value="5xx">5xx</option>
          </Select>
          <Input
            className="w-52"
            placeholder="Filter by path"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      ) : null}

      {records.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No traffic captured yet"
          description="Requests to your domains appear here in near real-time. Make sure the proxy is running and traffic inspection is enabled for the domain."
        />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-5 gap-3">
          <div className="col-span-3 min-h-0 overflow-auto rounded-md border border-border">
            <table className="data-table">
              <thead className="sticky top-0 z-10 bg-card">
                <tr>
                  <th className="w-16">Method</th>
                  <th>Path</th>
                  <th className="w-14">Status</th>
                  <th className="w-20 text-right">Time</th>
                  <th className="w-20 text-right">Size</th>
                  <th className="w-20 text-right">At</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => select(r.id)}
                    className={cn('cursor-pointer', selectedId === r.id && 'bg-primary/10 hover:bg-primary/10')}
                  >
                    <td className="font-mono text-[11px] font-medium">{r.method}</td>
                    <td className="max-w-0">
                      <p className="truncate font-mono text-[11.5px]">{r.path}</p>
                      <p className="truncate text-[10.5px] text-muted-foreground/70">{r.host}</p>
                    </td>
                    <td className={cn('font-mono text-[11.5px] font-semibold', statusColor(r.status))}>
                      {r.status}
                    </td>
                    <td className="text-right font-mono text-[11px] text-muted-foreground">
                      {r.durationMs.toFixed(1)} ms
                    </td>
                    <td className="text-right font-mono text-[11px] text-muted-foreground">
                      {formatSize(r.responseSize)}
                    </td>
                    <td className="whitespace-nowrap text-right text-[10.5px] text-muted-foreground">
                      {new Date(r.timestamp).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="col-span-2 min-h-0 overflow-auto rounded-md border border-border p-3">
            {selected ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="break-all font-mono text-[11.5px] leading-relaxed">{fullUrl(selected)}</p>
                  <div className="flex shrink-0 gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Copy URL"
                      onClick={async () => {
                        await navigator.clipboard.writeText(fullUrl(selected));
                        toast.info('URL copied');
                      }}
                    >
                      <Copy />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Copy as cURL"
                      onClick={async () => {
                        await navigator.clipboard.writeText(asCurl(selected));
                        toast.info('cURL command copied');
                      }}
                    >
                      cURL
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-3 overflow-hidden rounded-md border border-border/70 text-[11px]">
                  {[
                    ['Status', <span key="s" className={cn('font-semibold', statusColor(selected.status))}>{selected.status}</span>],
                    ['Duration', `${selected.durationMs.toFixed(2)} ms`],
                    ['Protocol', selected.protocol],
                    ['Client', selected.clientIp],
                    ['Request', formatSize(selected.requestSize)],
                    ['Response', formatSize(selected.responseSize)],
                  ].map(([label, value], i) => (
                    <div key={i} className="border-b border-r border-border/50 px-2.5 py-1.5 last:border-r-0 nth-[3n]:border-r-0 nth-[n+4]:border-b-0">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</p>
                      <p className="mt-0.5 font-mono">{value}</p>
                    </div>
                  ))}
                </div>

                <Tabs defaultValue="request">
                  <TabsList>
                    <TabsTrigger value="request">Request headers</TabsTrigger>
                    <TabsTrigger value="response">Response headers</TabsTrigger>
                  </TabsList>
                  <TabsContent value="request">
                    <HeaderTable headers={selected.requestHeaders} />
                  </TabsContent>
                  <TabsContent value="response">
                    <HeaderTable headers={selected.responseHeaders} />
                  </TabsContent>
                </Tabs>
              </div>
            ) : (
              <p className="py-16 text-center text-[11.5px] text-muted-foreground">
                Select a request to inspect it
              </p>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
