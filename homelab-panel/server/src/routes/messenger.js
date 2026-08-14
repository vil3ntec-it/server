// ---------------------------------------------------------------------------
//  API پیام‌رسان — همان چیزی که سایت با آن حرف می‌زند
//
//  توجه: این مسیرها با حسابِ *کاربرِ پیام‌رسان* کار می‌کنند، نه با حسابِ مدیرِ
//  پنل. مدیر پنل به پیام‌های مردم دسترسی ندارد.
// ---------------------------------------------------------------------------
import { Router } from 'express';
import * as messenger from '../messenger/index.js';
import * as store from '../messenger/store.js';
import { vapidPublicKey } from '../messenger/push.js';

const router = Router();

/** کاربر را از هدر Authorization پیدا می‌کند */
function requireUser(req, res, next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = messenger.readToken(token);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.msgUser = user;
  next();
}

// ------------------------------- ورود/ثبت‌نام ------------------------------
router.get('/config', (req, res) => {
  res.json({ vapidPublicKey: vapidPublicKey() });
});

router.post('/request-code', (req, res) => {
  const result = messenger.requestCode(req.body?.phone);
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.post('/verify-code', (req, res) => {
  const result = messenger.verifyCode(req.body || {});
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
});

router.post('/login', (req, res) => {
  const result = messenger.loginWithPassword(req.body || {});
  if (!result.ok) return res.status(401).json(result);
  res.json(result);
});

router.use(requireUser);

router.get('/me', (req, res) => {
  res.json({ user: store.publicUser(req.msgUser), chats: store.listChats(req.msgUser.id) });
});

router.put('/me', (req, res) => {
  res.json({ ok: true, user: store.publicUser(store.updateUser(req.msgUser.id, req.body || {})) });
});

// ------------------------------- مخاطبین -----------------------------------
// شماره‌های دفترچهٔ گوشی را می‌فرستد، و می‌گوییم کدام‌ها اینجا حساب دارند
router.post('/contacts/lookup', (req, res) => {
  const phones = Array.isArray(req.body?.phones) ? req.body.phones.slice(0, 2000) : [];
  const found = store.findUsersByPhones(phones).filter((u) => u.id !== req.msgUser.id);
  res.json({ contacts: found.map(store.publicUser) });
});

// ------------------------------- گفت‌وگوها ---------------------------------
router.get('/chats', (req, res) => {
  res.json({ chats: store.listChats(req.msgUser.id) });
});

router.post('/chats/direct', (req, res) => {
  const phone = store.normalizePhone(req.body?.phone);
  const peer = req.body?.userId ? store.getUser(req.body.userId) : phone ? store.findUserByPhone(phone) : null;
  if (!peer) return res.status(404).json({ error: 'user_not_found' });
  if (peer.id === req.msgUser.id) return res.status(400).json({ error: 'cannot_chat_yourself' });
  const chat = store.directChat(req.msgUser.id, peer.id);
  res.json({ ok: true, chatId: chat.id, peer: store.publicUser(peer) });
});

router.post('/chats/group', (req, res) => {
  const chat = store.createGroup({
    title: req.body?.title,
    createdBy: req.msgUser.id,
    memberIds: Array.isArray(req.body?.memberIds) ? req.body.memberIds : [],
  });
  res.json({ ok: true, chatId: chat.id });
});

router.post('/chats/:id/members', (req, res) => {
  if (!store.isMember(req.params.id, req.msgUser.id)) return res.status(403).json({ error: 'not_a_member' });
  const members = store.addMembers(req.params.id, req.body?.memberIds || []);
  res.json({ ok: true, members: members.map(store.publicUser) });
});

router.delete('/chats/:id/members/me', (req, res) => {
  store.leaveChat(req.params.id, req.msgUser.id);
  res.json({ ok: true });
});

// -------------------------------- پیام‌ها ----------------------------------
router.get('/chats/:id/messages', (req, res) => {
  if (!store.isMember(req.params.id, req.msgUser.id)) return res.status(403).json({ error: 'not_a_member' });
  res.json({
    messages: store.history(req.params.id, { before: req.query.before, limit: req.query.limit }),
  });
});

router.post('/chats/:id/messages', async (req, res) => {
  const result = await messenger.sendMessage({
    chatId: req.params.id,
    senderId: req.msgUser.id,
    body: req.body?.body,
    kind: req.body?.kind,
    fileName: req.body?.fileName,
    fileSize: req.body?.fileSize,
    replyTo: req.body?.replyTo,
  });
  if (!result.ok) return res.status(403).json(result);
  res.json(result);
});

router.post('/chats/:id/read', (req, res) => {
  const result = messenger.readChat(req.params.id, req.msgUser.id, req.body?.upToId);
  if (!result.ok) return res.status(403).json(result);
  res.json(result);
});

router.put('/messages/:id', (req, res) => {
  const updated = store.editMessage(req.params.id, req.msgUser.id, req.body?.body ?? '');
  if (!updated) return res.status(403).json({ error: 'cannot_edit' });
  res.json({ ok: true, message: store.publicMessage(updated) });
});

router.delete('/messages/:id', (req, res) => {
  const removed = store.deleteMessage(req.params.id, req.msgUser.id);
  if (!removed) return res.status(403).json({ error: 'cannot_delete' });
  res.json({ ok: true, message: store.publicMessage(removed) });
});

router.get('/messages/:id/receipts', (req, res) => {
  res.json(store.receiptSummary(req.params.id));
});

// ------------------------- نوتیفیکیشنِ برنامه‌بسته --------------------------
router.post('/devices', (req, res) => {
  const sub = req.body?.subscription || req.body || {};
  const devices = store.saveDevice(req.msgUser.id, {
    label: req.body?.label,
    endpoint: sub.endpoint,
    p256dh: sub.keys?.p256dh,
    auth: sub.keys?.auth,
  });
  res.json({ ok: true, devices: devices.length });
});

router.delete('/devices', (req, res) => {
  if (req.query.endpoint) store.removeDevice(req.query.endpoint);
  res.json({ ok: true });
});

export default router;
