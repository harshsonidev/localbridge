import { useEffect, type ReactNode } from 'react';
import { Plus, Play, Square, RotateCw, ShieldCheck } from 'lucide-react';
import type { ProxyState } from '../../shared/types';
import { useAppStore } from '../stores/app.store';
import { useDomainsStore } from '../stores/domains.store';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { PageShell } from '../components/layout/PageShell';

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
        {label}
      </p>
      <p className="mt-1 text-[17px] font-semibold leading-none tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-mono text-[11.5px]">{children}</span>
    </div>
  );
}

function proxyBadge(state: ProxyState | undefined) {
  switch (state) {
    case 'running':
      return <Badge variant="success">running</Badge>;
    case 'reloading':
    case 'starting':
      return <Badge variant="info">{state}</Badge>;
    case 'stopping':
      return <Badge>stopping</Badge>;
    case 'error':
    case 'invalid-config':
    case 'port-conflict':
      return <Badge variant="destructive">{state}</Badge>;
    default:
      return <Badge>stopped</Badge>;
  }
}

export function DashboardPage() {
  const {
    platform,
    setPage,
    loadPlatform,
    proxy,
    proxyBusy,
    proxyAction,
    loadProxy,
    ca,
    caBusy,
    installCa,
    loadCa,
  } = useAppStore();
  const { domains, loaded, load } = useDomainsStore();

  useEffect(() => {
    if (!loaded) void load();
    if (!platform) void loadPlatform();
    void loadProxy();
    void loadCa();
    const timer = setInterval(() => void loadProxy(), 4000);
    return () => clearInterval(timer);
  }, [loaded, load, platform, loadPlatform, loadProxy, loadCa]);

  const enabled = domains.filter((d) => d.enabled);
  const httpsCount = enabled.filter((d) => d.frontend.protocol === 'https').length;
  const running = proxy?.state === 'running' || proxy?.state === 'reloading';

  return (
    <PageShell
      title="Dashboard"
      actions={
        <Button size="sm" onClick={() => setPage('domains')}>
          <Plus /> Add Domain
        </Button>
      }
      contentClassName="space-y-3"
    >
      <Card>
        <div className="grid grid-cols-4 divide-x divide-border/60">
          <Stat label="Domains" value={domains.length} hint={`${enabled.length} enabled`} />
          <Stat label="HTTPS" value={httpsCount} hint="serving with local TLS" />
          <Stat
            label="Proxy"
            value={proxy?.state ?? '—'}
            hint={proxy?.pid ? `caddy pid ${proxy.pid}` : 'not running'}
          />
          <Stat
            label="Certificate authority"
            value={ca ? (ca.trusted ? 'trusted' : ca.created ? 'untrusted' : 'not set up') : '—'}
            hint="mkcert local root"
          />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardHeader>
            <CardTitle>Reverse proxy</CardTitle>
            {proxyBadge(proxy?.state)}
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border/40">
              <Row label="Engine">Caddy {proxy?.version ?? '—'}</Row>
              <Row label="HTTP / HTTPS ports">
                {proxy ? `${proxy.httpPort} / ${proxy.httpsPort}` : '—'}
              </Row>
              <Row label="Bind">127.0.0.1 (loopback only)</Row>
              {proxy?.startedAt ? (
                <Row label="Started">{new Date(proxy.startedAt).toLocaleTimeString()}</Row>
              ) : null}
            </div>
            {proxy?.lastError ? (
              <p className="mt-2 whitespace-pre-wrap break-words rounded-sm border border-destructive/25 bg-destructive/10 p-2 font-mono text-[11px] leading-relaxed text-destructive">
                {proxy.lastError}
              </p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={running}
                loading={proxyBusy && !running}
                onClick={() => void proxyAction('start')}
              >
                <Play /> Start
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!running}
                onClick={() => void proxyAction('stop')}
              >
                <Square /> Stop
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void proxyAction('restart')}>
                <RotateCw /> Restart
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Certificate authority</CardTitle>
            {ca == null ? (
              <Badge>checking…</Badge>
            ) : ca.trusted ? (
              <Badge variant="success">trusted</Badge>
            ) : ca.created ? (
              <Badge variant="warning">not trusted</Badge>
            ) : (
              <Badge variant="warning">not installed</Badge>
            )}
          </CardHeader>
          <CardContent>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              {ca == null
                ? 'Checking the local certificate authority…'
                : ca.trusted
                  ? 'Browsers on this machine trust certificates issued by LocalBridge. HTTPS domains load without warnings.'
                  : 'Install the local certificate authority once so browsers trust your local HTTPS domains. Your system asks for confirmation.'}
            </p>
            {ca?.caRootDir ? (
              <p className="mt-2 truncate font-mono text-[11px] text-muted-foreground/70" title={ca.caRootDir}>
                {ca.caRootDir}
              </p>
            ) : null}
            <div className="mt-3">
              {ca == null ? (
                <Button size="sm" variant="secondary" disabled loading>
                  Checking…
                </Button>
              ) : ca.trusted ? (
                <Button size="sm" variant="secondary" onClick={() => setPage('certificates')}>
                  View certificates
                </Button>
              ) : (
                <Button size="sm" loading={caBusy} onClick={() => void installCa()}>
                  <ShieldCheck /> Install Certificate Authority
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Environment</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <div className="grid grid-cols-4 gap-x-6">
            <Row label="Platform">{platform ? `${platform.platform}/${platform.arch}` : '—'}</Row>
            <Row label="Electron">{platform?.electronVersion ?? '—'}</Row>
            <Row label="Node">{platform?.nodeVersion ?? '—'}</Row>
            <Row label="Storage">{platform?.storageEngine ?? '—'}</Row>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
