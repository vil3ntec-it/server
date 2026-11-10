// «electron» ⇒ همان جای‌گزینِ کوچک (test/fake-electron/electron.mjs) — فقط برای test/guards.mjs
const FAKE = new URL('./electron.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier === 'electron') return { url: FAKE, shortCircuit: true };
  return next(specifier, context);
}
