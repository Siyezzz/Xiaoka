const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

function _todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext();
    switch (event.action) {
      case 'getOrCreateProfile':   return getOrCreateProfile(OPENID);
      case 'updateProfile':        return updateProfile(OPENID, event.displayName, event.avatarUrl);
      case 'lookupUserByCode':     return lookupUserByCode(event.code);
      case 'addFriendByCode':      return addFriendByCode(OPENID, event.code);
      case 'getFriends':           return getFriends(OPENID);
      case 'getFriendsWithHabits': return getFriendsWithHabits(OPENID);
      case 'removeFriend':         return removeFriend(OPENID, event.friendOpenid);
      case 'getFriendHabits':      return getFriendHabits(OPENID, event.friendOpenid);
      case 'getConversation':      return getConversation(OPENID, event.friendOpenid);
      case 'updateShowBadge':      return updateShowBadge(OPENID, event.showBadge);
      case 'updateBadges':         return updateBadges(OPENID, event.earnedBadges);
      case 'sendLike':             return sendLike(OPENID, event.targetOpenid);
      case 'unlike':               return unlike(OPENID, event.targetOpenid);
      case 'getLikeStatus':        return getLikeStatus(OPENID, event.targetOpenid);
      case 'sendComment':          return sendComment(OPENID, event.targetOpenid, event.text, event.imageUrl, event.quoteText);
      case 'deleteNotification':   return deleteNotification(OPENID, event.notificationId);
      case 'getMyNotifications':   return getMyNotifications(OPENID);
      case 'getSentNotifications': return getSentNotifications(OPENID);
      case 'markNotificationsRead': return markNotificationsRead(OPENID);
      case 'getUnreadCount':       return getUnreadCount(OPENID);
      case 'sendReminder':         return sendReminder(OPENID, event.targetOpenid, event.habitName, event.tipText);
      case 'updateNote':           return updateNote(OPENID, event.note);
      case 'getFriendsProgress':   return getFriendsProgress(OPENID);
      case 'seedFakeData':         return seedFakeData(OPENID);
      default: return { error: 'unknown_action' };
    }
  } catch (e) {
    console.error('social cloud error:', e);
    return { error: 'internal_error', message: e.message };
  }
};

// ── helpers ────────────────────────────────────────────────

async function generateUniqueCustomId() {
  for (let i = 0; i < 20; i++) {
    const id = String(Math.floor(100000 + Math.random() * 900000));
    const r = await db.collection('users').where({ customId: id }).get();
    if (r.data.length === 0) return id;
  }
  throw new Error('Failed to generate unique customId');
}

// Resolve a flat array of cloud:// fileID strings to HTTPS temp URLs
async function resolvePhotoUrls(urls) {
  const ids = [...new Set((urls || []).filter(u => u && u.startsWith('cloud://')))];
  if (ids.length === 0) return urls || [];
  try {
    const res = await cloud.getTempFileURL({ fileList: ids });
    const map = {};
    (res.fileList || []).forEach(f => { if (f.tempFileURL) map[f.fileID] = f.tempFileURL; });
    return (urls || []).map(u => map[u] || u);
  } catch (e) {
    return urls || [];
  }
}

// Convert cloud:// fileIDs to accessible temp URLs (bypasses per-user read rules)
async function resolveTempUrls(items, field) {
  const ids = [...new Set(items.map(x => x && x[field]).filter(v => v && v.startsWith('cloud://')))];
  if (ids.length === 0) return items;
  try {
    const res = await cloud.getTempFileURL({ fileList: ids });
    const map = {};
    (res.fileList || []).forEach(f => { if (f.tempFileURL) map[f.fileID] = f.tempFileURL; });
    return items.map(x => (x && x[field] && map[x[field]]) ? { ...x, [field]: map[x[field]] } : x);
  } catch (e) {
    return items;
  }
}

async function areFriends(openidA, openidB) {
  try {
    const r = await db.collection('friends')
      .where({ userId: openidA, friendId: openidB })
      .get();
    return r.data.length > 0;
  } catch (e) {
    return false;
  }
}

