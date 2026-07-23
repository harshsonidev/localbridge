import { describe, expect, it } from 'vitest';
import {
  domainCreateInputSchema,
  domainUpdateInputSchema,
  appSettingsPatchSchema,
  ipcPayloadSchemas,
} from '../src/shared/schemas';

describe('domainCreateInputSchema', () => {
  const valid = {
    domain: 'app.local',
    target: { host: 'localhost', port: 3000 },
  };

  it('accepts a minimal valid payload and applies defaults', () => {
    const parsed = domainCreateInputSchema.parse(valid);
    expect(parsed.domain).toBe('app.local');
    expect(parsed.enabled).toBe(true);
    expect(parsed.target.protocol).toBe('http');
    expect(parsed.inspectionEnabled).toBe(true);
  });

  it('normalizes the domain during parsing', () => {
    const parsed = domainCreateInputSchema.parse({
      ...valid,
      domain: 'HTTPS://App.Local/path',
    });
    expect(parsed.domain).toBe('app.local');
  });

  it('rejects wildcard and malformed domains', () => {
    expect(domainCreateInputSchema.safeParse({ ...valid, domain: '*.evil.local' }).success).toBe(false);
    expect(domainCreateInputSchema.safeParse({ ...valid, domain: 'a b.local' }).success).toBe(false);
  });

  it('rejects out-of-range ports', () => {
    expect(
      domainCreateInputSchema.safeParse({ ...valid, target: { host: 'localhost', port: 0 } }).success,
    ).toBe(false);
    expect(
      domainCreateInputSchema.safeParse({ ...valid, target: { host: 'localhost', port: 70000 } })
        .success,
    ).toBe(false);
  });

  it('rejects header injection in custom headers', () => {
    const result = domainCreateInputSchema.safeParse({
      ...valid,
      proxy: { requestHeaders: { 'X-Bad': 'value\r\nInjected: yes' } },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unsafe base paths', () => {
    expect(
      domainCreateInputSchema.safeParse({
        ...valid,
        target: { host: 'localhost', port: 3000, basePath: 'no-leading-slash' },
      }).success,
    ).toBe(false);
  });
});

describe('domainUpdateInputSchema', () => {
  it('rejects an empty patch', () => {
    expect(domainUpdateInputSchema.safeParse({}).success).toBe(false);
  });

  it('accepts partial updates', () => {
    expect(domainUpdateInputSchema.safeParse({ enabled: false }).success).toBe(true);
  });
});

describe('appSettingsPatchSchema', () => {
  it('accepts valid patches and rejects empty/invalid ones', () => {
    expect(appSettingsPatchSchema.safeParse({ httpPort: 8080 }).success).toBe(true);
    expect(appSettingsPatchSchema.safeParse({}).success).toBe(false);
    expect(appSettingsPatchSchema.safeParse({ httpPort: -1 }).success).toBe(false);
  });
});

describe('ipcPayloadSchemas', () => {
  it('covers every declared channel with a schema', () => {
    expect(Object.keys(ipcPayloadSchemas).length).toBeGreaterThanOrEqual(19);
  });

  it('no-payload channels reject unexpected payloads', () => {
    expect(ipcPayloadSchemas['domains:list'].safeParse(undefined).success).toBe(true);
    expect(ipcPayloadSchemas['domains:list'].safeParse({ sneaky: true }).success).toBe(false);
  });

  it('id-based channels validate id format', () => {
    const schema = ipcPayloadSchemas['domains:remove'];
    expect(schema.safeParse({ id: crypto.randomUUID() }).success).toBe(true);
    expect(schema.safeParse({ id: '../../etc/passwd' }).success).toBe(false);
    expect(schema.safeParse({ id: '' }).success).toBe(false);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('system:check-port validates the port', () => {
    const schema = ipcPayloadSchemas['system:check-port'];
    expect(schema.safeParse({ port: 443 }).success).toBe(true);
    expect(schema.safeParse({ port: 'x' }).success).toBe(false);
    expect(schema.safeParse({ port: 0 }).success).toBe(false);
  });
});
