// ---------------------------------------------------------------------------
//  فهرستِ مهاجرت‌ها — به ترتیبِ اجرا
//
//  چرا import ایستا و نه خواندنِ پوشه: مهاجرت‌ها باید **پیش از** بالا آمدنِ
//  سرور و به‌صورت همگام اجرا شوند، ولی importِ پویا در ESM ناهمگام است.
//  با importِ ایستا، ماژول‌ها همان لحظهٔ بارگذاریِ این فایل آماده‌اند.
//  عوارضِ جانبیِ خوبش: مهاجرتِ فراموش‌شده در build دیده می‌شود، نه در اجرا.
//
//  افزودنِ مهاجرتِ تازه: فایلِ NNN_name.js بساز، تابعِ up(db) بنویس و این‌جا
//  به فهرست اضافه کن. شماره‌ها هرگز دوباره استفاده نمی‌شوند.
// ---------------------------------------------------------------------------
import { up as up001 } from './001_initial.js';
import { up as up002 } from './002_user_roles.js';
import { up as up003 } from './003_backups.js';
import { up as up004 } from './004_cron.js';
import { up as up005 } from './005_automation.js';
import { up as up006 } from './006_totp_sessions.js';
import { up as up007 } from './007_owner_console.js';
import { up as up008 } from './008_recovery_expiry.js';
import { up as up009 } from './009_totp_last_step.js';
import { up as up010 } from './010_fleet.js';
import { up as up011 } from './011_fleet_placement.js';
import { up as up012 } from './012_app_hostnames.js';
import { up as up013 } from './013_flag_sudo.js';
import { up as up014 } from './014_owner_alerts.js';
import { up as up015 } from './015_totp_sealed.js';
import { up as up016 } from './016_app_key_hashes.js';
import { up as up017 } from './017_notify_token_hashes.js';

export const migrations = [
  { version: 1, name: 'initial', up: up001 },
  { version: 2, name: 'user_roles', up: up002 },
  { version: 3, name: 'backups', up: up003 },
  { version: 4, name: 'cron', up: up004 },
  { version: 5, name: 'automation', up: up005 },
  { version: 6, name: 'totp_sessions', up: up006 },
  { version: 7, name: 'owner_console', up: up007 },
  { version: 8, name: 'recovery_expiry', up: up008 },
  { version: 9, name: 'totp_last_step', up: up009 },
  { version: 10, name: 'fleet', up: up010 },
  { version: 11, name: 'fleet_placement', up: up011 },
  { version: 12, name: 'app_hostnames', up: up012 },
  { version: 13, name: 'flag_sudo', up: up013 },
  { version: 14, name: 'owner_alerts', up: up014 },
  { version: 15, name: 'totp_sealed', up: up015 },
  { version: 16, name: 'app_key_hashes', up: up016 },
  { version: 17, name: 'notify_token_hashes', up: up017 },
];