// ── 获取/创建用户档案 ──────────────────────────────────────
async function getOrCreateProfile(openid) {
  // 【注释掉每日清除点赞逻辑，改成累积点赞】
  // try {
  //   await db.collection('notifications')
  //     .where({
  //       fromOpenid: openid,
  //       type: 'like'
  //     })
  //     .remove();
  // } catch (e) {}
  // Always read first
  let existing = null;
  try {
    const r = await db.collection('users').doc(openid).get();
    existing = r.data;
  } catch (_) {}

  if (existing) {
    // Backfill customId for any user who somehow never got one
    if (!existing.customId) {
      const customId = await generateUniqueCustomId();
      await db.collection('users').doc(openid).update({ data: { customId } });
      existing.customId = customId;
    }
    return { profile: existing };
  }

  // Brand new user — create with a 6-digit numeric ID
  const customId = await generateUniqueCustomId();
  const profile = {
    openid,
    customId,
    displayName: '习惯达人',
    avatarUrl: '',
    createTime: db.serverDate(),
  };
  await db.collection('users').doc(openid).set({ data: profile });
  return { profile: { _id: openid, ...profile } };
}

// ── 更新用户资料 ────────────────────────────────────────────
async function updateProfile(openid, displayName, avatarUrl) {
  if (!displayName || !displayName.trim()) throw new Error('displayName_required');

  let existing = {};
  try {
    const r = await db.collection('users').doc(openid).get();
    existing = r.data || {};
  } catch (_) {}

  const customId = existing.customId || await generateUniqueCustomId();

  await db.collection('users').doc(openid).update({
    data: {
      customId,
      displayName: displayName.trim(),
      avatarUrl: avatarUrl || existing.avatarUrl || '',
      profileUpdatedAt: db.serverDate(),
    },
  });
  const final = await db.collection('users').doc(openid).get();
  return { success: true, profile: final.data };
}

// ── 通过6位ID查找用户（不添加好友）────────────────────────
async function lookupUserByCode(code) {
  if (!code) return { error: 'no_code' };
  const r = await db.collection('users').where({ customId: String(code) }).get();
  if (r.data.length === 0) return { error: 'code_not_found' };
  const u = r.data[0];
  return { user: { openid: u.openid, customId: u.customId, displayName: u.displayName, avatarUrl: u.avatarUrl || '' } };
}

// ── 通过6位ID添加好友 ─────────────────────────────────────
async function addFriendByCode(myOpenid, code) {
  if (!code) return { error: 'no_code' };

  const r = await db.collection('users').where({ customId: String(code) }).get();
  if (r.data.length === 0) return { error: 'code_not_found' };

  const target = r.data[0];
  if (target.openid === myOpenid) return { error: 'self_friend' };

  const already = await areFriends(myOpenid, target.openid);
  if (already) return { error: 'already_friends', friend: target };

  const now = db.serverDate();
  await Promise.all([
    db.collection('friends').add({ data: { userId: myOpenid,       friendId: target.openid, createTime: now } }),
    db.collection('friends').add({ data: { userId: target.openid,  friendId: myOpenid,      createTime: now } }),
  ]);
  return { success: true, friend: target };
}

// ── 获取好友列表 ────────────────────────────────────────────
async function getFriends(openid) {
  try {
    const r = await db.collection('friends').where({ userId: openid }).get();
    const friendIds = r.data.map(f => f.friendId);
    if (friendIds.length === 0) return { friends: [] };

    let profiles = await Promise.all(
      friendIds.map(id =>
        db.collection('users').doc(id).get().then(x => x.data).catch(() => null)
      )
    );
    profiles = profiles.filter(Boolean);
    profiles = await resolveTempUrls(profiles, 'avatarUrl');
    return { friends: profiles };
  } catch (e) {
    console.error('getFriends error:', e);
    return { friends: [] };
  }
}

// ── 好友列表（附带各自分享的习惯颜色点）──────────────────────
async function getFriendsWithHabits(myOpenid) {
  const db = cloud.database();
  const _ = db.command;

  // 1. 获取好友列表
  const friendsRes = await db.collection('friends')
    .where(_.or([
      { openidA: myOpenid },
      { openidB: myOpenid }
    ]))
    .get();

  const friendIds = friendsRes.data.map(f => 
    f.openidA === myOpenid ? f.openidB : f.openidA
  );
  if (friendIds.length === 0) return [];

  // 2. 获取今天的日期字符串
  const today = new Date().toISOString().split('T')[0];

  // 3. 获取好友的分享习惯（对我可见的）
  const habitsRes = await db.collection('habits')
    .where({
      openid: _.in(friendIds),
      shareWith: _.elemMatch({ openid: myOpenid })
    })
    .get();

  // 4. 获取好友今天的打卡记录
  const checkinsRes = await db.collection('checkins')
    .where({
      openid: _.in(friendIds),
      date: today
    })
    .get();

  // 5. 按好友分组，生成 habitDots
  const habitsByFriend = {};
  habitsRes.data.forEach(h => {
    if (!habitsByFriend[h.openid]) habitsByFriend[h.openid] = [];
    habitsByFriend[h.openid].push(h);
  });

  const checkedHabitIds = new Set(checkinsRes.data.map(c => c.habitId));

  // 6. 组装好友数据，生成 habitDots
  const friendsData = [];
  for (const friendId of friendIds) {
    const habits = habitsByFriend[friendId] || [];
    // 只保留今天有打卡的习惯，生成小点
    const habitDots = habits
      .filter(h => checkedHabitIds.has(h._id))
      .map(h => ({ color: h.color }));

    friendsData.push({
      openid: friendId,
      displayName: '', // 从用户表补充
      avatarUrl: '',   // 从用户表补充
      color: '#ccc',   // 从用户表补充
      initial: '',     // 从用户表补充
      habitDots: habitDots // 🔴 关键：小点数据
    });
  }

  return friendsData;
}

