const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  if (event.triggerName) return dailyReset();
  try {
    const { OPENID } = cloud.getWXContext();
    switch (event.action) {
      case 'updateProfile':        return updateProfile(OPENID, event.displayName, event.avatarUrl);
      case 'getProfile':           return getProfile(OPENID);
      case 'updateTodayProgress':  return updateTodayProgress(OPENID, event.done, event.total);
      case 'getTodayProgress':     return getTodayProgress(OPENID);
      default: return { error: 'unknown_action' };
    }
  } catch (e) {
    console.error('users cloud error:', e);
    throw e;
  }
};

async function dailyReset() {
  let skip = 0;
  while (true) {
    const res = await db.collection('users').skip(skip).limit(100).get().catch(() => ({ data: [] }));
    if (!res.data.length) break;
    await Promise.all(res.data.map(u =>
      db.collection('users').doc(u._id).update({ data: { progressMap: {} } }).catch(() => {})
    ));
    if (res.data.length < 100) break;
    skip += 100;
  }
  return { success: true };
}

async function updateProfile(openid, displayName, avatarUrl) {
  if (!displayName || !displayName.trim()) throw new Error('displayName_required');

  // 1. Read existing doc — get customId, createdAt, etc. to preserve them
  let existing = {};
  try {
    const r = await db.collection('users').doc(openid).get();
    existing = r.data || {};
  } catch (_) {}

  // 2. customId: preserve existing one; generate new only if truly missing
  const customId = existing.customId || await generateUniqueCustomId();

  // 3. Build document — spread existing first so no user-data fields are silently wiped
  // (earnedBadges, progressMap, showBadge, note, etc.) then overwrite profile-specific fields.
  // Note: _id and _openid must NOT be included in .set() data payload.
  const { _id, _openid, ...existingRest } = existing;
  const docData = {
    ...existingRest,
    openid,
    customId,
    displayName: displayName.trim(),
    avatarUrl: avatarUrl || existing.avatarUrl || '',
    profileUpdatedAt: db.serverDate(),
    createTime: existing.createTime || db.serverDate(),
  };

  // 4. .set() is an unconditional upsert — no try/catch needed for the write
  await db.collection('users').doc(openid).set({ data: docData });

  // 5. Read back the committed state — avoids returning serverDate() stubs
  const final = await db.collection('users').doc(openid).get();
  return { success: true, profile: final.data };
}

async function getProfile(openid) {
  try {
    const r = await db.collection('users').doc(openid).get();
    return { profile: r.data };
  } catch (e) {
    return { profile: null };
  }
}

// ── 今日进度（按日期隔离，自动清零） ─────────────────────────

function _todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function _cutoffStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

async function updateTodayProgress(openid, done, total) {
  const todayKey = _todayStr();
  const yesterdayKey = _cutoffStr(1);
  const cutoff = _cutoffStr(7);
  try {
    let existing = {};
    try {
      const r = await db.collection('users').doc(openid).get();
      existing = r.data || {};
    } catch (_) {}
    const pm = (existing.progressMap) || {};
    // Keep only last 7 days to avoid unbounded growth
    const pruned = {};
    Object.keys(pm).forEach(k => { if (k >= cutoff) pruned[k] = pm[k]; });
    pruned[todayKey] = { done: Number(done) || 0, total: Number(total) || 0 };

    // Calculate consecutive all-done streak
    let allDoneStreak = existing.allDoneStreak || 0;
    let allDoneStreakLastDate = existing.allDoneStreakLastDate || '';
    const todayAllDone = Number(done) >= Number(total) && Number(total) > 0;
    if (todayAllDone) {
      if (allDoneStreakLastDate === todayKey) {
        // already counted today — no change
      } else if (allDoneStreakLastDate === yesterdayKey) {
        allDoneStreak += 1;
        allDoneStreakLastDate = todayKey;
      } else {
        allDoneStreak = 1;
        allDoneStreakLastDate = todayKey;
      }
    }

    await db.collection('users').doc(openid).update({
      data: { progressMap: pruned, allDoneStreak, allDoneStreakLastDate },
    });
    return { success: true, allDoneStreak };
  } catch (e) {
    return { error: 'failed', allDoneStreak: 0 };
  }
}

async function getTodayProgress(openid) {
  const todayKey = _todayStr();
  try {
    const r = await db.collection('users').doc(openid).get();
    const pm = (r.data && r.data.progressMap) || {};
    const p = pm[todayKey] || { done: 0, total: 0 };
    return { done: p.done || 0, total: p.total || 0, date: todayKey };
  } catch (e) {
    return { done: 0, total: 0, date: todayKey };
  }
}

async function generateUniqueCustomId() {
  for (let i = 0; i < 20; i++) {
    const id = String(Math.floor(100000 + Math.random() * 900000));
    const r = await db.collection('users').where({ customId: id }).get();
    if (r.data.length === 0) return id;
  }
  throw new Error('Failed to generate unique customId');
}
