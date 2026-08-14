// ═══════════════════════════════════════════════════════════════════════════
//  مسیریابِ ابزار — تنها دری که ابزارها از آن اجرا می‌شوند
//
//  هیچ‌جای دیگرِ سرویس handler یک ابزار را مستقیم صدا نمی‌زند. دلیلش این است که
//  چهار بررسیِ زیر باید **همیشه** اتفاق بیفتد و «یادم رفت» نباید ممکن باشد:
//
//      ۱) در whitelist هست؟
//      ۲) readOnly دقیقاً true است؟
//      ۳) سطحِ دسترسیِ کاربر کافی است؟
//      ۴) آرگومان‌ها از schema رد می‌شوند؟
//
//  و در هر حالت — چه موفق چه رد — یک سطر در audit ثبت می‌شود.
// ═══════════════════════════════════════════════════════════════════════════

import config from '../../config.js';
import { TOOL_BY_NAME } from './registry.js';
import { canAccess } from '../../security/auth.js';
import { validate, ValidationError } from '../../security/validate.js';
import { auditToolCall } from '../../security/audit.js';
import { redactDeep } from '../../security/redact.js';

export class ToolDenied extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'ToolDenied';
    this.code = 'TOOL_DENIED';
  }
}

/**
 * اجرای یک ابزار.
 * @param {string} name
 * @param {object} rawArgs آرگومان‌هایی که مدل ساخته — نامعتمد
 * @param {{level: string, user: string, index: object, retriever: object}} ctx
 * @returns {Promise<{ok: boolean, result?: any, error?: string}>}
 */
export async function callTool(name, rawArgs, ctx) {
  const started = Date.now();
  const toolName = String(name || '').slice(0, 64);
  const base = { user: ctx.user, tool: toolName, args: redactDeep(rawArgs), permission: ctx.level };

  const deny = reason => {
    auditToolCall({ ...base, ok: false, reason, ms: Date.now() - started });
    return { ok: false, error: reason };
  };

  // ۱) whitelist
  if (!config.tools.whitelist.includes(toolName)) {
    return deny(`ابزارِ «${toolName}» در فهرستِ مجاز نیست`);
  }

  const tool = TOOL_BY_NAME.get(toolName);
  if (!tool) return deny(`ابزارِ «${toolName}» وجود ندارد`);

  // ۲) فقط‌خواندنی — سخت‌گیرانه: هر چیزی جز دقیقاً true رد است
  if (tool.readOnly !== true) {
    return deny(`ابزارِ «${toolName}» فقط‌خواندنی نیست و اجرا نمی‌شود`);
  }

  // ۳) سطحِ دسترسی
  if (!canAccess(ctx.level, tool.minLevel)) {
    return deny(`سطحِ دسترسیِ شما برای «${toolName}» کافی نیست`);
  }

  // ۴) آرگومان‌ها
  let args;
  try {
    args = validate(rawArgs || {}, tool.schema, toolName);
  } catch (e) {
    if (e instanceof ValidationError) return deny(`ورودیِ «${toolName}» درست نیست: ${e.message}`);
    throw e;
  }

  // ۵) ابزارِ سمتِ دستگاه: سرور اجرایش نمی‌کند — فقط می‌گوید «این را از مرورگر بپرس».
  //    همهٔ بررسی‌های بالا از قبل انجام شده، پس چیزی که به دستگاه می‌رود
  //    whitelist‌شده، فقط‌خواندنی، مجاز برای این سطح، و با آرگومانِ پاک‌شده است.
  if (tool.clientSide === true) {
    auditToolCall({ ...base, args: redactDeep(args), ok: true, reason: 'واگذار به دستگاهِ کاربر', ms: Date.now() - started });
    return { ok: false, deferred: true, tool: toolName, args };
  }

  if (typeof tool.handler !== 'function') {
    return deny(`ابزارِ «${toolName}» پیاده‌سازی ندارد`);
  }

  try {
    const result = await tool.handler(args, ctx);
    auditToolCall({ ...base, args: redactDeep(args), ok: true, result, ms: Date.now() - started });
    return { ok: true, result };
  } catch (e) {
    return deny(`اجرای «${toolName}» شکست خورد: ${e.message}`);
  }
}

/** فهرستِ ابزارهای واقعاً فعال — برای صفحهٔ سلامت و برای تست‌ها */
export function activeTools(level = 'ADMIN') {
  return [...TOOL_BY_NAME.values()]
    .filter(t => config.tools.whitelist.includes(t.name))
    .filter(t => t.readOnly === true)
    .filter(t => canAccess(level, t.minLevel))
    .map(t => ({ name: t.name, minLevel: t.minLevel, readOnly: t.readOnly }));
}