// ── 删除好友 ────────────────────────────────────────────────
async function removeFriend(myOpenid, friendOpenid) {
  const [q1, q2] = await Promise.all([
    db.collection('friends').where({ userId: myOpenid,      friendId: friendOpenid }).get(),
    db.collection('friends').where({ userId: friendOpenid,  friendId: myOpenid     }).get(),
  ]);
  const records = [...q1.data, ...q2.data];
  if (records.length === 0) return { error: 'not_friends' };
  await Promise.all(records.map(rec => db.collection('friends').doc(rec._id).remove()));
  return { success: true };
}

// ── 同步本地勋章到云端 ────────────────────────────────────────
async function updateBadges(openid, earnedBadges) {
  if (!Array.isArray(earnedBadges)) return { error: 'invalid' };
  try {
    await db.collection('users').doc(openid).update({
      data: { earnedBadges: earnedBadges.slice(0, 50) },
    });
    return { success: true };
  } catch (e) {
    return { error: 'failed' };
  }
}

// ── 切换勋章展示 ─────────────────────────────────────────────
async function updateShowBadge(openid, showBadge) {
  let existing = {};
  try {
    const r = await db.collection('users').doc(openid).get();
    existing = r.data || {};
  } catch (e) {}
  // Remove system fields that can't be set
  const { _id, _openid, ...rest } = existing;
  await db.collection('users').doc(openid).set({
    data: { ...rest, openid, showBadge: !!showBadge },
  });
  return { success: true };
}

