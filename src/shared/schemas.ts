/**
 * Zod schemas for every IPC payload. The main process refuses any payload
 * that does not parse. Schemas live in shared/ so the renderer can reuse
 * them for form validation, but the main process is the enforcement point.
 */

import { z } from 'zod';
import {
  DEFAULT_HEALTH_CHECK_INTERVAL_S,
  DEFAULT_HEALTH_CHECK_PATH,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_RESPONSE_TIMEOUT_MS,
  MAX_PORT,
  MIN_PORT,
} from './constants';
import {
  normalizeDomain,
  validateDomainName,
  validateHeaderName,
  validateHeaderValue,
  validateTargetHost,
} from './validation';

export const idSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[a-zA-Z0-9-]+$/, 'Invalid id format');

export const portSchema = z.number().int().min(MIN_PORT).max(MAX_PORT);

export const domainNameSchema = z
  .string()
  .min(1, 'Domain is required')
  .max(300)
  .transform((raw) => normalizeDomain(raw).domain)
  .superRefine((domain, ctx) => {
    const result = validateDomainName(domain);
    for (const error of result.errors) {
      ctx.addIssue({ code: 'custom', message: error });
    }
  });

export const targetHostSchema = z
  .string()
  .min(1, 'Target host is required')
  .max(253)
  .transform((raw) => raw.trim().toLowerCase())
  .superRefine((host, ctx) => {
    const result = validateTargetHost(host);
    for (const error of result.errors) {
      ctx.addIssue({ code: 'custom', message: error });
    }
  });

const headerRecordSchema = z
  .record(z.string(), z.string())
  .superRefine((headers, ctx) => {
    for (const [name, value] of Object.entries(headers)) {
      if (!validateHeaderName(name)) {
        ctx.addIssue({ code: 'custom', message: `Invalid header name: "${name}"` });
      }
      if (!validateHeaderValue(value)) {
        ctx.addIssue({ code: 'custom', message: `Invalid header value for "${name}"` });
      }
    }
  });

const basePathSchema = z
  .string()
  .max(512)
  .regex(/^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/, 'Base path must start with / and contain URL-safe characters')
  .optional();

export const protocolSchema = z.enum(['http', 'https']);

export const frontendConfigSchema = z.object({
  protocol: protocolSchema.default('https'),
  redirectHttpToHttps: z.boolean().default(true),
});

export const targetConfigSchema = z.object({
  protocol: protocolSchema.default('http'),
  host: targetHostSchema,
  port: portSchema,
  basePath: basePathSchema,
  allowInvalidCertificate: z.boolean().optional(),
});

export const proxyConfigSchema = z.object({
  preserveHost: z.boolean().default(true),
  rewriteHost: z
    .string()
    .max(253)
    .regex(/^[a-zA-Z0-9.-]+$/, 'Invalid rewrite host')
    .optional(),
  websockets: z.boolean().default(true),
  http2: z.boolean().default(true),
  stripPrefix: basePathSchema,
  addPrefix: basePathSchema,
  requestHeaders: headerRecordSchema.default({}),
  responseHeaders: headerRecordSchema.default({}),
  requestTimeoutMs: z.number().int().min(100).max(600_000).default(DEFAULT_REQUEST_TIMEOUT_MS),
  responseTimeoutMs: z.number().int().min(100).max(600_000).default(DEFAULT_RESPONSE_TIMEOUT_MS),
});

