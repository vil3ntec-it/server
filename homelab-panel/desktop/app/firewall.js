// ---------------------------------------------------------------------------
//  ══ دیوارِ آتشِ ویندوز — در را فقط برای شبکهٔ خانه باز کن (۱۴۰۵/۰۷/۱۳) ═══
//
//  پنل از امروز روی کارتِ شبکه هم گوش می‌دهد (پیش از این فقط ‎127.0.0.1‎، و
//  همان بود که برنامهٔ پمپ و گوشیِ کارمند هیچ‌وقت به سرورِ خانگی نمی‌رسیدند).
//  ولی ویندوز هر پورتِ ورودی را پیش‌فرض می‌بندد، و آن پنجرهٔ «اجازه بدهید؟»ِ
//  خودش را هم کاربر یک بار ببندد، دیگر هیچ‌وقت نمی‌آید.
//
//  پس سه قاعده، فقط برای **همان زیرشبکه** (‎remoteip=localsubnet‎):
//    TCP ‎4700‎  پنل · TCP ‎4701‎ پورتِ عمومی · UDP ‎4702‎ کشفِ خودکار
//
//  ⚠️ ‎netsh‎ اجازهٔ مدیر می‌خواهد و این برنامه عمداً بی مدیر نصب می‌شود، پس
//  **یک بار** با پنجرهٔ UAC می‌پرسیم و جوابش (چه بله چه نه) به یاد می‌ماند.
//  نه گفتن چیزی را نمی‌شکند: روی خودِ همین کامپیوتر همه‌چیز کار می‌کند.
// ---------------------------------------------------------------------------
import { execFile } from 'node:child_process';

export const RULE_PREFIX = 'VILL3N Control Center';

/** سه قاعده — خالص، تا آزمون بی ویندوز هم بسنجدشان. */
export function firewallRules({ panelPort = 4700, publicPort = 4701, discoveryPort = 4702 } = {}) {
  const list = [
    { name: `${RULE_PREFIX} - panel`, protocol: 'TCP', port: panelPort },
    { name: `${RULE_PREFIX} - public`, protocol: 'TCP', port: publicPort },
    { name: `${RULE_PREFIX} - discovery`, protocol: 'UDP', port: discoveryPort },
  ];
  return list.filter((r) => Number.isInteger(r.port) && r.port > 0 && r.port < 65536);
}

/**
 * دستورِ ‎cmd‎ که با یک UAC هر سه را می‌سازد. اول قاعدهٔ همنامِ کهنه پاک
 * می‌شود تا با عوض شدنِ پورت دو قاعده کنارِ هم نمانند.
 * ⛔ ‎remoteip=localsubnet‎ برداشته نشود — همان است که در را به روی اینترنت بسته نگه می‌دارد.
 * ⚠️ ‎profile=any‎ عمدی است: ویندوز وای‌فایِ خانه را خیلی وقت‌ها «عمومی»
 * علامت می‌زند، و قاعدهٔ «فقط خصوصی» آن‌جا بی‌صدا هیچ کاری نمی‌کرد.
 * ⚠️ نام‌ها ASCII‌اند: ‎cmd‎ و ‎powershell‎ نویسهٔ غیرِ ASCII را جابه‌جا خراب می‌کنند.
 */
export function firewallCommand(rules) {
  return rules.map((r) => [
    `netsh advfirewall firewall delete rule name="${r.name}"`,
    `netsh advfirewall firewall add rule name="${r.name}" dir=in action=allow`
      + ` protocol=${r.protocol} localport=${r.port} remoteip=localsubnet profile=any`,
  ].join(' & ')).join(' & ');
}

/** هر سه هست؟ — خروجیِ ‎netsh ... show rule‎ را می‌خواند (نام‌ها انگلیسی‌اند). */
export function rulesPresent(showOutput, rules) {
  const text = String(showOutput || '');
  return rules.every((r) => text.includes(r.name));
}

function run(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 120000 }, (err, stdout) =>
      resolve({ ok: !err, out: String(stdout || '') }));
  });
}

/**
 * فقط روی ویندوز. ‎{ state: 'ok' | 'added' | 'declined' | 'skipped' }‎
 * ⚠️ هیچ‌وقت استثنا بیرون نمی‌دهد؛ دیوارِ آتش رفاه است، پنل اصل.
 */
export async function ensureFirewall(ports, { ask = true } = {}) {
  if (process.platform !== 'win32') return { state: 'skipped' };
  const rules = firewallRules(ports);
  const shown = await run('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=all', 'dir=in']);
  if (rulesPresent(shown.out, rules)) return { state: 'ok' };
  if (!ask) return { state: 'declined' };
  //  یک پنجرهٔ UAC، هر سه قاعده با هم
  const cmd = firewallCommand(rules).replace(/"/g, '\\"');
  const ps = `Start-Process -FilePath cmd.exe -ArgumentList '/c ${cmd.replace(/'/g, "''")}' -Verb RunAs -WindowStyle Hidden -Wait`;
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  const again = await run('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=all', 'dir=in']);
  return { state: rulesPresent(again.out, rules) ? 'added' : 'declined' };
}
