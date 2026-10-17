const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d1gk8zc6k0a6f1728' });

const db = cloud.database();
const https = require('https');

// Reminder template: 打卡内容(thing6), 打卡时间(date2)
const REMINDER_TEMPLATE_ID   = 'ZWD5t9gkBBHYmYN1luBC3PyLswOaYFRdSgg-bJCkeZw';
// Timer done template: 习惯名(phrase3), 时长(time1)
const TIMER_DONE_TEMPLATE_ID = 'ajelop-5tQ0VP2N3dHtpAH2CXNHpY0Q0vXRcU1MaBmg';

// In-memory token cache (persists across warm instances)
let _token = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const appid = process.env.WX_APPID || 'wxa06f555ec5612bec';
  const secret = process.env.WX_APPSECRET;
  if (!secret) throw new Error('WX_APPSECRET env var not set');
  return new Promise((resolve, reject) => {
    https.get(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`,
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.access_token) {
              _token = json.access_token;
              _tokenExpiry = Date.now() + (json.expires_in - 300) * 1000;
              resolve(json.access_token);
            } else {
              reject(new Error(JSON.stringify(json)));
            }
          } catch (e) { reject(e); }
        });
      }
    ).on('error', reject);
  });
}

async function sendSubMsgHttp(token, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.weixin.qq.com',
      path: `/cgi-bin/message/subscribe/send?access_token=${token}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.main = async (event, context) => {
  const now = new Date();
  // 云函数运行在 UTC+0，需转换为 UTC+8
  const cst = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const hh = String(cst.getUTCHours()).padStart(2, '0');
  const mm = String(cst.getUTCMinutes()).padStart(2, '0');
  const currentTime = `${hh}:${mm}`;

  // 一次性清理：把所有 isActive=false 的习惯的 reminder.enabled 设为 false
  // 在云函数控制台手动触发一次即可
  if (event.action === 'fixStaleReminders') {
    try {
      const res = await db.collection('habits')
        .where({ 'reminder.enabled': true, isActive: db.command.neq(true) })
        .limit(100)
        .get();
      const stale = res.data || [];
      await Promise.all(
        stale.map(h =>
          db.collection('habits').doc(h._id)
            .update({ data: { 'reminder.enabled': false } })
            .catch(() => {})
        )
      );
      return { fixed: stale.length, ids: stale.map(h => h._id) };
    } catch (e) {
      return { error: e.message };
    }
  }

  // 记录用户授权订阅消息到用户记录
  if (event.action === 'recordTimerSub') {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) return { error: 'no openid' };
    try {
      await db.collection('users').doc(OPENID).update({
        data: { timerSubEnabled: true, timerSubUpdatedAt: new Date() },
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.errMsg || e.message };
    }
  }

  // 倒计时开始时预约通知（存入 timerSchedules 集合）
  if (event.action === 'scheduleTimerDone') {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) return { error: 'no openid' };
    const { endTimestamp, habitId, habitName, color, duration } = event;
    if (!endTimestamp) return { error: 'endTimestamp required' };
    try {
      try { await db.createCollection('timerSchedules'); } catch (e) {}
      await db.collection('timerSchedules').where({ openid: OPENID }).remove().catch(() => {});
      await db.collection('timerSchedules').add({
        data: {
          openid: OPENID,
          endTimestamp: Number(endTimestamp),
          habitId: habitId || '',
          habitName: habitName || '',
          color: color || '#45C5A0',
          duration: Number(duration) || 0,
          createdAt: new Date(),
        },
      });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.errMsg || e.message };
    }
  }

  // 取消当前用户所有预约通知
  if (event.action === 'cancelTimerSchedule') {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) return { error: 'no openid' };
    try {
      await db.collection('timerSchedules').where({ openid: OPENID }).remove().catch(() => {});
      return { success: true };
    } catch (e) {
      return { success: false, error: e.errMsg || e.message };
    }
  }

  // 取消指定习惯的预约通知（删除习惯时调用）
  if (event.action === 'cancelTimerScheduleByHabit') {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) return { error: 'no openid' };
    const { habitId } = event;
    try {
      await db.collection('timerSchedules')
        .where({ openid: OPENID, habitId: habitId || '' })
        .remove()
        .catch(() => {});
      return { success: true };
    } catch (e) {
      return { success: false, error: e.errMsg || e.message };
    }
  }

  // 倒计时完成通知（端上 app 在前台时直接发送，有小程序上下文，用 cloud.openapi）
  if (event.action === 'sendTimerDone') {
    const { OPENID } = cloud.getWXContext();
    if (!OPENID) return { error: 'no openid' };
    const habitName = (event.habitName || '打卡').slice(0, 5);
    const dur = Number(event.duration) || 0;
    const durStr = `${String(dur).padStart(2, '0')}:00`;
    try {
      const sendPayload = {
        touser: OPENID,
        templateId: TIMER_DONE_TEMPLATE_ID,
        page: `pages/habit-checkin/index?habitId=${event.habitId}&color=${encodeURIComponent(event.color || '#45C5A0')}`,
        miniprogramState: 'trial',
        data: {
          phrase3: { value: habitName },
          time1:   { value: durStr },
        },
      };
      console.log('[sendTimerDone] payload:', JSON.stringify(sendPayload));
      await cloud.openapi.subscribeMessage.send(sendPayload);
      console.log('[sendTimerDone] success');
      return { success: true };
    } catch (e) {
      console.error('[sendTimerDone] failed:', e.errMsg || e.message, JSON.stringify(e));
      return { success: false, error: e.errMsg || e.message };
    }
  }

  // Cron：发送超时的倒计时通知（用 HTTP API，无小程序上下文）
  try {
    try { await db.createCollection('timerSchedules'); } catch (e) {}
    const overdueRes = await db.collection('timerSchedules')
      .where({ endTimestamp: db.command.lte(now.getTime()) })
      .limit(20)
      .get();
    const overdue = overdueRes.data || [];
    if (overdue.length > 0) {
      // 并行校验习惯是否仍然有效，无效则直接清除不发通知
      const habitChecks = await Promise.all(
        overdue.map(s =>
          s.habitId
            ? db.collection('habits').doc(s.habitId).get()
                .then(r => r.data && r.data.isActive !== false)
                .catch(() => true) // 查不到就发（宁可多发）
            : Promise.resolve(true)
        )
      );
      const validSchedules = overdue.filter((_, i) => habitChecks[i]);
      const staleSchedules = overdue.filter((_, i) => !habitChecks[i]);

      // 清理已删除习惯的 timerSchedules
      await Promise.all(
        staleSchedules.map(s => db.collection('timerSchedules').doc(s._id).remove().catch(() => {}))
      );
      console.log('[cron-timer] valid:', validSchedules.length, 'stale cleaned:', staleSchedules.length);

      if (validSchedules.length > 0) {
        let token;
        try { token = await getAccessToken(); } catch (e) { console.error('[cron-timer] get token failed:', e.message); }
        await Promise.all(
          validSchedules.map(async schedule => {
            const schedHabitName = (schedule.habitName || '打卡').slice(0, 5);
            const schedDurStr = `${String(Number(schedule.duration) || 0).padStart(2, '0')}:00`;
            if (token) {
              try {
                const r = await sendSubMsgHttp(token, {
                  touser: schedule.openid,
                  template_id: TIMER_DONE_TEMPLATE_ID,
                  page: `pages/habit-checkin/index?habitId=${schedule.habitId}&color=${encodeURIComponent(schedule.color || '#45C5A0')}`,
                  miniprogram_state: 'trial',
                  data: {
                    phrase3: { value: schedHabitName },
                    time1:   { value: schedDurStr },
                  },
                });
                console.log('[cron-timer] sent', schedule.habitId, JSON.stringify(r));
              } catch (e) { console.error('[cron-timer] send err:', e.message); }
            }
            await db.collection('timerSchedules').doc(schedule._id).remove().catch(() => {});
          })
        );
      }
    }
  } catch (e) { console.error('[cron-timer] outer err:', e.message); }

  // Cron：发送打卡提醒（用 HTTP API）
  // DB 侧直接过滤当前时间，避免拉全量再内存筛选
  const habitsRes = await db.collection('habits')
    .where({ 'reminder.enabled': true, isActive: true, 'reminder.times': currentTime })
    .limit(50)
    .get();

  const matched = (habitsRes.data || []).filter(h => h._openid);

  if (matched.length === 0) {
    return { currentTime, checked: 0, matched: 0, sent: 0, results: [] };
  }

  const d = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const todayStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  const dateTimeStr = `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${currentTime}`;

  // 并行查每个习惯今日打卡数
  const checkinCounts = await Promise.all(
    matched.map(h => {
      const threshold = (h.reminder && h.reminder.skipThreshold != null) ? h.reminder.skipThreshold : 1;
      if (threshold <= 0) return Promise.resolve(0);
      return db.collection('checkins')
        .where({ habitId: h._id, _openid: h._openid, date: todayStr })
        .count()
        .then(r => r.total || 0)
        .catch(() => 0);
    })
  );

  // 过滤掉已达打卡阈值的
  const toSend = matched.filter((h, i) => {
    const threshold = (h.reminder && h.reminder.skipThreshold != null) ? h.reminder.skipThreshold : 1;
    return threshold <= 0 || checkinCounts[i] < threshold;
  });

  if (toSend.length === 0) {
    return { currentTime, checked: matched.length, matched: matched.length, sent: 0, skipped: matched.length, results: [] };
  }

  let cronToken = null;
  try {
    cronToken = await getAccessToken();
    console.log('[reminder] got token, sending', toSend.length, '/', matched.length);
  } catch (e) {
    console.error('[reminder] get token failed:', e.message);
    return { currentTime, checked: matched.length, matched: toSend.length, sent: 0, error: 'no token' };
  }

  // 并行发送
  const results = await Promise.all(
    toSend.map(async habit => {
      try {
        const r = await sendSubMsgHttp(cronToken, {
          touser: habit._openid,
          template_id: REMINDER_TEMPLATE_ID,
          page: `pages/habit-checkin/index?habitId=${habit._id}&color=${encodeURIComponent(habit.color || '#45C5A0')}`,
          miniprogram_state: 'trial',
          data: {
            thing6: { value: (habit.name || '打卡').slice(0, 20) },
            date2:  { value: dateTimeStr },
          },
        });
        const ok = r.errcode === 0;
        console.log('[reminder]', habit._id, ok ? 'ok' : r.errmsg);
        return { habitId: habit._id, openid: habit._openid, success: ok, error: ok ? undefined : JSON.stringify(r) };
      } catch (e) {
        console.error('[reminder] send failed:', habit._id, e.message);
        return { habitId: habit._id, openid: habit._openid, success: false, error: e.message };
      }
    })
  );

  return {
    currentTime,
    checked: matched.length,
    matched: toSend.length,
    sent: results.filter(r => r.success).length,
    results,
  };
};