// ── 获取好友公开的习惯和今日打卡 ─────────────────────────────
async function getFriendHabits(myOpenid, friendOpenid) {
  const isFriend = await areFriends(myOpenid, friendOpenid);
  if (!isFriend) return { error: 'not_friends' };

  let profile = null;
  try {
    const r = await db.collection('users').doc(friendOpenid).get();
    profile = r.data;
    if (profile) {
      [profile] = await resolveTempUrls([profile], 'avatarUrl');
    }
  } catch (e) {}

  const habitsRes = await db.collection('habits').where({
    _openid: friendOpenid,
    isActive: true,
    visibility: 'friends',
  }).get();

  const visibleHabits = habitsRes.data.filter(h => {
    const ids = h.sharedFriendIds || [];
    return ids.includes('*') || ids.includes(myOpenid);
  });

  if (visibleHabits.length === 0) return { profile, habits: [], checkins: [], totalCheckins: 0 };

  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const habitIds = visibleHabits.map(h => h._id);

  const sevenDaysAgo = new Date(d.getTime() - 6 * 24 * 60 * 60 * 1000);
  const cutoff = `${sevenDaysAgo.getFullYear()}-${String(sevenDaysAgo.getMonth()+1).padStart(2,'0')}-${String(sevenDaysAgo.getDate()).padStart(2,'0')}`;

  const [checkinsRes, allCheckinsRes, recentCheckinsRes] = await Promise.all([
    db.collection('checkins').where({ _openid: friendOpenid, date: today, habitId: _.in(habitIds) }).limit(50).get(),
    db.collection('checkins').where({ _openid: friendOpenid, habitId: _.in(habitIds) }).limit(1000).get(),
    db.collection('checkins').where({ _openid: friendOpenid, habitId: _.in(habitIds), date: _.gte(cutoff) }).limit(100).get(),
  ]);

  const totalDaysMap = {};
  let totalCheckins = 0;
  allCheckinsRes.data.forEach(c => {
    totalDaysMap[c.habitId] = (totalDaysMap[c.habitId] || 0) + 1;
    totalCheckins++;
  });

  const photosByHabit = {};
  recentCheckinsRes.data.forEach(c => {
    if (c.photos && c.photos.length > 0) {
      if (!photosByHabit[c.habitId]) photosByHabit[c.habitId] = [];
      c.photos.forEach(p => {
          // 优先使用用户打卡时存储的当地时间字符串，完美解决时区问题
          let timeStr = c.localTimeStr ? c.localTimeStr.split(' ')[1] : '';
          // 没有localTimeStr的旧数据用原来的逻辑
          if (!timeStr) {
            const raw = c.createdAt;
            const checkinTsObj = raw instanceof Date ? raw : (raw && raw.$date ? new Date(raw.$date) : null);
            timeStr = checkinTsObj ? `${String(checkinTsObj.getHours()).padStart(2,'0')}:${String(checkinTsObj.getMinutes()).padStart(2,'0')}` : '';
          }
          let url = p;
          // 照片的shootTime优先级最高
          if (typeof p === 'object' && p.url) {
            url = p.url;
            if (p.shootTime) {
              const shootTs = new Date(p.shootTime);
              timeStr = `${String(shootTs.getHours()).padStart(2,'0')}:${String(shootTs.getMinutes()).padStart(2,'0')}`;
            }
          }
          photosByHabit[c.habitId].push({ url, date: c.date, timeStr, note: c.note || '' });
        });
    }
  });

  // Collect all photo fileIDs across all habits, resolve in one batch call
  const allPhotoIds = [
    ...new Set(
      visibleHabits.flatMap(h => h.sharePhotos ? (photosByHabit[h._id] || []) : [])
        .map(p => p.url)
        .filter(u => u && u.startsWith('cloud://'))
    ),
  ];
  let photoUrlMap = {};
  if (allPhotoIds.length > 0) {
    try {
      const res = await cloud.getTempFileURL({ fileList: allPhotoIds });
      (res.fileList || []).forEach(f => { if (f.tempFileURL) photoUrlMap[f.fileID] = f.tempFileURL; });
    } catch (e) {}
  }

  return {
    profile,
    totalCheckins,
    habits: visibleHabits.map(h => {
      const raw = h.sharePhotos ? (photosByHabit[h._id] || []) : [];
      const sorted = raw.slice().sort((a, b) => b.date < a.date ? -1 : b.date > a.date ? 1 : 0);
      return {
        ...h,
        totalDays: totalDaysMap[h._id] || 0,
        recentPhotos: sorted.map(p => ({ url: photoUrlMap[p.url] || p.url, date: p.date, timeStr: p.timeStr || '', note: p.note || '' })),
      };
    }),
    checkins: checkinsRes.data,
  };
}

// ── 获取两人之间的对话 ────────────────────────────────────────
async function getConversation(myOpenid, friendOpenid) {
  if (!friendOpenid) return { messages: [] };
  try {
    const [q1, q2] = await Promise.all([
      db.collection('notifications').where({ fromOpenid: myOpenid, toOpenid: friendOpenid }).limit(50).get(),
      db.collection('notifications').where({ fromOpenid: friendOpenid, toOpenid: myOpenid }).limit(50).get(),
    ]);
    let all = [...(q1.data || []), ...(q2.data || [])];
    const ts = d => {
      if (!d) return 0;
      if (d instanceof Date) return d.getTime();
      if (d.$date != null) return new Date(d.$date).getTime();
      return Number(d) || 0;
    };
    all.sort((a, b) => ts(a.createdAt) - ts(b.createdAt));

    // 自动加载所有引用的消息内容
    const quoteIds = all.map(m => m.quoteId).filter(Boolean);
    const quoteMap = {};
    if (quoteIds.length > 0) {
      const qRes = await db.collection('notifications').where({ _id: _.in(quoteIds) }).get();
      qRes.data.forEach(q => {
        quoteMap[q._id] = {
          text: q.text || q.tipText || '（消息已删除）',
          fromName: q.fromName || '好友'
        };
      });
    }

    // 给每条消息附加引用内容
    const messages = all.map(m => ({
      ...m,
      isMine: m.fromOpenid === myOpenid,
      quote: quoteMap[m.quoteId] || null
    }));

    const resolved = await resolveTempUrls(messages, 'imageUrl');
    return { messages: resolved };
  } catch (e) {
    return { messages: [] };
  }
}

