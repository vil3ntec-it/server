// لایهٔ نازکی روی api() برای مسیرهای مرکز فرمان
import { api, getToken } from '../api';
import type {
  Overview, Project, Server, Endpoint, Ip, Port, CcDomain, Route, Tunnel, CfAccount,
  Secret, Backup, Release, Monitor, Alert, AuditRow, ProbeResult, UpdateInfo, UpdateStatus,
} from './types';

const CC = '/api/control';

export const cc = {
  overview: () => api<Overview>(`${CC}/overview`),

  /* ---------------------------- پروژه‌ها ---------------------------- */
  projects: (q?: { type?: string; status?: string; q?: string }) => {
    const params = new URLSearchParams();
    if (q?.type) params.set('type', q.type);
    if (q?.status) params.set('status', q.status);
    if (q?.q) params.set('q', q.q);
    const qs = params.toString();
    return api<{ projects: Project[]; types: string[] }>(`${CC}/projects${qs ? `?${qs}` : ''}`);
  },
  createProject: (body: Record<string, unknown>) => api<{ project: Project; storage: { dir: string } }>(`${CC}/projects`, { body }),
  project: (id: string) => api<ProjectBundle>(`${CC}/projects/${id}`),
  updateProject: (id: string, body: Record<string, unknown>) => api<{ project: Project }>(`${CC}/projects/${id}`, { method: 'PATCH', body }),
  deleteProject: (id: string, deleteFiles = false) =>
    api<{ ok: true; backup: Backup; removedDir: string | null }>(`${CC}/projects/${id}?confirm=true&deleteFiles=${deleteFiles}`, { method: 'DELETE' }),
  testProject: (id: string) => api<{ results: (ProbeResult & { kind: string; id: number; label: string; url: string })[] }>(`${CC}/projects/${id}/test`, { method: 'POST' }),

  /* ------------------------------ شبکه ------------------------------ */
  addIp: (id: string, body: Record<string, unknown>) => api<{ ip: Ip }>(`${CC}/projects/${id}/ips`, { body }),
  deleteIp: (id: string, ipId: number) => api(`${CC}/projects/${id}/ips/${ipId}`, { method: 'DELETE' }),
  inspectPort: (id: string, body: Record<string, unknown>) =>
    api<{ conflicts: (Port & { project_name?: string })[]; inUseByOther: boolean; probe: ProbeResult | null; listeningButUnregistered: boolean }>(
      `${CC}/projects/${id}/ports/inspect`,
      { body }
    ),
  addPort: (id: string, body: Record<string, unknown>) => api<{ port: Port }>(`${CC}/projects/${id}/ports`, { body }),
  deletePort: (id: string, portId: number) => api(`${CC}/projects/${id}/ports/${portId}`, { method: 'DELETE' }),
  addEndpoint: (id: string, body: Record<string, unknown>) => api<{ endpoint: Endpoint }>(`${CC}/projects/${id}/endpoints`, { body }),
  updateEndpoint: (id: string, epId: number, body: Record<string, unknown>) =>
    api<{ endpoint: Endpoint }>(`${CC}/projects/${id}/endpoints/${epId}`, { method: 'PATCH', body }),
  deleteEndpoint: (id: string, epId: number) => api(`${CC}/projects/${id}/endpoints/${epId}`, { method: 'DELETE' }),
  testEndpoint: (id: string, epId: number) => api<{ url: string; result: ProbeResult }>(`${CC}/projects/${id}/endpoints/${epId}/test`, { method: 'POST' }),

  networkOverview: () => api<{ ips: Ip[]; ports: Port[]; endpoints: Endpoint[]; duplicates: { port: number; server_id: number; n: number }[] }>(`${CC}/network/overview`),

  /* ----------------------------- سرورها ----------------------------- */
  servers: () => api<{ servers: Server[]; kinds: string[] }>(`${CC}/servers`),
  server: (id: string) => api<{ server: Server; projects: Project[]; ports: Port[]; ips: Ip[]; alerts: Alert[] }>(`${CC}/servers/${id}`),
  createServer: (body: Record<string, unknown>) => api<{ server: Server }>(`${CC}/servers`, { body }),
  updateServer: (id: string, body: Record<string, unknown>) => api<{ server: Server }>(`${CC}/servers/${id}`, { method: 'PATCH', body }),
  deleteServer: (id: string) => api(`${CC}/servers/${id}?confirm=true`, { method: 'DELETE' }),
  testServer: (id: string, body?: Record<string, unknown>) => api<{ host: string; port: number; result: ProbeResult }>(`${CC}/servers/${id}/test`, { body: body || {} }),
  agentInfo: (id: string) => api<AgentInfo>(`${CC}/servers/${id}/agent`),
  issueAgentKey: (id: string, panelUrl: string) => api<AgentKeyResponse>(`${CC}/servers/${id}/agent/key`, { body: { panelUrl } }),
  revokeAgentKey: (id: string) => api(`${CC}/servers/${id}/agent/key`, { method: 'DELETE' }),

  /* ------------------------ دامنه، مسیر، تونل ----------------------- */
  domains: () => api<{ domains: CcDomain[] }>(`${CC}/network/domains`),
  addDomain: (body: Record<string, unknown>) => api<{ domain: CcDomain }>(`${CC}/network/domains`, { body }),
  updateDomain: (id: number, body: Record<string, unknown>) => api<{ domain: CcDomain }>(`${CC}/network/domains/${id}`, { method: 'PATCH', body }),
  deleteDomain: (id: number) => api(`${CC}/network/domains/${id}?confirm=true`, { method: 'DELETE' }),
  checkDomain: (id: number) => api<{ domain: CcDomain; result: unknown }>(`${CC}/network/domains/${id}/check`, { body: {} }),

  routes: () => api<{ routes: Route[] }>(`${CC}/network/routes`),
  addRoute: (body: Record<string, unknown>) => api<{ route: Route }>(`${CC}/network/routes`, { body }),
  updateRoute: (id: number, body: Record<string, unknown>) => api<{ route: Route }>(`${CC}/network/routes/${id}`, { method: 'PATCH', body }),
  deleteRoute: (id: number) => api(`${CC}/network/routes/${id}`, { method: 'DELETE' }),
  testRoute: (id: number) => api<{ hostname: string; status: string; dns: unknown; tls: unknown; http: ProbeResult | null }>(`${CC}/network/routes/${id}/test`, { body: {} }),

  tunnels: () => api<{ tunnels: Tunnel[] }>(`${CC}/network/tunnels`),
  addTunnel: (body: Record<string, unknown>) => api<{ tunnel: Tunnel }>(`${CC}/network/tunnels`, { body }),
  updateTunnel: (id: number, body: Record<string, unknown>) => api<{ tunnel: Tunnel }>(`${CC}/network/tunnels/${id}`, { method: 'PATCH', body }),
  deleteTunnel: (id: number) => api(`${CC}/network/tunnels/${id}`, { method: 'DELETE' }),
  addTunnelRoute: (id: number, body: Record<string, unknown>) => api(`${CC}/network/tunnels/${id}/routes`, { body }),
  deleteTunnelRoute: (id: number, routeId: number) => api(`${CC}/network/tunnels/${id}/routes/${routeId}`, { method: 'DELETE' }),
  testTunnel: (id: number) => api<{ tunnel: Tunnel; cloudflare: unknown; probes: (ProbeResult & { hostname: string })[] }>(`${CC}/network/tunnels/${id}/test`, { body: {} }),

  /* ---------------------------- Cloudflare -------------------------- */
  cfAccounts: () => api<{ accounts: CfAccount[] }>(`${CC}/network/cloudflare/accounts`),
  saveCfAccount: (body: Record<string, unknown>) => api<{ account: CfAccount & { verify?: { ok: boolean; error?: string } } }>(`${CC}/network/cloudflare/accounts`, { body }),
  verifyCfAccount: (id: number) => api<{ ok: boolean; error?: string; accountId?: string }>(`${CC}/network/cloudflare/accounts/${id}/verify`, { body: {} }),
  deleteCfAccount: (id: number) => api(`${CC}/network/cloudflare/accounts/${id}`, { method: 'DELETE' }),
  cfZones: (id: number) => api<{ zones: CfZone[] }>(`${CC}/network/cloudflare/${id}/zones`),
  cfDns: (id: number, zoneId: string) => api<{ records: CfDnsRecord[]; ssl: { mode: string | null; universalEnabled: boolean | null } | null }>(`${CC}/network/cloudflare/${id}/zones/${zoneId}/dns`),
  cfAddDns: (id: number, zoneId: string, body: Record<string, unknown>) => api(`${CC}/network/cloudflare/${id}/zones/${zoneId}/dns`, { body }),
  cfUpdateDns: (id: number, zoneId: string, recordId: string, body: Record<string, unknown>) =>
    api(`${CC}/network/cloudflare/${id}/zones/${zoneId}/dns/${recordId}`, { method: 'PATCH', body }),
  cfDeleteDns: (id: number, zoneId: string, recordId: string) => api(`${CC}/network/cloudflare/${id}/zones/${zoneId}/dns/${recordId}`, { method: 'DELETE' }),
  cfTunnels: (id: number) => api<{ tunnels: { id: string; name: string; status: string; connections: number }[] }>(`${CC}/network/cloudflare/${id}/tunnels`),
  cfImportTunnels: (id: number) => api<{ created: number; updated: number; total: number }>(`${CC}/network/cloudflare/${id}/tunnels/import`, { body: {} }),

  /* ----------------------------- حساب‌ها ---------------------------- */
  shops: (id: string) => api<{ shops: Shop[] }>(`${CC}/projects/${id}/shops`),
  addShop: (id: string, body: Record<string, unknown>) => api<{ shop: Shop }>(`${CC}/projects/${id}/shops`, { body }),
  deleteShop: (id: string, shopId: number) => api(`${CC}/projects/${id}/shops/${shopId}?confirm=true`, { method: 'DELETE' }),
  users: (id: string, q?: { q?: string; shop_id?: number; role?: string }) => {
    const params = new URLSearchParams();
    if (q?.q) params.set('q', q.q);
    if (q?.shop_id) params.set('shop_id', String(q.shop_id));
    if (q?.role) params.set('role', q.role);
    const qs = params.toString();
    return api<{ users: AppUser[]; total: number; roles: string[] }>(`${CC}/projects/${id}/users${qs ? `?${qs}` : ''}`);
  },
  addUser: (id: string, body: Record<string, unknown>) => api<{ user: AppUser }>(`${CC}/projects/${id}/users`, { body }),
  updateUser: (id: string, userId: number, body: Record<string, unknown>) => api<{ user: AppUser }>(`${CC}/projects/${id}/users/${userId}`, { method: 'PATCH', body }),
  deleteUser: (id: string, userId: number) => api(`${CC}/projects/${id}/users/${userId}`, { method: 'DELETE' }),
  subscriptions: (id: string, status?: string) =>
    api<{ subscriptions: Subscription[]; summary: Record<string, number>; statuses: string[] }>(
      `${CC}/projects/${id}/subscriptions${status ? `?status=${status}` : ''}`
    ),
  addSubscription: (id: string, body: Record<string, unknown>) => api<{ subscription: Subscription }>(`${CC}/projects/${id}/subscriptions`, { body }),
  subscriptionAction: (id: string, subId: number, action: string, body?: Record<string, unknown>) =>
    api<{ subscription: Subscription }>(`${CC}/projects/${id}/subscriptions/${subId}/${action}`, { body: body || {} }),
  deleteSubscription: (id: string, subId: number) => api(`${CC}/projects/${id}/subscriptions/${subId}`, { method: 'DELETE' }),

  /* ------------------------------ انبار ----------------------------- */
  storageOverview: () => api<StorageOverview>(`${CC}/storage/overview`),
  storageRoot: () => api<{ root: string; chosen: boolean; exists: boolean; disk: Disk; orphans: { folder: string; path: string }[] }>(`${CC}/storage/root`),
  setStorageRoot: (path: string) => api<{ root: string; previous: string; warning: string | null }>(`${CC}/storage/root`, { body: { path } }),

  backups: (projectId?: number) => api<{ backups: Backup[] }>(`${CC}/storage/backups${projectId ? `?project_id=${projectId}` : ''}`),
  projectBackups: (id: string) => api<{ backups: Backup[]; dir: string }>(`${CC}/storage/projects/${id}/backups`),
  createBackup: (id: string, note?: string) => api<{ backup: Backup }>(`${CC}/storage/projects/${id}/backups`, { body: { note } }),
  validateBackup: (id: string, backupId: number) => api<ValidationResult>(`${CC}/storage/projects/${id}/backups/${backupId}/validate`, { body: {} }),
  previewRestore: (id: string, backupId: number) => api<{ validation: ValidationResult; preview: RestorePreview | null }>(`${CC}/storage/projects/${id}/backups/${backupId}/preview`, { body: {} }),
  restoreBackup: (id: string, backupId: number) => api<{ ok: true; safetyBackupId: number | null; files: unknown; data: unknown }>(`${CC}/storage/projects/${id}/backups/${backupId}/restore`, { body: { confirm: true } }),
  deleteBackup: (id: string, backupId: number) => api(`${CC}/storage/projects/${id}/backups/${backupId}`, { method: 'DELETE' }),
  backupDownloadUrl: (id: string, backupId: number) =>
    `${CC}/storage/projects/${id}/backups/${backupId}/download?token=${encodeURIComponent(getToken() || '')}`,

  releases: (id: string) => api<{ releases: Release[]; platforms: string[]; channels: string[]; dir: string; unregistered: { name: string; path: string; size: number }[] }>(`${CC}/storage/projects/${id}/releases`),
  addRelease: (id: string, body: Record<string, unknown>) => api<{ release: Release }>(`${CC}/storage/projects/${id}/releases`, { body }),
  updateRelease: (id: string, releaseId: number, body: Record<string, unknown>) => api<{ release: Release }>(`${CC}/storage/projects/${id}/releases/${releaseId}`, { method: 'PATCH', body }),
  deleteRelease: (id: string, releaseId: number) => api(`${CC}/storage/projects/${id}/releases/${releaseId}`, { method: 'DELETE' }),
  verifyRelease: (id: string, releaseId: number) => api<{ ok: boolean; checksum?: string; error?: string }>(`${CC}/storage/projects/${id}/releases/${releaseId}/verify`, { body: {} }),

  config: (id: string, environment: string) => api<ConfigResponse>(`${CC}/storage/projects/${id}/config?environment=${environment}`),
  saveConfig: (id: string, body: Record<string, unknown>) => api<{ id: number; version: number; rejected: { key: string; reason: string }[]; data: Record<string, unknown> }>(`${CC}/storage/projects/${id}/config`, { body }),
  activateConfig: (id: string, versionId: number) => api(`${CC}/storage/projects/${id}/config/${versionId}/activate`, { body: {} }),
  issueConfigToken: (id: string) => api<{ token: string; example: string }>(`${CC}/storage/projects/${id}/config/token`, { body: {} }),

  /* ---------------------------- جابه‌جایی --------------------------- */
  migrations: (id: string) => api<{ migrations: Migration[] }>(`${CC}/projects/${id}/migrations`),
  migrationPlan: (id: string, toServerId: number) => api<MigrationPlan>(`${CC}/projects/${id}/migrate/plan`, { body: { to_server_id: toServerId } }),
  migrate: (id: string, toServerId: number, ssh?: Record<string, unknown> | null) =>
    api<{ id: number; status: string; steps: MigrationStep[]; backup: Backup; health: unknown[] }>(`${CC}/projects/${id}/migrate`, {
      body: { to_server_id: toServerId, confirm: true, ssh: ssh || null },
    }),

  /* ------------------------- پایش و هشدارها ------------------------ */
  monitoring: () => api<{ monitors: Monitor[]; byKind: Record<string, { total: number; online: number; offline: number; unknown: number }> }>(`${CC}/monitoring`),
  syncMonitors: () => api<{ total: number; removed: number }>(`${CC}/monitoring/sync`, { body: {} }),
  runChecks: () => api<{ checked?: number; skipped?: boolean }>(`${CC}/monitoring/run`, { body: {} }),
  checkMonitor: (id: number) => api<{ result: ProbeResult }>(`${CC}/monitoring/${id}/check`, { body: {} }),
  monitorHistory: (id: number) => api<{ history: { status: string; code: number | null; latency_ms: number | null; at: number }[] }>(`${CC}/monitoring/${id}/history`),
  toggleMonitor: (id: number, enabled: boolean) => api<{ monitor: Monitor }>(`${CC}/monitoring/${id}`, { method: 'PATCH', body: { enabled } }),

  alerts: (status = 'open') => api<{ alerts: Alert[]; counts: Record<string, number> }>(`${CC}/alerts?status=${status}`),
  ackAlert: (id: number) => api(`${CC}/alerts/${id}/ack`, { body: {} }),
  resolveAlert: (id: number) => api(`${CC}/alerts/${id}/resolve`, { body: {} }),

  audit: (q?: { limit?: number; offset?: number; q?: string; action?: string }) => {
    const params = new URLSearchParams();
    if (q?.limit) params.set('limit', String(q.limit));
    if (q?.offset) params.set('offset', String(q.offset));
    if (q?.q) params.set('q', q.q);
    if (q?.action) params.set('action', q.action);
    const qs = params.toString();
    return api<{ rows: AuditRow[]; total: number }>(`${CC}/audit${qs ? `?${qs}` : ''}`);
  },

  /* ---------------------------- گاوصندوق ---------------------------- */
  vault: () => api<{ secrets: Secret[]; kinds: string[]; health: { ready: boolean; total: number; readable: number; broken: { id: number; name: string }[] } }>(`${CC}/vault`),
  addSecret: (body: Record<string, unknown>) => api<{ secret: Secret }>(`${CC}/vault`, { body }),
  deleteSecret: (id: number) => api(`${CC}/vault/${id}`, { method: 'DELETE' }),

  /* -------------------------- به‌روزرسانی --------------------------- */
  updateStatus: () => api<{ status: UpdateStatus; pending: { latest: string; at: number } | null }>(`${CC}/update`),
  checkUpdate: (force = false) => api<UpdateInfo>(`${CC}/update/check`, { body: { force } }),
  updateSettings: (body: Record<string, unknown>) => api<{ status: UpdateStatus }>(`${CC}/update/settings`, { body }),
  installUpdate: (force = false) =>
    api<{ ok: boolean; reason?: string; steps?: MigrationStep[]; version?: string; restart?: boolean }>(`${CC}/update/install`, { body: { confirm: true, force } }),
  rollbackUpdate: () => api<{ ok: true }>(`${CC}/update/rollback`, { body: { confirm: true } }),
};

