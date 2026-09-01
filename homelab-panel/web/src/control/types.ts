// انواع دادهٔ مرکز فرمان — دقیقاً همان چیزی که API برمی‌گرداند
export type ProbeStatus =
  | 'online'
  | 'offline'
  | 'timeout'
  | 'unauthorized'
  | 'ssl_error'
  | 'dns_error'
  | 'connection_error'
  | 'unknown';

export type ProjectType =
  | 'android'
  | 'desktop'
  | 'website'
  | 'webapp'
  | 'backend'
  | 'api'
  | 'websocket'
  | 'database'
  | 'service';

export type ServerKind = 'home' | 'vps' | 'dedicated' | 'cloud' | 'hosting';
export type Environment = 'development' | 'staging' | 'production';

export type Project = {
  id: number;
  project_id: string;
  slug: string;
  name: string;
  type: ProjectType;
  version: string | null;
  status: string;
  description: string | null;
  server_id: number | null;
  server_name?: string | null;
  server_kind?: ServerKind | null;
  repo_url: string | null;
  db_kind: string | null;
  db_host: string | null;
  db_port: number | null;
  db_name: string | null;
  created_at: number;
  updated_at: number;
  endpoints?: number;
  online?: number;
  down?: number;
  domains?: number;
  openAlerts?: number;
  lastBackup?: number | null;
};

export type Server = {
  id: number;
  server_id: string;
  name: string;
  kind: ServerKind;
  hostname: string | null;
  ip: string | null;
  ipv6: string | null;
  ssh_port: number | null;
  os: string | null;
  provider: string | null;
  location: string | null;
  note: string | null;
  is_local: number;
  status: ProbeStatus | string;
  agent_seen: number | null;
  agent_report: AgentReport | null;
  has_agent?: boolean;
  checked_at: number | null;
  projects?: number;
  local_metrics?: { cpuCores: number; totalMem: number; uptime: number; platform: string } | null;
};

export type AgentReport = {
  at: number;
  os?: { platform?: string; type?: string; release?: string; hostname?: string; arch?: string };
  uptime?: number;
  cpu?: { usage: number | null; cores?: number; model?: string | null; load?: number[] };
  memory?: { total: number; free: number; used: number; usage: number | null };
  storage?: { mount: string; total: number; free: number; used: number; usage: number }[];
  network?: { addresses?: { name: string; address: string; family: string }[]; rxBytesPerSec: number | null; txBytesPerSec: number | null };
  runtimes?: Record<string, string | null>;
  services?: { name: string; host: string; port: number; status: string; latencyMs: number }[];
  health?: Record<string, { url?: string; status: string; code: number | null; latencyMs: number }>;
  agent?: { version: string; interval: number; pid: number };
};

export type Endpoint = {
  id: number;
  project_id: number;
  server_id: number | null;
  name: string | null;
  protocol: 'http' | 'https' | 'ws' | 'wss';
  host: string;
  ip: string | null;
  port: number | null;
  path: string;
  environment: Environment;
  is_primary: number;
  monitored: number;
  status: ProbeStatus;
  status_code: number | null;
  latency_ms: number | null;
  error: string | null;
  checked_at: number | null;
  url?: string | null;
  project_name?: string;
  project_public_id?: string;
  server_name?: string | null;
};

export type Ip = {
  id: number;
  project_id: number | null;
  server_id: number | null;
  address: string;
  family: 'ipv4' | 'ipv6';
  kind: 'local' | 'lan' | 'public' | 'server' | 'vps';
  port: number | null;
  environment: string;
  status: ProbeStatus;
  description: string | null;
  project_name?: string;
  server_name?: string;
};

export type Port = {
  id: number;
  project_id: number | null;
  server_id: number | null;
  port: number;
  protocol: string;
  service: string | null;
  environment: string;
  status: ProbeStatus;
  checked_at: number | null;
  note: string | null;
  project_name?: string;
  server_name?: string;
};

export type CcDomain = {
  id: number;
  name: string;
  project_id: number | null;
  server_id: number | null;
  registrar: string | null;
  note: string | null;
  dns_status: string | null;
  ssl_status: string | null;
  ssl_issuer: string | null;
  ssl_expires: number | null;
  reg_expires: number | null;
  http_status: number | null;
  checked_at: number | null;
  cf_zone_id: string | null;
  project_name?: string | null;
  server_name?: string | null;
  route_count?: number;
};

export type Route = {
  id: number;
  domain_id: number | null;
  hostname: string;
  project_id: number | null;
  server_id: number | null;
  tunnel_id: number | null;
  kind: 'tunnel' | 'dns' | 'proxy' | 'manual';
  service: string | null;
  label: string | null;
  status: ProbeStatus;
  checked_at: number | null;
  note: string | null;
  domain_name?: string | null;
  project_name?: string | null;
  server_name?: string | null;
  tunnel_name?: string | null;
  tunnel_status?: string | null;
};

