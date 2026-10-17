const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { habitId, days = 30 } = event;

  const today = new Date();
  const dates = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    );
  }

  const [habitRes, checkinRes] = await Promise.all([
    db.collection('habits').doc(habitId).get(),
    db.collection('checkins').where({
      _openid: OPENID,
      habitId,
      date: _.in(dates),
    }).get(),
  ]);

  const habit = habitRes.data;
  const checkins = checkinRes.data;
  const checkinDates = new Set(checkins.map(c => c.date));

  // 计算 streak
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const day = d.getDay();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const isDue = habit.frequency.type === 'daily' || habit.frequency.days.includes(day);
    if (!isDue) continue;
    if (checkinDates.has(dateStr)) streak++;
    else break;
  }

  return { streak, totalCheckins: checkins.length, checkinDates: [...checkinDates] };
};
