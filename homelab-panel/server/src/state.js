// وضعیت مشترک بین ماژول‌ها (بدون وابستگی حلقه‌ای)
let siteSync = null;
let io = null;

export const setSiteSync = (v) => {
  siteSync = v;
};
export const getSiteSync = () => siteSync;

export const setIo = (v) => {
  io = v;
};
export const getIo = () => io;