/* --------------------------- انواعِ کمکی --------------------------- */

export type ProjectBundle = {
  project: Project;
  server: Server | null;
  ips: Ip[];
  ports: Port[];
  endpoints: Endpoint[];
  routes: Route[];
  domains: CcDomain[];
  tunnels: Tunnel[];
  backups: Backup[];
  releases: Release[];
  configs: { id: number; environment: string; version: number; active: number; note: string | null; created_by: string | null; created_at: number }[];
  secrets: Secret[];
  shops: Shop[];
  counts: { users: number; shops: number; subscriptions: number; backups: number };
  monitors: Monitor[];
  alerts: Alert[];
  storage: { dir: string; folders: string[]; exists: boolean; bytes: number; files: number };
};

export type Shop = {
  id: number;
  shop_id: string;
  project_id: number;
  name: string;
  owner_name: string | null;
  owner_phone: string | null;
  manager: string | null;
  address: string | null;
  status: string;
  note: string | null;
  user_count?: number;
  active_subs?: number;
};

export type AppUser = {
  id: number;
  user_uid: string;
  project_id: number;
  shop_id: number | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  role: string;
  status: string;
  registered_at: number | null;
  last_login: number | null;
  shop_name?: string | null;
  active_plan?: string | null;
};

export type Subscription = {
  id: number;
  project_id: number;
  shop_id: number | null;
  user_id: number | null;
  plan: string;
  start_at: number;
  end_at: number;
  status: string;
  price: string | null;
  note: string | null;
  shop_name?: string | null;
  user_name?: string | null;
};