// ── 点赞通知 ─────────────────────────────────────────────────
async function sendLike(fromOpenid, targetOpenid) {
  if (!targetOpenid || fromOpenid === targetOpenid) return { error: 'invalid' };
  const isFriend = await areFriends(fromOpenid, targetOpenid);
  if (!isFriend) return { error: 'not_friends' };
  const todayStr = _todayStr();
  // Enforce one like per day per sender
  const existing = await db.collection('notifications')
    .where({ fromOpenid, toOpenid: targetOpenid, type: 'like', date: todayStr })
    .limit(1).get();
  if (existing.data && existing.data.length > 0) return { error: 'already_liked_today' };
  let fromProfile = {};
  try { fromProfile = (await db.collection('users').doc(fromOpenid).get()).data || {}; } catch (e) {}
  try { await db.createCollection('notifications'); } catch (e) {}
  await db.collection('notifications').add({
    data: {
      _openid: targetOpenid,
      toOpenid: targetOpenid,
      fromOpenid,
      fromName: fromProfile.displayName || '好友',
      fromAvatar: fromProfile.avatarUrl || '',
      type: 'like',
      date: todayStr,
      text: '',
      read: false,
      createdAt: db.serverDate(),
    },
  });
  return { success: true };
}

// ── 评论通知 ─────────────────────────────────────────────────
async function sendComment(fromOpenid, targetOpenid, text, imageUrl, quoteText) {
  if (!targetOpenid || fromOpenid === targetOpenid) return { error: 'invalid' };
  const hasText = text && String(text).trim();
  const hasImg  = imageUrl && String(imageUrl).trim();
  if (!hasText && !hasImg) return { error: 'invalid' };
  const isFriend = await areFriends(fromOpenid, targetOpenid);
  if (!isFriend) return { error: 'not_friends' };
  let fromProfile = {};
  try { fromProfile = (await db.collection('users').doc(fromOpenid).get()).data || {}; } catch (e) {}
  try { await db.createCollection('notifications'); } catch (e) {}
  await db.collection('notifications').add({
    data: {
      _openid: targetOpenid,
      toOpenid: targetOpenid,
      fromOpenid,
      fromName: fromProfile.displayName || '好友',
      fromAvatar: fromProfile.avatarUrl || '',
      type: 'comment',
      text: hasText ? String(text).slice(0, 200) : '',
      imageUrl: hasImg ? String(imageUrl) : '',
      quoteText: quoteText ? String(quoteText).slice(0, 100) : '',
      read: false,
      createdAt: db.serverDate(),
    },
  });
  return { success: true };
}

// ── 查询是否已点赞 ────────────────────────────────────────────
async function getLikeStatus(myOpenid, targetOpenid) {
  if (!targetOpenid) return { liked: false, likeCount: 0 };
  try {
    // 查总点赞数
    const countRes = await db.collection('notifications')
      .where({ toOpenid: targetOpenid, type: 'like' })
      .count();
    const likeCount = countRes.total || 0;

    // 查当前用户今天是否已点过赞（每日重置）
    const todayStr = _todayStr();
    const r = await db.collection('notifications')
      .where({ fromOpenid: myOpenid, toOpenid: targetOpenid, type: 'like', date: todayStr })
      .limit(1).get();
    return { liked: r.data.length > 0, likeCount };
  } catch (e) {
    return { liked: false, likeCount: 0 };
  }
}

// ── 取消点赞 ─────────────────────────────────────────────────
async function unlike(myOpenid, targetOpenid) {
  if (!targetOpenid) return { error: 'invalid' };
  try {
    const r = await db.collection('notifications')
      .where({ fromOpenid: myOpenid, toOpenid: targetOpenid, type: 'like' })
      .get();
    await Promise.all(
      (r.data || []).map(n => db.collection('notifications').doc(n._id).remove().catch(() => {}))
    );
    return { success: true };
  } catch (e) {
    return { error: 'failed' };
  }
}

// ── 删除通知（收件人操作） ────────────────────────────────────
async function deleteNotification(openid, notificationId) {
  if (!notificationId) return { error: 'invalid' };
  try {
    const r = await db.collection('notifications').doc(notificationId).get();
    if (!r.data || (r.data.toOpenid !== openid && r.data.fromOpenid !== openid)) return { error: 'forbidden' };
    await db.collection('notifications').doc(notificationId).remove();
    return { success: true };
  } catch (e) {
    return { error: 'failed' };
  }
}

