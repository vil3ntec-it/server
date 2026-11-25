export const testCodeDisplay = ['development', 'test'].includes(process.env.NODE_ENV);

export function requireTestCodeDisplay(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (!testCodeDisplay) {
    return res.status(403).json({ error: 'code_display_disabled', message: 'برای حفظ امنیت حساب، نمایش کد در پنل بسته است.' });
  }
  next();
}
