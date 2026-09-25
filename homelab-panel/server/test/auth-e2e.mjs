// ---------------------------------------------------------------------------
//  آزمونِ سرتاسری — چندین برنامه روی یک سرورِ احراز هویت
//      node test/auth-e2e.mjs
//
//  چیزی که این‌جا سنجیده می‌شود همان چیزی است که هدفِ کلِ این سرور است:
//  چند برنامهٔ مختلف از یک زیرساختِ مشترک وارد شوند، بی‌آنکه به هم نشت کنند.
//
//    صاحبِ سرور سه برنامه ثبت می‌کند، هر کدام کلیدِ خودش
//    یک ایمیل از هر سه کد می‌خواهد → سه کدِ مستقل
//    کدِ برنامهٔ A در برنامهٔ B کار نمی‌کند
//    کلیدِ برنامهٔ A برای برنامهٔ B کار نمی‌کند
//    ورود از نشانیِ نسخه‌دار، و نشانیِ قدیمی هم هنوز کار می‌کند
//    تمدید، و خروج
//
//  ⚠️ و ایمیلی که واقعاً از سیم رد شد باز و خوانده می‌شود: نام و کدِ
//  *همان شخص* باید داخلش باشد. همین سنجه یک اشکالِ واقعی گرفت — مسیرِ
//  /auth/request-code نامِ شخص را دور می‌ریخت و ایمیل بی‌نام می‌رفت، در
//  حالی که مسیرِ دیگر همین کار را درست انجام می‌داد.
// ---------------------------------------------------------------------------
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import fsp from 'node:fs/promises';
import net from 'node:net'; import os from 'node:os'; import path from 'node:path';

const PORT = Number(process.env.TEST_PORT || 4803), SMTP = PORT + 2, BASE = `http://127.0.0.1:${PORT}`;
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'hlp-e2e-'));
fs.mkdirSync(path.join(tmp, 'sites'), { recursive: true });

const inbox = [];
const smtp = net.createServer((sock) => {
  let stage='cmd', msg='';
  sock.setEncoding('utf8'); sock.write('220 fake\r\n');
  sock.on('data', (c) => {
    if (stage==='data'){ msg+=c; if(msg.includes('\r\n.\r\n')){inbox.push(msg);msg='';stage='cmd';sock.write('250 ok\r\n');} return; }
    for (const l of c.split('\r\n').filter(Boolean)) {
      const u=l.toUpperCase();
      if(u.startsWith('EHLO')||u.startsWith('HELO')) sock.write('250-f\r\n250 AUTH PLAIN\r\n');
      else if(u==='DATA'){stage='data';sock.write('354 go\r\n');}
      else if(u==='QUIT'){sock.write('221 bye\r\n');sock.end();}
      else sock.write('250 ok\r\n');
    }
  });
  sock.on('error',()=>{});
});
await new Promise(r=>smtp.listen(SMTP,'127.0.0.1',r));

const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning','src/index.js'], {
  cwd: path.join(import.meta.dirname, '..'),
  env: { ...process.env, HLP_PORT:String(PORT), HLP_SITESYNC_PORT:String(PORT+1), HLP_HOST:'127.0.0.1',
    HLP_DATA_DIR:path.join(tmp,'data'), HLP_SITES_ROOT:path.join(tmp,'sites'),
    HLP_TUNNEL:'0', HLP_AI_ENABLED:'0', HLP_SITESYNC:'0',
    OTP_EMAIL_HOST:'127.0.0.1', OTP_EMAIL_PORT:String(SMTP), OTP_EMAIL_SECURE:'0',
    OTP_EMAIL_FROM:'robot@test.local', CODES_RESEND_SECONDS:'0' },
  stdio:['ignore','pipe','pipe'] });
let out=''; child.stdout.on('data',d=>out+=d); child.stderr.on('data',d=>out+=d);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const J=(h={})=>({'content-type':'application/json',...h});
for(let i=0;i<120;i++){ try{ if((await fetch(`${BASE}/health`)).ok) break; }catch{} await wait(200); }

let n=0; const step=(t,ok,x='')=>{ n++; console.log(`${ok?'✅':'❌'} ${t}${ok?'':' — '+String(x).slice(0,200)}`); if(!ok) process.exitCode=1; };

