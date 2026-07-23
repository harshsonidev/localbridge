import { IPC_CHANNELS } from '../../shared/constants';
import type { CertificateService } from '../services/certificate.service';
import type { MkcertService } from '../services/mkcert.service';
import type { DomainService } from '../services/domain.service';
import type { IpcRegistrar } from '../security/ipc-security';

export function registerCertificateIpc(
  ipc: IpcRegistrar,
  mkcert: MkcertService,
  certificates: CertificateService,
  domains: DomainService,
): void {
  ipc.handle(IPC_CHANNELS.certificates.authorityStatus, () => mkcert.status());

  ipc.handle(IPC_CHANNELS.certificates.installAuthority, async () => {
    const status = await mkcert.installAuthority();
    // With a trusted CA, previously skipped https sites can now be served.
    await domains.applyConfigs();
    return status;
  });

  ipc.handle(IPC_CHANNELS.certificates.list, () => certificates.list(domains.list()));

  ipc.handle(IPC_CHANNELS.certificates.regenerate, async () => {
    const result = await certificates.ensure(domains.list(), true);
    await domains.applyConfigs();
    return result;
  });
}
