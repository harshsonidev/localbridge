import { useEffect, useMemo } from 'react';
import { FolderOpen, Pause, Play, ScrollText, Trash2 } from 'lucide-react';
import type { LogLevel } from '../../shared/types';
import { useLogsStore } from '../stores/logs.store';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { EmptyState } from '../components/common/EmptyState';
import { PageShell } from '../components/layout/PageShell';
import { cn } from '../lib/utils';

const levelStyles: Record<LogLevel, string> = {
  debug: 'text-muted-foreground/70',
  info: 'text-primary/90',
  warn: 'text-warning',
  error: 'text-destructive',
};

export function LogsPage() {
  const {
    entries,
    levelFilter,
    categoryFilter,
    search,
    autoRefresh,
    setLevelFilter,
    setCategoryFilter,
    setSearch,
    setAutoRefresh,
    load,
    clear,
    openDirectory,
  } = useLogsStore();

  useEffect(() => {
    void load();
    if (!autoRefresh) return;
    const timer = setInterval(() => void load(), 2500);
    return () => clearInterval(timer);
  }, [load, autoRefresh]);

  const categories = useMemo(
    () => ['all', ...new Set(entries.map((e) => e.category))].sort(),
    [entries],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries
      .filter((e) => levelFilter === 'all' || e.level === levelFilter)
      .filter((e) => categoryFilter === 'all' || e.category === categoryFilter)
      .filter((e) => query === '' || e.message.toLowerCase().includes(query))
      .slice()
      .reverse(); // newest first
  }, [entries, levelFilter, categoryFilter, search]);

  return (
    <PageShell
      title="Logs"
      meta={entries.length > 0 ? `${filtered.length} entries` : undefined}
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={() => setAutoRefresh(!autoRefresh)}>
            {autoRefresh ? <Pause /> : <Play />} {autoRefresh ? 'Pause' : 'Resume'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void openDirectory()}>
            <FolderOpen /> Open Folder
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void clear()}>
            <Trash2 /> Clear
          </Button>
        </>
      }
      contentClassName="flex flex-col gap-3"
    >
      <div className="flex shrink-0 items-center gap-2">
        <Select
          className="w-32"
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value as LogLevel | 'all')}
          aria-label="Level filter"
        >
          <option value="all">Any level</option>
          <option value="debug">Debug</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </Select>
        <Select
          className="w-40"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="Category filter"
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c === 'all' ? 'Any category' : c}
            </option>
          ))}
        </Select>
        <Input
          className="w-60"
          placeholder="Filter messages"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No log entries"
          description="Entries matching the current filters appear here. Domain changes, proxy lifecycle and certificate operations are all logged."
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card/40 font-mono text-[11px] leading-relaxed">
          {filtered.map((entry, index) => (
            <div
              key={`${entry.timestamp}-${index}`}
              className="flex gap-3 border-b border-border/30 px-3 py-1 last:border-0 hover:bg-accent/30"
            >
              <span className="shrink-0 tabular-nums text-muted-foreground/60">{entry.timestamp}</span>
              <span className={cn('w-11 shrink-0', levelStyles[entry.level])}>{entry.level}</span>
              <span className="w-20 shrink-0 text-muted-foreground">{entry.category}</span>
              <span className="whitespace-pre-wrap break-all text-foreground/85">{entry.message}</span>
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}
