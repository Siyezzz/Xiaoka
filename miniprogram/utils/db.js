// 懒初始化，确保 wx.cloud.init() 已执行再获取 db
let _db = null;
const getDb = () => {
  if (!_db) _db = wx.cloud.database();
  return _db;
};
const getCmd = () => getDb().command;

const TODAY = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function isDueToday(habit) {
  const day = new Date().getDay();
  if (habit.frequency.type === 'daily') return true;
  if (habit.frequency.type === 'free') return true;
  return (habit.frequency.days || []).includes(day);
}

function isColMissing(e) {
  const m = e.errMsg || e.message || '';
  return m.includes('ResourceNotFound') || m.includes('not exist') || e.errCode === -502005;
}

// ===== 内存缓存 =====
const _cache = {};
const TTL_HABITS   = 60000;  // 60s
const TTL_CHECKINS = 30000;  // 30s
const TTL_HIST     = 120000; // 2min

function _cGet(key, ttl) {
  const c = _cache[key];
  if (c && Date.now() - c.ts < ttl) return c.data;
  return null;
}
function _cSet(key, data) { _cache[key] = { data, ts: Date.now() }; }
function _cDel(key) { delete _cache[key]; }
function _cClearHist(habitId) {
  Object.keys(_cache).forEach(k => { if (k.startsWith('hist:' + habitId + ':')) delete _cache[k]; });
}

function invalidateHabits()  { _cDel('habits'); _cDel('habits:all'); }
function invalidateCheckins(habitId) {
  _cDel('checkins');
  if (habitId) _cClearHist(habitId);
}

async function getHabits() {
  const cached = _cGet('habits', TTL_HABITS);
  if (cached) return cached;
  const db = getDb();
  try {
    const res = await db.collection('habits')
      .where({ isActive: true })
      .orderBy('createdAt', 'asc')
      .limit(100)
      .get();
    const sorted = res.data.slice().sort((a, b) => {
      const ao = (a.sortOrder != null) ? a.sortOrder : Infinity;
      const bo = (b.sortOrder != null) ? b.sortOrder : Infinity;
      return ao - bo;
    });
    _cSet('habits', sorted);
    return sorted;
  } catch (e) {
    if (isColMissing(e)) { _cSet('habits', []); return []; }
    throw e;
  }
}

async function getAllHabits() {
  const cached = _cGet('habits:all', TTL_HABITS);
  if (cached) return cached;
  const db = getDb();
  try {
    // Two explicit queries instead of a bare collection scan.
    // WeChat Cloud DB can silently truncate full-collection scans (no where clause),
    // but filtered queries with known index fields return reliably.
    const [activeRes, deletedRes] = await Promise.all([
      db.collection('habits').where({ isActive: true }).orderBy('createdAt', 'asc').limit(100).get(),
      db.collection('habits').where({ isActive: false }).limit(100).get(),
    ]);
    const data = [
      ...activeRes.data,
      ...deletedRes.data.filter(h => !h.isHardDeleted),
    ];
    data.sort((a, b) => {
      const ao = (a.sortOrder != null) ? a.sortOrder : Infinity;
      const bo = (b.sortOrder != null) ? b.sortOrder : Infinity;
      return ao - bo;
    });
    _cSet('habits:all', data);
    return data;
  } catch (e) {
    if (isColMissing(e)) { _cSet('habits:all', []); return []; }
    throw e;
  }
}

async function getTodayCheckins() {
  const cached = _cGet('checkins', TTL_CHECKINS);
  if (cached) return cached;
  const db = getDb();
  const today = TODAY();
  try {
    const res = await db.collection('checkins').where({ date: today }).get();
    _cSet('checkins', res.data);
    return res.data;
  } catch (e) {
    if (isColMissing(e)) { _cSet('checkins', []); return []; }
    throw e;
  }
}

async function toggleCheckin(habitId, alreadyChecked, checkinId) {
  const db = getDb();
  const today = TODAY();
  _cDel('checkins');
  _cClearHist(habitId);
  if (alreadyChecked && checkinId) {
    await db.collection('checkins').doc(checkinId).remove();
    return false;
  } else {
    await db.collection('checkins').add({
      data: { habitId, date: today, createdAt: new Date() }
    });
    return true;
  }
}

async function addCheckin(habitId) {
  const db = getDb();
  const today = TODAY();
  _cDel('checkins');
  _cClearHist(habitId);
  await db.collection('checkins').add({
    data: { habitId, date: today, createdAt: new Date() }
  });
}

async function addHabit(habit) {
  _cDel('habits'); _cDel('habits:all');
  const db = getDb();
  const data = { ...habit, isActive: true, createdAt: new Date() };
  try {
    const res = await db.collection('habits').add({ data });
    return res._id;
  } catch (e) {
    if (isColMissing(e)) {
      try { await wx.cloud.callFunction({ name: 'login' }); } catch (_) {}
      const res = await db.collection('habits').add({ data });
      return res._id;
    }
    throw e;
  }
}

async function updateHabit(id, data) {
  _cDel('habits'); _cDel('habits:all');
  const db = getDb();
  await db.collection('habits').doc(id).update({ data });
}

async function deleteHabit(id) {
  _cDel('habits'); _cDel('habits:all');
  const db = getDb();
  await db.collection('habits').doc(id).update({ data: { isActive: false, 'reminder.enabled': false } });
  wx.cloud.callFunction({
    name: 'reminders',
    data: { action: 'cancelTimerScheduleByHabit', habitId: id },
  }).catch(() => {});
}