export type Tunnel = {
  id: number;
  name: string;
  tunnel_uuid: string | null;
  account_ref: number | null;
  server_id: number | null;
  project_id: number | null;
  managed_by: string;
  status: string;
  conns: number | null;
  last_check: number | null;
  last_error: string | null;
  note: string | null;
  server_name?: string | null;
  project_name?: string | null;
  account_name?: string | null;
  routes?: { id: number; hostname: string; service: string; project_id: number | null }[];
};

export type CfAccount = {
  id: number;
  name: string;
  account_id: string | null;
  email: string | null;
  status: string;
  verified_at: number | null;
  last_error: string | null;
  token_hint: string | null;
};

export type Secret = {
  id: number;
  name: string;
  kind: string;
  scope: 'global' | 'project' | 'server';
  project_id: number | null;
  server_id: number | null;
  hint: string | null;
  note: string | null;
  masked: string;
  last_used: number | null;
  created_at: number;
};

export type Backup = {
  id: number;
  project_id: number;
  filename: string;
  path: string;
  size: number;
  kind: string;
  version: string | null;
  checksum: string | null;
  status: string;
  entries: number | null;
  error: string | null;
  note: string | null;
  created_at: number;
  file_exists?: boolean;
  project_name?: string;
  project_public_id?: string;
};

export type Release = {
  id: number;
  project_id: number;
  platform: string;
  version: string;
  build: string | null;
  channel: string;
  file_path: string | null;
  file_size: number | null;
  checksum: string | null;
  min_version: string | null;
  mandatory: number;
  notes: string | null;
  published: number;
  released_at: number | null;
  created_at: number;
  file_exists?: boolean;
};

export type Monitor = {
  id: number;
  kind: 'endpoint' | 'domain' | 'server' | 'tunnel' | 'database' | 'port';
  ref_id: number;
  project_id: number | null;
  server_id: number | null;
  label: string;
  target: string;
  enabled: number;
  interval_sec: number;
  status: ProbeStatus;
  status_code: number | null;
  latency_ms: number | null;
  error: string | null;
  checked_at: number | null;
  fails: number;
  project_name?: string | null;
  server_name?: string | null;
};

export type Alert = {
  id: number;
  key: string;
  kind: string;
  severity: 'info' | 'warn' | 'critical';
  project_id: number | null;
  server_id: number | null;
  title: string;
  detail: string | null;
  status: 'open' | 'ack' | 'resolved';
  count: number;
  first_at: number;
  last_at: number;
  project_name?: string | null;
  server_name?: string | null;
};

export type AuditRow = {
  id: number;
  actor: string;
  action: string;
  entity: string | null;
  entity_id: string | null;
  project_id: number | null;
  detail: string | null;
  result: string;
  ip: string | null;
  at: number;
};

export type ProbeResult = {
  status: ProbeStatus;
  code: number | null;
  latencyMs: number | null;
  error: string | null;
  checkedAt: number;
  ssl?: { status?: string; issuer?: string | null; expiresAt?: number | null; daysLeft?: number | null; authorized?: boolean } | null;
};

export type Overview = {
  panel: { version: string | null; build: string | null; hostname: string; startedAt: number };
  counts: {
    projects: { total: number; byType: Record<string, number>; byStatus: Record<string, number> };
    servers: { total: number; byStatus: Record<string, number> };
    endpoints: { total: number; byStatus: Record<string, number> };
    domains: number;
    routes: number;
    tunnels: { total: number; byStatus: Record<string, number> };
    ips: number;
    ports: number;
    users: number;
    shops: number;
    subscriptions: Record<string, number>;
    backups: number;
    releases: number;
    secrets: number;
    alerts: { open: number; critical: number };
    monitors: Record<string, number>;
  };
  projects: { id: number; project_id: string; name: string; type: ProjectType; status: string; server_name: string | null; endpoints: number; online: number; down: number }[];
  servers: Server[];
  monitors: Record<string, { total: number; online: number; offline: number; unknown: number }>;
  alerts: Alert[];
  ssl: { name: string; ssl_status: string | null; ssl_expires: number | null }[];
  storage: { root: string; chosen: boolean; disk: { total: number | null; free: number | null; used: number | null; usage: number | null } };
  vault: { ready: boolean };
  update: UpdateStatus & { pending: { latest: string; at: number } | null };
  lastBackups: Backup[];
};

export type UpdateStatus = {
  repo: string;
  channel: 'release' | 'branch';
  branch: string;
  current: string | null;
  build: string | null;
  installRoot: string;
  layout?: 'repo' | 'packaged';
  shellDir?: string | null;
  installedVersion: string | null;
  installedCommit: string | null;
  installedAt: number | null;
  lastCheck: number | null;
  lastBackup: string | null;
  autoCheck: boolean;
};

export type UpdateInfo = {
  repo: string;
  channel: string;
  current: string;
  latest: string | null;
  available: boolean;
  /** انتشارِ گیت‌هاب از نصبِ فعلی عقب‌تر است — «به‌روز بودن» نیست */
  behind?: boolean;
  prerelease?: boolean;
  publishedAt: number | null;
  notes: string | null;
  tag?: string;
  commit?: string;
  branch?: string;
  error: string | null;
  checkedAt: number;
};
