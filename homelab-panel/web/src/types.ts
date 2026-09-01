export type Cpu = {
  usage: number;
  cores: number[];
  count: number;
  model: string | null;
  speedMhz: number | null;
  loadAvg: number[];
};

export type Memory = {
  total: number;
  free: number;
  available: number;
  used: number;
  usage: number;
  swapTotal: number | null;
  swapUsed: number | null;
};

export type DiskEntry = {
  mount: string;
  device: string | null;
  fs: string | null;
  label: string | null;
  total: number;
  free: number;
  used: number;
  usage: number;
};

export type Disks = {
  disks: DiskEntry[];
  total: number;
  used: number;
  free: number;
  usage: number;
};

export type Temperature = {
  supported: boolean;
  sensors: { label: string; celsius: number }[];
  max: number | null;
};

export type Throughput = {
  supported: boolean;
  rxBytesPerSec: number | null;
  txBytesPerSec: number | null;
  totalRx: number | null;
  totalTx: number | null;
};

export type MetricsSnapshot = {
  at: number;
  cpu: Cpu;
  memory: Memory;
  disk: Disks;
  temperature: Temperature;
  network: Throughput;
  host: {
    hostname: string;
    platform: string;
    release: string;
    arch: string;
    uptimeSeconds: number;
    processUptimeSeconds: number;
    nodeVersion: string;
  };
};

export type HistoryPoint = {
  at: number;
  cpu: number;
  memory: number;
  disk: number;
  rx: number | null;
  tx: number | null;
  temp: number | null;
};

export type SiteTunnel = {
  slug: string;
  port: number | null;
  status: 'stopped' | 'installing' | 'starting' | 'running' | 'error';
  url: string | null;
  error: string | null;
  startedAt: number | null;
  restarts: number;
  wanted?: boolean;
  log?: string[];
};

export type Site = {
  id: number;
  slug: string;
  name: string;
  domain: string | null;
  domains: string[];
  path: string;
  pathExists: boolean;
  port: number | null;
  kind: string | null;
  startCommand: string | null;
  autostart: boolean;
  enabled: boolean;
  online: boolean;
  onlineVia: 'process' | 'port' | 'public' | null;
  httpStatus: number | null;
  managed: boolean;
  process: { pid: number; startedAt: number; uptimeSeconds: number; restarts: number } | null;
  sizeBytes: number | null;
  fileCount: number | null;
  lastModified: number | null;
  errorCount: number;
  workspace: string;
  dataDir: string | null;
  dataBytes: number | null;
  dataBranches: number | null;
  liveConnections: number | null;
  publicUrls: string[];
  tunnel: SiteTunnel;
  url: string | null;
  createdAt: number;
  updatedAt: number;
};

export type SiteServerBox = {
  slug: string;
  dataDir: string;
  tokenPreview: string | null;
  addresses: { label: string; ws: string }[];
  branches: { key: string; children: number; bytes: number }[];
  stats: { liveConnections: number; reads: number; writes: number; branches: number };
};

export type Domain = {
  id: number;
  name: string;
  /** آدرسی که برنامه‌ها صدا می‌زنند — خودکار از همین دامنه ساخته می‌شود */
  apiHost: string | null;
  apiUrl: string | null;
  siteId: number | null;
  siteName: string | null;
  sitePort: number | null;
  note: string | null;
  checkedAt: number | null;
  dns: { status: string; records: { a: string[]; cname: string[]; ns: string[] } | null } | null;
  ssl: { status: string; issuer: string | null; expiresAt: number | null; daysLeft: number | null } | null;
  registrationExpiresAt: number | null;
  registrationDaysLeft: number | null;
  httpStatus: number | null;
  online: boolean;
};

export type EventRow = {
  id: number;
  site_id: number | null;
  site_name?: string | null;
  level: 'error' | 'warn' | 'info';
  source: string;
  message: string;
  created_at: number;
};

export type FileItem = {
  name: string;
  path: string;
  isDir: boolean;
  isLink?: boolean;
  size: number | null;
  modified: number | null;
  editable?: boolean;
};

export type NetworkInfo = {
  interfaces: { name: string; address: string; netmask: string; mac: string | null; cidr: string | null }[];
  primary: { name: string; address: string; mac: string | null } | null;
  internalIp: string | null;
  mac: string | null;
  gateway: string | null;
  publicIp: string | null;
  ping: { target: string; ms: number | null } | null;
  throughput: Throughput;
};

export type DashboardData = {
  server: {
    name: string;
    hostname: string;
    online: boolean;
    internalIp: string | null;
    publicIp: string | null;
    mac: string | null;
    gateway: string | null;
    uptimeSeconds: number;
    panelUptimeSeconds: number;
    platform: string;
    release: string;
    arch: string;
    port: number;
  };
  cpu: Cpu;
  memory: Memory;
  disk: Disks;
  temperature: Temperature;
  network: Throughput & { ping: { target: string; ms: number | null } | null };
  counts: { sites: number; sitesOnline: number; domains: number; running: number };
  sites: Site[];
  errors: EventRow[];
  siteSync: { enabled: boolean; liveConnections?: number; branches?: number; reads?: number; writes?: number };
  history: HistoryPoint[];
  at: number;
};

export type SiteServerInfo = {
  enabled: boolean;
  port: number;
  addresses: {
    label: string; host: string; ws: string; http: string; scope?: string;
    /** آدرسِ پایهٔ API — فقط روی آدرس‌های اینترنتی */
    api?: string;
    /** آیا این نام واقعاً در مسیرهای تونل نشسته؟ */
    routed?: boolean;
  }[];
  dedicatedPort: number | null;
  tunnel: {
    status: 'stopped' | 'installing' | 'starting' | 'running' | 'error';
    url: string | null;
    wss: string | null;
    error: string | null;
    startedAt: number | null;
    restarts: number;
    installed: boolean;
    mode: 'quick' | 'named' | 'token';
    hostname: string | null;
    permanent: boolean;
    log: string[];
    diagnosis?: {
      mode: string;
      ok: boolean;
      problems: { code: string; message: string; fixable?: boolean }[];
      lastError: string | null;
    } | null;
  };
  named: {
    loggedIn: boolean;
    configured: boolean;
    hostname: string | null;
    tunnelName: string | null;
    mode: 'quick' | 'named' | 'token';
    hasToken: boolean;
  };
  hostnames: { hostname: string; port: number; main: boolean; source?: string; site?: string; slug?: string }[];
  stores: {
    key: string;
    label: string;
    main: boolean;
    dataDir: string;
    diskBytes: number;
    liveConnections: number;
    branches: { key: string; children: number; bytes: number }[];
  }[];
  tunnelAutostart: boolean;
  siteUrl: string;
  siteLink: string | null;
  siteLinkQr: string | null;
  tokenPreview: string | null;
  stats: {
    connections: number;
    messages: number;
    reads: number;
    writes: number;
    liveConnections: number;
    subscriptions: number;
    branches: number;
    lastActivity: number | null;
    clients: { since: number; remote: string }[];
  };
  branches: { key: string; children: number; bytes: number }[];
  dataDir: string;
  publicIp: string | null;
};