// ── 获取我的通知 ─────────────────────────────────────────────
async function getMyNotifications(openid) {
  try { await db.createCollection('notifications'); } catch (e) {}
  // Purge notifications older than 7 days
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  try {
    const old = await db.collection('notifications')
      .where({ toOpenid: openid, createdAt: _.lt(cutoff) })
      .limit(50).get();
    if (old.data && old.data.length > 0) {
      await Promise.all(old.data.map(n =>
        db.collection('notifications').doc(n._id).remove().catch(() => {})
      ));
    }
  } catch (e) {}
  try {
    const r = await db.collection('notifications')
      .where({ toOpenid: openid })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    let notifications = r.data || [];
    // Freshen sender name + avatar with current profile data
    const senderIds = [...new Set(notifications.map(n => n.fromOpenid).filter(Boolean))];
    if (senderIds.length > 0) {
      const profiles = await Promise.all(
        senderIds.map(id => db.collection('users').doc(id).get().then(x => x.data).catch(() => null))
      );
      const pm = {};
      profiles.forEach((p, i) => { if (p) pm[senderIds[i]] = p; });
      notifications = notifications.map(n => {
        const p = pm[n.fromOpenid];
        if (!p) return n;
        return { ...n, fromName: p.displayName || n.fromName, fromAvatar: p.avatarUrl || n.fromAvatar };
      });
    }
    notifications = await resolveTempUrls(notifications, 'fromAvatar');
    notifications = await resolveTempUrls(notifications, 'imageUrl');
    return { notifications };
  } catch (e) {
    return { notifications: [] };
  }
}

// ── 获取我发出的消息 ─────────────────────────────────────────
async function getSentNotifications(openid) {
  try {
    const r = await db.collection('notifications')
      .where({ fromOpenid: openid })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    return { notifications: r.data || [] };
  } catch (e) {
    return { notifications: [] };
  }
}

// ── 标记所有通知为已读 ────────────────────────────────────────
async function markNotificationsRead(openid) {
  try {
    const r = await db.collection('notifications')
      .where({ toOpenid: openid, read: false })
      .limit(50)
      .get();
    await Promise.all(
      (r.data || []).map(n =>
        db.collection('notifications').doc(n._id).update({ data: { read: true } }).catch(() => {})
      )
    );
    return { success: true };
  } catch (e) {
    return { success: false };
  }
}

// ── 获取未读数量 ─────────────────────────────────────────────
async function getUnreadCount(openid) {
  try {
    const r = await db.collection('notifications')
      .where({ toOpenid: openid, read: false })
      .count();
    return { count: r.total || 0 };
  } catch (e) {
    return { count: 0 };
  }
}

// ── 发送打卡提醒（subscription msg + 通知留言） ───────────────
const REMINDER_TEMPLATE_ID = 'rGCBioESxOPquFSmQyzwwavqtKQAJiJBRyrysC99zpM';

async function sendReminder(fromOpenid, targetOpenid, habitName, tipText) {
  if (!targetOpenid || !habitName || fromOpenid === targetOpenid) return { error: 'invalid' };
  const isFriend = await areFriends(fromOpenid, targetOpenid);
  if (!isFriend) return { error: 'not_friends' };

  let fromProfile = {};
  try { fromProfile = (await db.collection('users').doc(fromOpenid).get()).data || {}; } catch (e) {}
  let toProfile = {};
  try { toProfile = (await db.collection('users').doc(targetOpenid).get()).data || {}; } catch (e) {}

  const fromName = fromProfile.displayName || '好友';
  const toName   = toProfile.displayName   || '好友';
  const tip = tipText ? String(tipText).slice(0, 20) : '提醒你今天记得打卡';

  // Send WeChat subscription message (may fail if user hasn't subscribed — that's OK)
  try {
    await cloud.openapi.subscribeMessage.send({
      touser: targetOpenid,
      template_id: REMINDER_TEMPLATE_ID,
      page: 'pages/social/index',
      data: {
        thing2: { value: fromName.slice(0, 20) },
        thing1: { value: String(habitName).slice(0, 20) },
        thing4: { value: tip },
      },
    });
  } catch (e) {}

  try { await db.createCollection('notifications'); } catch (e) {}
  const baseData = {
    fromOpenid,
    fromName,
    fromAvatar: fromProfile.avatarUrl || '',
    type: 'reminder',
    habitName: String(habitName),
    tipText: tipText ? String(tipText).slice(0, 20) : '',
    text: '',
    read: false,
    createdAt: db.serverDate(),
  };

  // Notification to the recipient (shows in their 好友互动)
  await db.collection('notifications').add({
    data: { ...baseData, _openid: targetOpenid, toOpenid: targetOpenid },
  });

  // Notification to the sender themselves (shows in their own 好友互动 as "sent")
  // read: true so this does NOT create a badge on the sender's side
  await db.collection('notifications').add({
    data: {
      ...baseData,
      _openid: fromOpenid,
      toOpenid: fromOpenid,
      type: 'reminder_sent',
      targetOpenid,
      targetName: toName,
      read: true,
    },
  });

  return { success: true };
}

