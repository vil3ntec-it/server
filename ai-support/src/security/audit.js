// ═══════════════════════════════════════════════════════════════════════════
//  لاگِ حسابرسی (Audit)
//
//  هر صدا زدنِ ابزار، هر ردِ درخواست و هر تلاشِ مشکوک این‌جا ثبت می‌شود.
//  قالب JSONL است تا با `tail -f` خوانده شود و با jq فیلتر شود.
//
//  ⚠️ هیچ رازی وارد لاگ نمی‌شود: هر چیزی پیش از نوشتن از redactDeep رد می‌شود.
//     شناسهٔ کاربر هم هش می‌شود، نه خودِ شناسه — برای ردیابی کافی است و برای
//     شناساییِ شخص نه.
// ═══════════════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import config, { DATA_DIR } from '../config.js';
import { assertWritable } from './guard.js';
import { redactDeep } from './redact.js';

const LOG_DIR = path.join(DATA_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'audit.jsonl');

let stream = null;
let bytes = 0;

function ensureStream() {
  if (stream) return stream;
  assertWritable(LOG_FILE);
  fs.mkdirSync(LOG_DIR, { recursive: true });
  try { bytes = fs.statSync(LOG_FILE).size; } catch { bytes = 0; }
  stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  stream.on('error', err => { console.error('⚠️  لاگِ حسابرسی نوشته نشد:', err.message); stream = null; });
  return stream;
}

function rotateIfNeeded() {
  if (bytes < config.audit.maxFileBytes) return;
  try {
    stream?.end();
    stream = null;
    for (let i = config.audit.keepFiles - 1; i >= 1; i--) {
      const from = `${LOG_FILE}.${i}`;
      const to = `${LOG_FILE}.${i + 1}`;
      if (fs.existsSync(from)) fs.renameSync(from, to);
    }
    fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    bytes = 0;
  } catch (e) {
    console.error('⚠️  چرخشِ لاگ انجام نشد:', e.message);
  }
}

/** شناسهٔ کاربر را هش می‌کند — ردیابی بله، شناسایی نه */
export function pseudonym(id) {
  if (!id) return 'anon';
  return crypto.createHmac('sha256', config.auth.sessionSecret)
    .update(String(id)).digest('hex').slice(0, 12);
}

/**
 * ثبتِ یک رویداد.
 * @param {object} event
 * @param {string} event.kind  چه اتفاقی — tool_call | denied | chat | rate_limit | injection | error
 */
export function audit(event) {
  if (!config.audit.enabled) return;
  const rec = {
    ts: new Date().toISOString(),
    ...redactDeep(event),
  };
  if (rec.user) rec.user = pseudonym(rec.user);

  let line;
  try { line = JSON.stringify(rec) + '\n'; }
  catch { line = JSON.stringify({ ts: rec.ts, kind: 'error', msg: 'رویداد قابل‌سریال نبود' }) + '\n'; }

  try {
    const s = ensureStream();
    if (!s) return;
    s.write(line);
    bytes += Buffer.byteLength(line);
    rotateIfNeeded();
  } catch (e) {
    console.error('⚠️  لاگِ حسابرسی:', e.message);
  }
}

/**
 * ثبتِ یک صدا زدنِ ابزار — دقیقاً همان فیلدهایی که در خواستهٔ پروژه آمده بود:
 * User, Time, Tool, Arguments, Result, Permission, Success/Failure
 */
export function auditToolCall({ user, tool, args, ok, result, permission, reason, ms }) {
  audit({
    kind: 'tool_call',
    user,
    tool,
    args,
    permission,
    ok: !!ok,
    reason,
    ms,
    // خودِ نتیجه ثبت نمی‌شود (می‌تواند بزرگ باشد) — فقط اندازه و نوعش
    resultKind: result === undefined ? 'none' : Array.isArray(result) ? `array[${result.length}]` : typeof result,
    resultBytes: result === undefined ? 0 : Buffer.byteLength(JSON.stringify(result) || ''),
  });
}

/** برای تست‌ها و برای صفحهٔ سلامت */
export function auditFilePath() { return LOG_FILE; }
