import { useEffect } from 'react';
import { ShieldCheck, RefreshCw, FolderOpen } from 'lucide-react';
import type { CertificateState } from '../../shared/types';
import { useAppStore } from '../stores/app.store';
import { useDomainsStore } from '../stores/domains.store';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { EmptyState } from '../components/common/EmptyState';
import { PageShell } from '../components/layout/PageShell';
import { formatDate } from '../lib/utils';

function statusBadge(status: CertificateState) {
  switch (status) {
    case 'valid':
      return <Badge variant="success">valid</Badge>;
    case 'expiring-soon':
      return <Badge variant="warning">expiring soon</Badge>;
    case 'expired':
      return <Badge variant="destructive">expired</Badge>;
    case 'domain-mismatch':
      return <Badge variant="warning">mismatch</Badge>;
    default:
      return <Badge variant="destructive">missing</Badge>;
  }
}

export function CertificatesPage() {
  const {
    ca,
    caBusy,
    installCa,
    loadCa,
    certificates,
    loadCertificates,
    regenerateCertificates,
  } = useAppStore();
  const { domains, loaded, load } = useDomainsStore();

  useEffect(() => {
    void loadCa();
    void loadCertificates();
    if (!loaded) void load();
  }, [loadCa, loadCertificates, loaded, load]);

  const httpsDomains = domains.filter((d) => d.enabled && d.frontend.protocol === 'https');

  return (
    <PageShell
      title="Certificates"
      meta={certificates.length > 0 ? `${certificates.length} issued` : undefined}
      actions={
        <>
          <Button
            variant="ghost"
            size="icon"
            title="Refresh"
            onClick={() => {
              void loadCa();
              void loadCertificates();
            }}
          >
            <RefreshCw />
          </Button>
          {certificates.length > 0 ? (
            <Button variant="secondary" size="sm" loading={caBusy} onClick={() => void regenerateCertificates()}>
              <RefreshCw /> Regenerate All
            </Button>
          ) : null}
        </>
      }
      contentClassName="space-y-3"
    >
      <Card>
        <CardHeader>
          <CardTitle>Certificate authority</CardTitle>
          {ca ? (
            ca.trusted ? (
              <Badge variant="success">installed &amp; trusted</Badge>
            ) : ca.created ? (
              <Badge variant="warning">created, not trusted</Badge>
            ) : ca.mkcertAvailable ? (
              <Badge variant="warning">not installed</Badge>
            ) : (
              <Badge variant="destructive">mkcert missing</Badge>
            )
          ) : (
            <Badge>checking…</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-2.5">
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            The mkcert root certificate makes browsers on this machine trust locally issued
            certificates. The private key stays in the CA directory and is never displayed.
          </p>
          {ca?.caRootDir ? (
            <p className="truncate font-mono text-[11px] text-muted-foreground/70" title={ca.caRootDir}>
              {ca.caRootDir}
            </p>
          ) : null}
          {!ca?.trusted ? (
            <Button size="sm" loading={caBusy} onClick={() => void installCa()}>
              <ShieldCheck /> {ca?.created ? 'Repair Trust' : 'Install Certificate Authority'}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {certificates.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={httpsDomains.length === 0 ? 'No HTTPS domains yet' : 'No certificates yet'}
          description={
            httpsDomains.length === 0
              ? 'Create a domain with HTTPS enabled and its certificate will appear here.'
              : 'Certificates are generated automatically when configuration is applied. Install the CA above, then save any domain to trigger generation.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <table className="data-table">
            <thead>
              <tr>
                <th>Certificate</th>
                <th>Covers</th>
                <th className="w-36">Issued</th>
                <th className="w-36">Expires</th>
                <th className="w-28">Status</th>
              </tr>
            </thead>
            <tbody>
              {certificates.map((cert) => (
                <tr key={cert.name}>
                  <td>
                    <p className="font-medium">{cert.name}</p>
                    <p className="truncate font-mono text-[10.5px] text-muted-foreground/60" title={cert.certFile}>
                      {cert.certFile}
                    </p>
                  </td>
                  <td className="font-mono text-[11.5px] text-muted-foreground">
                    {cert.domains.join(', ')}
                  </td>
                  <td className="text-[11.5px] text-muted-foreground">
                    {cert.issuedAt ? formatDate(cert.issuedAt) : '—'}
                  </td>
                  <td className="text-[11.5px] text-muted-foreground">
                    {cert.expiresAt ? formatDate(cert.expiresAt) : '—'}
                  </td>
                  <td>{statusBadge(cert.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