async function recoverHabit(id) {
  _cDel('habits'); _cDel('habits:all');
  const db = getDb();
  await db.collection('habits').doc(id).update({ data: { isActive: true } });
}

async function hardDeleteHabit(id) {
  _cDel('habits'); _cDel('habits:all');
  _cClearHist(id);
  const db = getDb();
  const _ = getCmd();
  // Mark habit as hard-deleted so it no longer appears anywhere
  await db.collection('habits').doc(id).update({ data: { isActive: false, isHardDeleted: true, 'reminder.enabled': false } });
  wx.cloud.callFunction({
    name: 'reminders',
    data: { action: 'cancelTimerScheduleByHabit', habitId: id },
  }).catch(() => {});
  // Delete check-in records in batches
  try {
    let hasMore = true;
    while (hasMore) {
      const res = await db.collection('checkins').where({ habitId: id }).limit(20).get();
      if (!res.data.length) { hasMore = false; break; }
      await Promise.all(res.data.map(c => db.collection('checkins').doc(c._id).remove()));
      if (res.data.length < 20) hasMore = false;
    }
  } catch (e) {
    if (!isColMissing(e)) throw e;
  }
}

async function getCheckinsByDateRange(habitId, startDate, endDate) {
  const db = getDb();
  const _ = getCmd();
  const dates = [];
  const cursor = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  while (cursor <= end) {
    dates.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  try {
    const res = await db.collection('checkins')
      .where({ habitId, date: _.in(dates) })
      .limit(100)
      .get();
    return res.data;
  } catch (e) {
    if (isColMissing(e)) return [];
    throw e;
  }
}

async function getCheckinHistory(habitId, days = 30) {
  const cacheKey = `hist:${habitId}:${days}`;
  const cached = _cGet(cacheKey, TTL_HIST);
  if (cached) return cached;

  const db = getDb();
  const _ = getCmd();
  const dates = [];
  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  try {
    const res = await db.collection('checkins').where({ habitId, date: _.in(dates) }).limit(400).get();
    _cSet(cacheKey, res.data);
    return res.data;
  } catch (e) {
    if (isColMissing(e)) return [];
    throw e;
  }
}

function calcStreak(habit, checkins) {
  const checkinDates = new Set(checkins.map(c => c.date));
  let streak = 0;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const todayDay = today.getDay();

  // If today is a due day but not yet checked in, start counting from yesterday.
  // This prevents streak from showing 0 all day until the user checks in.
  const todayIsDue = habit.frequency.type === 'daily'
    || habit.frequency.type === 'free'
    || (habit.frequency.days || []).includes(todayDay);
  const startFrom = (todayIsDue && !checkinDates.has(todayStr)) ? 1 : 0;

  for (let i = startFrom; i < 365; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const day = d.getDay();
    const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (habit.frequency.type === 'free') {
      if (checkinDates.has(ds)) streak++;
      else break;
      continue;
    }
    const isDue = habit.frequency.type === 'daily' || (habit.frequency.days || []).includes(day);
    if (!isDue) continue;
    if (checkinDates.has(ds)) streak++;
    else break;
  }
  return streak;
}

// ===== 乐观打卡本地存储 =====
// 记录当天已打卡的习惯，作为 DB 最终一致性的兜底：
// 即使 DB 读取返回旧数据，本地记录保证 UI 不会丢失打卡状态
// 格式：{ [habitId]: { date: 'YYYY-MM-DD', count: N } }
const OPT_KEY = 'ht_opt_checkins';

function recordOptCheckin(habitId, count) {
  try {
    const today = TODAY();
    const stored = wx.getStorageSync(OPT_KEY) || {};
    Object.keys(stored).forEach(k => { if (stored[k].date !== today) delete stored[k]; });
    stored[habitId] = { date: today, count };
    wx.setStorageSync(OPT_KEY, stored);
  } catch (e) {}
}

function getOptCheckins() {
  try {
    const today = TODAY();
    const stored = wx.getStorageSync(OPT_KEY) || {};
    const result = {};
    Object.keys(stored).forEach(id => {
      if (stored[id].date === today) result[id] = stored[id].count;
    });
    return result;
  } catch (e) { return {}; }
}

function removeOptCheckin(habitId) {
  try {
    const stored = wx.getStorageSync(OPT_KEY) || {};
    delete stored[habitId];
    wx.setStorageSync(OPT_KEY, stored);
  } catch (e) {}
}

async function getRecentPhotoCheckins(days) {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  const cutoff = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  try {
    const db = getDb();
    const res = await db.collection('checkins')
      .where({ date: db.command.gte(cutoff) })
      .limit(200)
      .get();
    return res.data.filter(c => c.photos && c.photos.length > 0);
  } catch (e) {
    return [];
  }
}

module.exports = {
  getDb,
  TODAY,
  isDueToday,
  getHabits,
  getAllHabits,
  getTodayCheckins,
  getRecentPhotoCheckins,
  toggleCheckin,
  addCheckin,
  addHabit,
  updateHabit,
  deleteHabit,
  recoverHabit,
  hardDeleteHabit,
  getCheckinHistory,
  getCheckinsByDateRange,
  calcStreak,
  invalidateHabits,
  invalidateCheckins,
  recordOptCheckin,
  getOptCheckins,
  removeOptCheckin,
};