try {
  const admin = (await fetch(`${BASE}/api/auth/setup`,{method:'POST',headers:J(),
    body:JSON.stringify({username:'admin',password:'ControlCenter!2026'})}).then(r=>r.json())).token;
  const A = { authorization:`Bearer ${admin}` };

  console.log('\n── صاحبِ سرور سه برنامه ثبت می‌کند ──');
  const keys = {};
  for (const [slug,name] of [['app-a','برنامه A'],['app-b','برنامه B'],['site-a','سایت A']]) {
    const r = await fetch(`${BASE}/api/codes-admin/apps`,{method:'POST',headers:J(A),
      body:JSON.stringify({slug,name,kind:slug.startsWith('site')?'site':'app'})}).then(r=>r.json());
    keys[slug]=r.app?.apiKey;
  }
  step('سه برنامه با کلیدِ جدا ثبت شدند', Object.values(keys).every(k=>/^code_[0-9a-f]{40}$/.test(String(k))), JSON.stringify(keys));

  console.log('\n── یک ایمیل، سه برنامه، سه کدِ مستقل ──');
  const codes = {};
  for (const slug of Object.keys(keys)) {
    await fetch(`${BASE}/api/codes/request`,{method:'POST',headers:J({'x-api-key':keys[slug]}),
      body:JSON.stringify({app:slug,email:'ali@example.com',name:'علی'})});
  }
  await wait(600);
  const live = await fetch(`${BASE}/api/codes-admin/live`,{headers:A}).then(r=>r.json());
  for (const slug of Object.keys(keys)) codes[slug] = live.items.find(i=>i.app===slug && i.email==='ali@example.com')?.code;
  step('هر برنامه کدِ خودش را دارد', new Set(Object.values(codes)).size===3, JSON.stringify(codes));
  step('هر سه ایمیل واقعاً رفت', inbox.length>=3, `${inbox.length} ایمیل`);

  console.log('\n── کدِ یک برنامه در برنامهٔ دیگر کار نمی‌کند ──');
  const cross = await fetch(`${BASE}/api/codes/verify`,{method:'POST',headers:J({'x-api-key':keys['app-b']}),
    body:JSON.stringify({app:'app-b',email:'ali@example.com',code:codes['app-a']})}).then(r=>r.json());
  step('کدِ برنامهٔ A در برنامهٔ B رد می‌شود', cross.ok!==true && cross.error==='wrong_code', JSON.stringify(cross));

  console.log('\n── کلیدِ یک برنامه برای برنامهٔ دیگر کار نمی‌کند ──');
  const wrongKey = await fetch(`${BASE}/api/codes/request`,{method:'POST',headers:J({'x-api-key':keys['app-a']}),
    body:JSON.stringify({app:'app-b',email:'x@example.com'})});
  step('کلیدِ اشتباه رد می‌شود', wrongKey.status===401, `status ${wrongKey.status}`);

  console.log('\n── ورودِ کامل از نشانیِ نسخه‌دار ──');
  await fetch(`${BASE}/api/v1/app/auth/request-code`,{method:'POST',headers:J({'x-api-key':keys['site-a']}),
    body:JSON.stringify({app:'site-a',email:'sara@example.com',name:'سارا'})});
  await wait(400);
  const l2 = await fetch(`${BASE}/api/codes-admin/live`,{headers:A}).then(r=>r.json());
  const saraCode = l2.items.find(i=>i.email==='sara@example.com')?.code;
  const login = await fetch(`${BASE}/api/v1/app/auth/verify-code`,{method:'POST',headers:J({'x-api-key':keys['site-a']}),
    body:JSON.stringify({app:'site-a',email:'sara@example.com',code:saraCode})}).then(r=>r.json());
  step('ورود از /api/v1/app انجام شد', login.ok===true, JSON.stringify(login).slice(0,150));
  step('توکن و کلیدِ تمدید هر دو آمدند', Boolean(login.token && login.refreshToken));

  const meV1 = await fetch(`${BASE}/api/v1/app/me`,{headers:{authorization:`Bearer ${login.token}`}});
  step('/api/v1/app/me کار می‌کند', meV1.status===200, `status ${meV1.status}`);
  const meOld = await fetch(`${BASE}/api/app/me`,{headers:{authorization:`Bearer ${login.token}`}});
  step('نشانیِ قدیمی /api/app/me هم هنوز کار می‌کند', meOld.status===200, `status ${meOld.status}`);

  const ref = await fetch(`${BASE}/api/v1/app/auth/refresh`,{method:'POST',headers:J(),
    body:JSON.stringify({refreshToken:login.refreshToken})}).then(r=>r.json());
  step('تمدید کار می‌کند', ref.ok===true && ref.token!==login.token, JSON.stringify(ref).slice(0,150));

  console.log('\n── ایمیلی که رفت: قالبِ صاحبِ سامانه، با کدِ خودِ همان شخص ──');
  const last = inbox[inbox.length-1];
  const b64 = last.split('Content-Transfer-Encoding: base64')[2]?.split('\r\n\r\n')[1]?.split('\r\n--')[0];
  const html = Buffer.from(String(b64).replace(/\r\n/g,''),'base64').toString('utf8');
  //  ⚠️ تا ۱.۵۰.۱۷ این‌جا «سارا عزیز» خواسته می‌شد — قالبِ قدیمی نام داشت.
  //  قالب‌های صاحبِ سامانه (۱۴۰۵/۰۷/۱۳) جای نام ندارند و «نوشته‌هایشان را دست
  //  نزن» صریح است؛ پس سنجه همان قالب را می‌خواهد، نه نام را.
  step('قالبِ صاحبِ سامانه رفت، نه قالبِ قدیمی',
    html.includes('کد ورود شما') && !html.includes('کد تأیید حساب شما در VILL3N'), html.slice(0,80));
  step('⛔ کد در پیش‌نمایشِ پنهانِ سرِ نامه نیست',
    /display:none/.test(html.slice(0, 400)) && !html.slice(0, html.indexOf('</div>')).includes(String(saraCode)));
  step('کدِ خودِ همان شخص در ایمیل هست', html.includes(String(saraCode)), String(saraCode));

  console.log('\n── خروج ──');
  await fetch(`${BASE}/api/v1/app/auth/logout`,{method:'POST',headers:J({authorization:`Bearer ${ref.token}`}),body:'{}'});
  step('بعد از خروج توکن باطل است',
    (await fetch(`${BASE}/api/v1/app/me`,{headers:{authorization:`Bearer ${ref.token}`}})).status===401);

  console.log(`\n${process.exitCode ? '❌' : '✅'} ${n} سنجه\n`);
} finally {
  child.kill('SIGTERM'); smtp.close(); await wait(400);
  await fsp.rm(tmp,{recursive:true,force:true}).catch(()=>{});
}
