import { useState } from 'react';
import { ExternalLink, Copy, Pencil, Trash2, Lock } from 'lucide-react';
import type { DomainConfig } from '../../../shared/types';
import { useDomainsStore } from '../../stores/domains.store';
import { toast } from '../../stores/toast.store';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { cn } from '../../lib/utils';

function targetLabel(d: DomainConfig): string {
  return `${d.target.protocol}://${d.target.host}:${d.target.port}${d.target.basePath ?? ''}`;
}

function publicUrl(d: DomainConfig): string {
  return `${d.frontend.protocol}://${d.domain}`;
}

export function DomainsTable({
  domains,
  onEdit,
}: {
  domains: DomainConfig[];
  onEdit: (domain: DomainConfig) => void;
}) {
  const { setEnabled, remove, open } = useDomainsStore();
  const [deleting, setDeleting] = useState<DomainConfig | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function copyUrl(d: DomainConfig) {
    await navigator.clipboard.writeText(publicUrl(d));
    toast.info('Copied', publicUrl(d));
  }

  return (
    <>
      <div className="overflow-hidden rounded-md border border-border">
        <table className="data-table">
          <thead>
            <tr>
              <th className="w-12"></th>
              <th>Domain</th>
              <th>Target</th>
              <th className="w-20">Scheme</th>
              <th className="w-36 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {domains.map((d) => (
              <tr key={d.id} className="group">
                <td>
                  <Switch
                    checked={d.enabled}
                    onCheckedChange={(v) => void setEnabled(d.id, v)}
                    aria-label={`Enable ${d.domain}`}
                  />
                </td>
                <td>
                  <p className={cn('font-medium', !d.enabled && 'text-muted-foreground')}>
                    {d.domain}
                  </p>
                  {d.name !== d.domain ? (
                    <p className="text-[11px] text-muted-foreground">{d.name}</p>
                  ) : null}
                </td>
                <td className="font-mono text-[11.5px] text-muted-foreground">{targetLabel(d)}</td>
                <td>
                  {d.frontend.protocol === 'https' ? (
                    <span className="inline-flex items-center gap-1 text-[11.5px] text-success/90">
                      <Lock className="size-3" /> https
                    </span>
                  ) : (
                    <span className="text-[11.5px] text-muted-foreground">http</span>
                  )}
                </td>
                <td>
                  <div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Open in browser"
                      onClick={() => void open(d.id)}
                    >
                      <ExternalLink />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Copy URL"
                      onClick={() => void copyUrl(d)}
                    >
                      <Copy />
                    </Button>
                    <Button variant="ghost" size="icon" title="Edit" onClick={() => onEdit(d)}>
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Delete"
                      className="hover:text-destructive"
                      onClick={() => setDeleting(d)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={deleting !== null} onClose={() => setDeleting(null)} widthClass="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete {deleting?.domain}?</DialogTitle>
          <DialogDescription>
            Removes the domain, its hosts-file entry and its proxy route. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="text-[11.5px] text-muted-foreground">
            Target <span className="font-mono">{deleting ? targetLabel(deleting) : ''}</span>
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            loading={deleteBusy}
            onClick={async () => {
              if (!deleting) return;
              setDeleteBusy(true);
              await remove(deleting.id);
              setDeleteBusy(false);
              setDeleting(null);
            }}
          >
            Delete Domain
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