export type CfZone = { id: string; name: string; status: string; paused: boolean; nameServers: string[]; accountName: string | null };
export type CfDnsRecord = { id: string; type: string; name: string; content: string; proxied: boolean; ttl: number; comment: string | null };

export type Disk = { total: number | null; free: number | null; used: number | null; usage: number | null };

export type StorageOverview = {
  root: string;
  chosen: boolean;
  disk: Disk;
  total: number;
  items: { id: number; project_id: string; name: string; slug: string; type: string; dir: string; exists: boolean; bytes: number; files: number; backupsBytes: number; logsBytes: number; releasesBytes: number }[];
};

export type ValidationResult = {
  ok: boolean;
  exists: boolean;
  checksum: string | null;
  checksumOk: boolean | null;
  zip: { ok: boolean; entries: number; bad: { name: string; reason: string }[] } | null;
  manifest: Record<string, unknown> | null;
  errors: string[];
};

export type RestorePreview = {
  manifest: Record<string, unknown> | null;
  folders: Record<string, { files: number; bytes: number }>;
  totalFiles: number;
  totalBytes: number;
  dataset: { counts: Record<string, number>; secrets: string[] } | null;
  willReplace: { directory: string; databaseRows: Record<string, number>; currentUsers: number };
};

export type ConfigResponse = {
  environments: string[];
  environment: string;
  versions: { id: number; environment: string; version: number; active: number; note: string | null; created_by: string | null; created_at: number }[];
  active: { id: number; version: number; data: Record<string, unknown>; created_at: number } | null;
  resolved: { project_id: string; environment: string; version: number; config: Record<string, unknown> };
  hasToken: boolean;
};

export type MigrationStep = { name: string; status: string; detail: unknown; at: number };
export type Migration = { id: number; status: string; steps: MigrationStep[]; from_name: string | null; to_name: string | null; started_at: number; finished_at: number | null; error: string | null };
export type MigrationPlan = {
  from: Server | null;
  to: Server;
  endpoints: { id: number; environment: string; current: string | null; willChange: boolean; next: string }[];
  ips: { id: number; address: string; kind: string; willReassign: boolean }[];
  routes: { id: number; hostname: string; service: string | null; note: string }[];
  stableUrls: string[];
  transfer: { scpLikelyAvailable: boolean; note: string };
};

export type AgentInfo = {
  hasKey: boolean;
  lastSeen: number | null;
  report: import('./types').AgentReport | null;
  instructions: { serverId: string; panelUrl: string; linux: string; windows: string; env: Record<string, string> };
};

export type AgentKeyResponse = { key: string; warning: string; instructions: AgentInfo['instructions'] };