export const healthCheckConfigSchema = z.object({
  enabled: z.boolean().default(false),
  path: z
    .string()
    .max(512)
    .regex(/^\//, 'Health-check path must start with /')
    .default(DEFAULT_HEALTH_CHECK_PATH),
  intervalSeconds: z.number().int().min(2).max(3600).default(DEFAULT_HEALTH_CHECK_INTERVAL_S),
});

export const domainCreateInputSchema = z.object({
  name: z.string().max(120).optional(),
  domain: domainNameSchema,
  enabled: z.boolean().default(true),
  frontend: frontendConfigSchema.partial().optional(),
  target: z.object({
    protocol: protocolSchema.default('http'),
    host: targetHostSchema,
    port: portSchema,
    basePath: basePathSchema,
    allowInvalidCertificate: z.boolean().optional(),
  }),
  proxy: proxyConfigSchema.partial().optional(),
  healthCheck: healthCheckConfigSchema.partial().optional(),
  inspectionEnabled: z.boolean().default(true),
});

/**
 * Patch schemas deliberately carry NO defaults: zod applies `.default()`
 * values even through `.partial()`, which would silently inject defaults
 * into partial updates and overwrite stored values.
 */
export const frontendPatchSchema = z
  .object({
    protocol: protocolSchema,
    redirectHttpToHttps: z.boolean(),
  })
  .partial();

export const proxyPatchSchema = z
  .object({
    preserveHost: z.boolean(),
    rewriteHost: z
      .string()
      .max(253)
      .regex(/^[a-zA-Z0-9.-]+$/, 'Invalid rewrite host'),
    websockets: z.boolean(),
    http2: z.boolean(),
    stripPrefix: z
      .string()
      .max(512)
      .regex(/^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/),
    addPrefix: z
      .string()
      .max(512)
      .regex(/^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/),
    requestHeaders: headerRecordSchema,
    responseHeaders: headerRecordSchema,
    requestTimeoutMs: z.number().int().min(100).max(600_000),
    responseTimeoutMs: z.number().int().min(100).max(600_000),
  })
  .partial();

export const healthCheckPatchSchema = z
  .object({
    enabled: z.boolean(),
    path: z.string().max(512).regex(/^\//, 'Health-check path must start with /'),
    intervalSeconds: z.number().int().min(2).max(3600),
  })
  .partial();

export const domainUpdateInputSchema = z
  .object({
    name: z.string().max(120).optional(),
    domain: domainNameSchema.optional(),
    enabled: z.boolean().optional(),
    frontend: frontendPatchSchema.optional(),
    target: z
      .object({
        protocol: protocolSchema.optional(),
        host: targetHostSchema,
        port: portSchema,
        basePath: basePathSchema,
        allowInvalidCertificate: z.boolean().optional(),
      })
      .optional(),
    proxy: proxyPatchSchema.optional(),
    healthCheck: healthCheckPatchSchema.optional(),
    inspectionEnabled: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: 'Update payload is empty',
  });

export const appSettingsSchema = z.object({
  httpPort: portSchema.default(80),
  httpsPort: portSchema.default(443),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  flushDnsAfterHostsChange: z.boolean().default(true),
  removeHostsEntryOnDisable: z.boolean().default(true),
  autoStartProxy: z.boolean().default(true),
});

/** Defaults-free patch variant (see note above domainUpdateInputSchema). */
export const appSettingsPatchSchema = z
  .object({
    httpPort: portSchema,
    httpsPort: portSchema,
    theme: z.enum(['system', 'light', 'dark']),
    flushDnsAfterHostsChange: z.boolean(),
    removeHostsEntryOnDisable: z.boolean(),
    autoStartProxy: z.boolean(),
  })
  .partial()
  .refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: 'Settings patch is empty',
  });

/** Request payload schemas per IPC channel. `undefined` = no payload allowed. */
export const ipcPayloadSchemas = {
  'domains:list': z.undefined(),
  'domains:get': z.object({ id: idSchema }),
  'domains:create': z.object({ input: domainCreateInputSchema }),
  'domains:update': z.object({ id: idSchema, input: domainUpdateInputSchema }),
  'domains:remove': z.object({ id: idSchema }),
  'domains:enable': z.object({ id: idSchema }),
  'domains:disable': z.object({ id: idSchema }),
  'domains:open': z.object({ id: idSchema }),
  'domains:check-target': z.object({ host: targetHostSchema, port: portSchema }),
  'config:preview': z.undefined(),
  'config:paths': z.undefined(),
  'proxy:start': z.undefined(),
  'proxy:stop': z.undefined(),
  'proxy:restart': z.undefined(),
  'proxy:status': z.undefined(),
  'certificates:install-authority': z.undefined(),
  'certificates:authority-status': z.undefined(),
  'certificates:list': z.undefined(),
  'certificates:regenerate': z.undefined(),
  'settings:get': z.undefined(),
  'settings:update': z.object({ patch: appSettingsPatchSchema }),
  'logs:list': z.object({ limit: z.number().int().min(1).max(5000).optional() }).optional(),
  'logs:clear': z.undefined(),
  'logs:open-directory': z.undefined(),
  'traffic:list': z.object({ limit: z.number().int().min(1).max(2000).optional() }).optional(),
  'traffic:clear': z.undefined(),
  'system:platform-status': z.undefined(),
  'system:check-port': z.object({ port: portSchema }),
} as const;

export type IpcPayloadSchemas = typeof ipcPayloadSchemas;
