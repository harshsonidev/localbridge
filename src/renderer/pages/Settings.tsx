import { useEffect, useState } from 'react';
import { useAppStore } from '../stores/app.store';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { PageShell } from '../components/layout/PageShell';
import { isValidPort } from '../../shared/validation';

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div>
        <p className="text-[12.5px] font-medium">{title}</p>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={title} />
    </div>
  );
}

export function SettingsPage() {
  const { settings, loadSettings, updateSettings } = useAppStore();
  const [httpPort, setHttpPort] = useState('80');
  const [httpsPort, setHttpsPort] = useState('443');
  const [autoStart, setAutoStart] = useState(true);
  const [flushDns, setFlushDns] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) {
      void loadSettings();
    } else {
      setHttpPort(String(settings.httpPort));
      setHttpsPort(String(settings.httpsPort));
      setAutoStart(settings.autoStartProxy);
      setFlushDns(settings.flushDnsAfterHostsChange);
    }
  }, [settings, loadSettings]);

  const httpValid = isValidPort(Number(httpPort));
  const httpsValid = isValidPort(Number(httpsPort));

  async function save() {
    if (!httpValid || !httpsValid) return;
    setSaving(true);
    await updateSettings({
      httpPort: Number(httpPort),
      httpsPort: Number(httpsPort),
      autoStartProxy: autoStart,
      flushDnsAfterHostsChange: flushDns,
    });
    setSaving(false);
  }

  return (
    <PageShell
      title="Settings"
      actions={
        <Button size="sm" onClick={() => void save()} disabled={!httpValid || !httpsValid} loading={saving}>
          Save Changes
        </Button>
      }
      contentClassName="space-y-3"
    >
      <div className="max-w-xl space-y-3">
        <Card>
          <CardHeader>
            <CardTitle>Proxy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 divide-y divide-border/40">
            <div className="grid grid-cols-2 gap-4 pb-3">
              <div className="space-y-1.5">
                <Label htmlFor="httpPort">HTTP port</Label>
                <Input
                  id="httpPort"
                  value={httpPort}
                  onChange={(e) => setHttpPort(e.target.value)}
                  inputMode="numeric"
                  className="w-28 font-mono"
                />
                {!httpValid ? (
                  <p className="text-[11px] text-destructive">Port must be 1–65535</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="httpsPort">HTTPS port</Label>
                <Input
                  id="httpsPort"
                  value={httpsPort}
                  onChange={(e) => setHttpsPort(e.target.value)}
                  inputMode="numeric"
                  className="w-28 font-mono"
                />
                {!httpsValid ? (
                  <p className="text-[11px] text-destructive">Port must be 1–65535</p>
                ) : null}
              </div>
            </div>
            <ToggleRow
              title="Start proxy automatically"
              description="Start or reload Caddy whenever domain configuration changes"
              checked={autoStart}
              onChange={setAutoStart}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Hosts file</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="pb-1 text-[11.5px] leading-relaxed text-muted-foreground">
              LocalBridge manages a dedicated block in the Windows hosts file. Changes are
              backed up, applied atomically, and prompt for administrator access only when
              the file actually changes.
            </p>
            <ToggleRow
              title="Flush DNS cache after changes"
              description="Runs ipconfig /flushdns after hosts updates"
              checked={flushDns}
              onChange={setFlushDns}
            />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