// ── 批量获取好友今日进度 ────────────────────────────────────
// Reads progressMap[today] from each friend's profile document.
// No entry for today → { done: 0, total: 0 } (natural daily reset via date isolation).
async function getFriendsProgress(myOpenid) {
  const { friends } = await getFriends(myOpenid);
  if (!friends || friends.length === 0) return { friends: [], date: _today() };
  const todayKey = _today();
  await db.collection('notifications')
    .where({
      fromOpenid: myOpenid,
      type: 'like'
    })
    .remove()
    .catch(() => {});
  return {
    date: todayKey,
    friends: friends.map(f => {
      const p = ((f.progressMap || {})[todayKey]) || { done: 0, total: 0 };
      return { openid: f.openid, done: p.done || 0, total: p.total || 0 };
    }),
  };
}

function _today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── 保存个人备注 ─────────────────────────────────────────────
async function updateNote(openid, note) {
  try {
    await db.collection('users').doc(openid).update({ data: { note: note || '' } });
    return { success: true };
  } catch (e) {
    return { error: 'failed' };
  }
}

// ── 种下测试好友数据 ─────────────────────────────────────────
async function seedFakeData(myOpenid) {
  // Ensure all collections exist before any reads/writes
  await Promise.all([
    db.createCollection('users').catch(() => {}),
    db.createCollection('habits').catch(() => {}),
    db.createCollection('checkins').catch(() => {}),
    db.createCollection('friends').catch(() => {}),
    db.createCollection('notifications').catch(() => {}),
  ]);

  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  const fakeUsers = [
    { _id: 'fake_u01', openid: 'fake_u01', displayName: '小明', customId: '100001', showBadge: true,
      earnedBadges: [
        { id: 'first_checkin', icon: '🌟', name: '萌新启航' },
        { id: 'streak_7',      icon: '🏅', name: '周常达人' },
        { id: 'streak_30',     icon: '🏆', name: '全勤无休' },
      ],
    },
    { _id: 'fake_u02', openid: 'fake_u02', displayName: '晓华', customId: '100002', showBadge: true,
      earnedBadges: [
        { id: 'first_checkin', icon: '🌟', name: '萌新启航' },
        { id: 'streak_3',      icon: '🌱', name: '习惯萌芽' },
      ],
    },
    { _id: 'fake_u03', openid: 'fake_u03', displayName: '大壮', customId: '100003', showBadge: true,
      earnedBadges: [
        { id: 'first_checkin', icon: '🌟', name: '萌新启航' },
        { id: 'streak_7',      icon: '🏅', name: '周常达人' },
        { id: 'streak_90',     icon: '🌲', name: '季度常青树' },
        { id: 'streak_30',     icon: '🏆', name: '全勤无休' },
      ],
    },
    { _id: 'fake_u_y',  openid: 'fake_u_y',  displayName: 'y',   customId: '100004', showBadge: false },
  ];
  const fakeHabits = [
    { _id: 'fh01', _openid: 'fake_u01', name: '每日跑步',   icon: '🏃', color: '#45C5A0', frequency: { type: 'daily' }, isActive: true, visibility: 'friends', sharedFriendIds: ['*'], sharePhotos: false, createdAt: new Date() },
    { _id: 'fh02', _openid: 'fake_u01', name: '读书30分钟', icon: '📚', color: '#9B51E0', frequency: { type: 'daily' }, isActive: true, visibility: 'friends', sharedFriendIds: ['*'], sharePhotos: false, createdAt: new Date() },
    { _id: 'fh03', _openid: 'fake_u02', name: '冥想',       icon: '🧘', color: '#F7971E', frequency: { type: 'daily' }, isActive: true, visibility: 'friends', sharedFriendIds: ['*'], sharePhotos: false, createdAt: new Date() },
    { _id: 'fh04', _openid: 'fake_u02', name: '喝水 2L',   icon: '💧', color: '#56CCF2', frequency: { type: 'weekly', days: [1,2,3,4,5] }, isActive: true, visibility: 'friends', sharedFriendIds: ['*'], sharePhotos: false, createdAt: new Date() },
    { _id: 'fh05', _openid: 'fake_u03', name: '健身',       icon: '💪', color: '#EB5757', frequency: { type: 'weekly', days: [1,3,5] }, isActive: true, visibility: 'friends', sharedFriendIds: ['*'], sharePhotos: false, createdAt: new Date() },
    { _id: 'fh06', _openid: 'fake_u03', name: '早起',       icon: '🌞', color: '#F2994A', frequency: { type: 'daily' }, isActive: true, visibility: 'friends', sharedFriendIds: ['*'], sharePhotos: false, createdAt: new Date() },
    { _id: 'fh_y1', _openid: 'fake_u_y', name: '学习',     icon: '📖', color: '#9B51E0', frequency: { type: 'daily' }, isActive: true, visibility: 'friends', sharedFriendIds: ['*'], sharePhotos: false, createdAt: new Date() },
    { _id: 'fh_y2', _openid: 'fake_u_y', name: '喝水',     icon: '💧', color: '#56CCF2', frequency: { type: 'daily' }, isActive: true, visibility: 'friends', sharedFriendIds: ['*'], sharePhotos: false, createdAt: new Date() },
  ];
  // Generate past checkins for streak/badge computation
  const pastCheckins = [];
  const genPast = (id, openid, habitId, daysBack) => {
    for (let i = 1; i <= daysBack; i++) {
      const pd = new Date(d.getTime() - i * 24 * 60 * 60 * 1000);
      const ds = `${pd.getFullYear()}-${String(pd.getMonth()+1).padStart(2,'0')}-${String(pd.getDate()).padStart(2,'0')}`;
      pastCheckins.push({ _id: `${id}_p${i}`, _openid: openid, habitId, date: ds, duration: 0, createdAt: new Date() });
    }
  };
  genPast('fc01', 'fake_u01', 'fh01', 5);
  genPast('fc02', 'fake_u01', 'fh02', 5);
  genPast('fc03', 'fake_u02', 'fh03', 5);
  genPast('fc06', 'fake_u03', 'fh06', 5);
  genPast('fcy1', 'fake_u_y', 'fh_y1', 20);
  genPast('fcy2', 'fake_u_y', 'fh_y2', 20);

  const fakeCheckins = [
    { _id: 'fc01',  _openid: 'fake_u01', habitId: 'fh01',  date: today, duration: 30, createdAt: new Date() },
    { _id: 'fc03',  _openid: 'fake_u02', habitId: 'fh03',  date: today, duration: 15, createdAt: new Date() },
    { _id: 'fc04',  _openid: 'fake_u02', habitId: 'fh04',  date: today, duration: 0,  createdAt: new Date() },
    { _id: 'fc05',  _openid: 'fake_u03', habitId: 'fh05',  date: today, duration: 45, createdAt: new Date() },
    { _id: 'fcy1t', _openid: 'fake_u_y', habitId: 'fh_y1', date: today, duration: 0,  createdAt: new Date() },
    { _id: 'fcy2t', _openid: 'fake_u_y', habitId: 'fh_y2', date: today, duration: 0,  createdAt: new Date() },
    ...pastCheckins,
  ];

  // Users and habits in parallel (small count); strip _id from data payload
  await Promise.all([
    ...fakeUsers.map(({ _id, ...u })          => db.collection('users').doc(_id).set({ data: u })),
    ...fakeHabits.map(({ _id, ...h })         => db.collection('habits').doc(_id).set({ data: h })),
  ]);

  // Checkins in sequential batches of 20 to avoid timeout; strip _id from data payload
  const BATCH = 20;
  for (let i = 0; i < fakeCheckins.length; i += BATCH) {
    await Promise.all(
      fakeCheckins.slice(i, i + BATCH).map(({ _id, ...c }) =>
        db.collection('checkins').doc(_id).set({ data: c }).catch(() => {})
      )
    );
  }

  const now = db.serverDate();
  for (const fu of fakeUsers) {
    const already = await areFriends(myOpenid, fu.openid);
    if (!already) {
      await Promise.all([
        db.collection('friends').add({ data: { userId: myOpenid,  friendId: fu.openid, createTime: now } }),
        db.collection('friends').add({ data: { userId: fu.openid, friendId: myOpenid,  createTime: now } }),
      ]);
    }
  }
  return { success: true };
}
