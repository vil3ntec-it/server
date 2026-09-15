// وضعیت مشترک بین ماژول‌ها (بدون وابستگی حلقه‌ای)
let siteSync = null;
let stations = null;
let io = null;

export const setSiteSync = (v) => {
  siteSync = v;
};
export const getSiteSync = () => siteSync;

// بخشِ پمپ‌بنزین‌ها — هر پمپ با پوشه و رمزِ خودش
export const setStations = (v) => {
  stations = v;
};
export const getStations = () => stations;

export const setIo = (v) => {
  io = v;
};
export const getIo = () => io;

// آینهٔ ابر در پوشهٔ داده (‎stations/cloud-mirror.js‎) — {now, stop}
let mirror = null;
export const setMirror = (v) => {
  mirror = v;
};
export const getMirror = () => mirror;
