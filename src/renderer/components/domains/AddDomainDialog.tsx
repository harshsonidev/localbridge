import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { DomainConfig, DomainCreateInput } from '../../../shared/types';
import { normalizeDomain, validateDomainName, parseTargetUrl } from '../../../shared/validation';
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { useDomainsStore } from '../../stores/domains.store';
import { toast } from '../../stores/toast.store';

interface Props {
  open: boolean;
  onClose: () => void;
  /** When set, the dialog edits an existing domain instead of creating. */
  editing?: DomainConfig | null;
}

export function AddDomainDialog({ open, onClose, editing }: Props) {
  const { create, update } = useDomainsStore();

  const [name, setName] = useState('');
  const [domainInput, setDomainInput] = useState('');
  const [targetInput, setTargetInput] = useState('http://localhost:3000');
  const [https, setHttps] = useState(true);
  const [redirect, setRedirect] = useState(true);
  const [preserveHost, setPreserveHost] = useState(true);
  const [websockets, setWebsockets] = useState(true);
  const [inspection, setInspection] = useState(false);
  const [healthCheck, setHealthCheck] = useState(false);
  const [healthPath, setHealthPath] = useState('/');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name === editing.domain ? '' : editing.name);
      setDomainInput(editing.domain);
      const portSuffix = `:${editing.target.port}`;
      setTargetInput(
        `${editing.target.protocol}://${editing.target.host}${portSuffix}${editing.target.basePath ?? ''}`,
      );
      setHttps(editing.frontend.protocol === 'https');
      setRedirect(editing.frontend.redirectHttpToHttps);
      setPreserveHost(editing.proxy.preserveHost);
      setWebsockets(editing.proxy.websockets);
      setInspection(editing.inspectionEnabled);
      setHealthCheck(editing.healthCheck.enabled);
      setHealthPath(editing.healthCheck.path);
    } else {
      setName('');
      setDomainInput('');
      setTargetInput('http://localhost:3000');
      setHttps(true);
      setRedirect(true);
      setPreserveHost(true);
      setWebsockets(true);
      setInspection(true);
      setHealthCheck(false);
      setHealthPath('/');
    }
    setSaving(false);
  }, [open, editing]);

  const normalized = useMemo(() => normalizeDomain(domainInput), [domainInput]);
  const domainCheck = useMemo(
    () => (domainInput ? validateDomainName(normalized.domain) : null),
    [domainInput, normalized],
  );
  const targetCheck = useMemo(
    () => (targetInput ? parseTargetUrl(targetInput) : null),
    [targetInput],
  );

  const valid = Boolean(domainCheck?.valid && targetCheck && targetCheck.errors.length === 0);

  async function handleSave() {
    if (!valid || !targetCheck) return;
    setSaving(true);

    const input: DomainCreateInput = {
      name: name || undefined,
      domain: normalized.domain,
      frontend: {
        protocol: https ? 'https' : 'http',
        redirectHttpToHttps: https ? redirect : false,
      },
      target: {
        protocol: targetCheck.protocol,
        host: targetCheck.host,
        port: targetCheck.port,
        basePath: targetCheck.basePath,
      },
      proxy: { preserveHost, websockets },
      healthCheck: { enabled: healthCheck, path: healthPath || '/' },
      inspectionEnabled: inspection,
    };

    const saved = editing ? await update(editing.id, input) : await create(input);
    setSaving(false);

    if (saved) {
      const url = `${saved.frontend.protocol}://${saved.domain}`;
      toast.success(editing ? 'Domain updated' : 'Domain created successfully', url);
      onClose();
    }
  }

  const fieldStatus = (ok: boolean | undefined, errors?: string[]) =>
    ok === undefined ? null : ok ? (
      <span className="inline-flex items-center gap-1 text-[11px] text-success">
        <CheckCircle2 className="size-3" /> looks good
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
        <XCircle className="size-3" /> {errors?.[0]}
      </span>
    );

  return (
    <Dialog open={open} onClose={onClose} widthClass="max-w-lg">
      <DialogHeader>
        <DialogTitle>{editing ? 'Edit Domain' : 'Add Domain'}</DialogTitle>
        <DialogDescription>
          Map a friendly local domain to a development server. LocalBridge generates the hosts
          entry and reverse-proxy configuration for you.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-4">
        <Tabs defaultValue="simple">
          <TabsList>
            <TabsTrigger value="simple">Simple</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>

          <TabsContent value="simple">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="domain">Domain</Label>
                <Input
                  id="domain"
                  placeholder="app.local"
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  autoFocus
                />
                <div className="flex items-center justify-between">
                  {domainInput
                    ? fieldStatus(domainCheck?.valid, domainCheck?.errors)
                    : (
                        <span className="text-[11px] text-muted-foreground">
                          Use a .local name, e.g. app.local
                        </span>
                      )}
                  {normalized.changes.length > 0 && domainCheck?.valid ? (
                    <span className="text-[11px] text-muted-foreground">
                      saved as {normalized.domain}
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="target">Target</Label>
                <Input
                  id="target"
                  placeholder="http://localhost:3000"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                />
                {targetInput
                  ? fieldStatus(targetCheck?.errors.length === 0, targetCheck?.errors)
                  : (
                      <span className="text-[11px] text-muted-foreground">
                        The local server this domain should proxy to
                      </span>
                    )}
              </div>

              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <p className="text-[12.5px] font-medium">HTTPS</p>
                  <p className="text-[11px] text-muted-foreground">
                    Serve this domain over https:// with a locally trusted certificate
                  </p>
                </div>
                <Switch checked={https} onCheckedChange={setHttps} aria-label="Enable HTTPS" />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="advanced">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="displayName">Display name (optional)</Label>
                <Input
                  id="displayName"
                  placeholder="My App"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              {[
                {
                  label: 'Redirect HTTP to HTTPS',
                  desc: 'Send http:// requests to the https:// address',
                  value: redirect,
                  set: setRedirect,
                  disabled: !https,
                },
                {
                  label: 'Preserve Host header',
                  desc: 'Forward the original Host header to the target',
                  value: preserveHost,
                  set: setPreserveHost,
                },
                {
                  label: 'WebSockets',
                  desc: 'Required for Vite HMR, Socket.IO and live reload',
                  value: websockets,
                  set: setWebsockets,
                },
                {
                  label: 'Traffic inspection',
                  desc: 'Write JSON access logs for the Traffic page',
                  value: inspection,
                  set: setInspection,
                },
              ].map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                >
                  <div>
                    <p className="text-[12.5px] font-medium">{row.label}</p>
                    <p className="text-[11px] text-muted-foreground">{row.desc}</p>
                  </div>
                  <Switch
                    checked={row.value}
                    onCheckedChange={row.set}
                    disabled={row.disabled}
                    aria-label={row.label}
                  />
                </div>
              ))}

              <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                <div className="flex-1">
                  <p className="text-[13px] font-medium">Health check</p>
                  <p className="text-[11px] text-muted-foreground">
                    Periodically probe the target
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {healthCheck ? (
                    <Input
                      className="h-7 w-28 text-xs"
                      value={healthPath}
                      onChange={(e) => setHealthPath(e.target.value)}
                      placeholder="/health"
                    />
                  ) : null}
                  <Switch
                    checked={healthCheck}
                    onCheckedChange={setHealthCheck}
                    aria-label="Health check"
                  />
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogBody>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!valid} loading={saving}>
          {editing ? 'Save Changes' : 'Save'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
