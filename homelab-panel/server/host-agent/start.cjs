'use strict';
// ---------------------------------------------------------------------------
//  cPanel ⇐ «Setup Node.js App» ⇐ Application startup file: ‎vill3n-agent/start.cjs‎ (۱.۵۱.۱)
//
//  ۱) نمایندهٔ هاست (‎agent.cjs‎): یک بار وصل با ‎VILL3N_JOIN_CODE‎ و تپشِ بیرون‌رو — در پس‌زمینه، بی هیچ درِ ورودی
//  ۲) خودِ سرورِ حساب (‎../src/index.js‎) — همان پورتی که هاست می‌دهد (‎PORT‎ / Passenger) را گوش می‌کند
//  ⛔ شکستِ نماینده (مرکز در دسترس نیست، کدِ کهنه…) سرورِ حساب را نمی‌خواباند؛ فقط در لاگِ همان برنامه گفته می‌شود.
// ---------------------------------------------------------------------------
const path = require('node:path');
const agent = require('./agent.cjs');

let accountUp = false;
agent.start({ agentDir: __dirname, accountRunning: () => accountUp }).catch((e) => console.log(`[vill3n-agent] ❌ ${e?.message || e}`));

const entry = process.env.VILL3N_ACCOUNT_ENTRY || path.join(__dirname, '..', 'src', 'index.js');
try {
  require(entry);
  accountUp = true;
} catch (e) {
  //  ESM ⇒ با ‎import()‎
  if (e && e.code === 'ERR_REQUIRE_ESM') {
    import(require('node:url').pathToFileURL(entry).href).then(() => { accountUp = true; }, (err) => console.error(err));
  } else {
    console.error(e);
  }
}
