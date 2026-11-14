// ---------------------------------------------------------------------------
//  🏪 ساختِ جدای بخشِ «فروشگاه» — ‎npm run build:shop-standalone‎ ⇒ سایتِ ایستا در ‎web/dist/shop-standalone/‎ (شرح: ‎docs/SHOP-MODULE-fa.md‎)
//
//  همان کدِ ‎src/modules/shop/‎ که در پنل است، با دو فرق:
//    ۱) هر ‎import … from './host'‎ ِ ماژول به ‎standalone/host.tsx‎ می‌رود (میزبانِ دیگر؛ همان نام‌ها و نوع‌ها)؛
//    ۲) ⛔ هر پروندهٔ دیگری از پنل جز ‎standalone/shared-pieces.json‎ در بسته ⇒ ساخت **سرخ** می‌شود (نه فقط هشدار).
//  ⛔ این ساخت جایی فرستاده نمی‌شود و به ‎server/public‎ دست نمی‌زند.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, 'src');
const MODULE = path.join(SRC, 'modules', 'shop');
const ROOT = path.join(MODULE, 'standalone');
const PANEL_HOST = path.join(MODULE, 'host.ts');
const STANDALONE_HOST = path.join(ROOT, 'host.tsx');
const SHARED = new Set<string>(JSON.parse(fs.readFileSync(path.join(ROOT, 'shared-pieces.json'), 'utf8')).files);

/** ‎./host‎ ِ ماژول ⇒ میزبانِ ساختِ جدا */
function swapHost(): Plugin {
  return {
    name: 'shop-standalone-host',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !source.startsWith('.') || importer === STANDALONE_HOST) return null;
      const r = await this.resolve(source, importer, { ...options, skipSelf: true });
      return r && path.normalize(r.id) === PANEL_HOST ? STANDALONE_HOST : null;
    },
  };
}

/** ⛔ مرزِ بسته: از ‎src/‎ فقط خودِ ماژول و تکه‌های مشترکِ فهرست‌شده */
function onlyShopAndShared(): Plugin {
  const seen = new Set<string>();
  return {
    name: 'shop-standalone-boundary',
    moduleParsed(info) {
      const id = path.normalize(info.id.split('?')[0]);
      if (id.startsWith(SRC + path.sep)) seen.add(path.relative(SRC, id).split(path.sep).join('/'));
    },
    generateBundle() {
      const extra = [...seen].filter((f) => !f.startsWith('modules/shop/') && !SHARED.has(f)).sort();
      if (seen.has('modules/shop/host.ts')) extra.unshift('modules/shop/host.ts (میزبانِ پنل)');
      if (extra.length) this.error(`ساختِ جدای فروشگاه پروندهٔ پنل گرفت (نه در shared-pieces.json): ${extra.join('، ')}`);
      //  فهرستِ واقعیِ پرونده‌های بسته — آزمونِ ‎scripts/check-shop-standalone.mjs‎ همین را هم می‌خواند
      this.emitFile({ type: 'asset', fileName: 'modules.json', source: JSON.stringify([...seen].sort(), null, 2) + '\n' });
    },
  };
}

const OUT = path.join(here, 'dist', 'shop-standalone');
const API = process.env.SHOP_API || 'http://localhost:4700';

export default defineConfig({
  root: ROOT,
  //  نشانیِ نسبیِ داراییها ⇒ همین پوشه زیرِ هر مسیر یا درونِ برنامهٔ دسکتاپ/موبایل باز می‌شود
  base: './',
  //  همان قلم‌های پنل (‎web/public/fonts‎)
  publicDir: path.join(here, 'public'),
  plugins: [swapHost(), onlyShopAndShared(), react()],
  css: { postcss: here },
  build: {
    outDir: OUT,
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  //  ‎npm run dev:shop-standalone‎ / ‎preview:shop-standalone‎: ‎/api‎ به پنلِ در حالِ اجرا (‎SHOP_API‎)
  server: { port: 5274, proxy: { '/api': API } },
  preview: { port: 5275, proxy: { '/api': API } },
});
