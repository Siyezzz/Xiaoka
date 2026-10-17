const { calcStreak } = require('./db');

const BADGES = [
  { id: 'first_checkin',  icon: '🌟', name: '萌新启航',    desc: '完成第1次打卡' },
  { id: 'streak_3',       icon: '🌱', name: '习惯萌芽',    desc: '连续3天打卡' },
  { id: 'streak_7',       icon: '🏅', name: '周常达人',    desc: '连续7天打卡' },
  { id: 'duration_100',   icon: '⏱', name: '首次破百',    desc: '累计时长≥100分钟' },
  { id: 'single_60',      icon: '🎯', name: '专注王者',    desc: '单次时长≥60分钟' },
  { id: 'streak_30',      icon: '🏆', name: '全勤无休',    desc: '连续30天打卡' },
  { id: 'single_120',     icon: '🔥', name: '双倍专注',    desc: '单次时长≥120分钟' },
  { id: 'streak_90',      icon: '🌲', name: '季度常青树',  desc: '连续90天打卡' },
  { id: 'streak_180',     icon: '🌳', name: '半载常青',    desc: '连续180天打卡' },
  { id: 'total_days_300', icon: '📅', name: '年度习惯大师', desc: '累计打卡天数≥300天' },
  { id: 'duration_500',   icon: '⌛', name: '时光收藏家',  desc: '累计专注时长≥500分钟' },
  { id: 'duration_10000', icon: '🌙', name: '时光肝帝',    desc: '累计时长破万' },
  { id: 'streak_365',     icon: '💎', name: '不忘初心',    desc: '连续一整年打卡' },
  { id: 'year_280',       icon: '✨', name: '人间自律',    desc: '全年打卡满280天' },
];

function getEarnedBadges() {
  const raw = wx.getStorageSync('ht_earned_badges') || [];
  const seen = new Set();
  const deduped = raw.filter(b => {
    if (seen.has(b.id)) return false;
    seen.add(b.id);
    return true;
  });
  if (deduped.length !== raw.length) wx.setStorageSync('ht_earned_badges', deduped);
  return deduped;
}

function saveEarnedBadges(list) {
  wx.setStorageSync('ht_earned_badges', list);
}

function getHabitBadges() {
  const earned = getEarnedBadges();
  return earned
    .map(b => {
      const def = BADGES.find(d => d.id === b.id);
      return def ? { ...def, earnedAt: b.earnedAt, habitName: b.habitName } : null;
    })
    .filter(Boolean);
}

function checkAndAward(habit, checkins, lastDuration) {
  const earned = getEarnedBadges();
  // Key on badge id only — each badge is a global user achievement, not per-habit
  const earnedSet = new Set(earned.map(b => b.id));
  const newBadges = [];

  const award = (badgeId) => {
    const badge = BADGES.find(b => b.id === badgeId);
    if (!badge || earnedSet.has(badgeId)) return;
    earned.push({ id: badgeId, habitId: habit._id, habitName: habit.name, earnedAt: new Date().toISOString() });
    earnedSet.add(badgeId);
    newBadges.push({ ...badge });
  };

  const uniqueDays = new Set(checkins.map(c => c.date)).size;
  const totalDuration = checkins.reduce((s, c) => s + (c.duration || 0), 0);
  const streak = calcStreak(habit, checkins);
  const year = new Date().getFullYear();
  const yearDays = new Set(
    checkins.filter(c => c.date && c.date.startsWith(String(year))).map(c => c.date)
  ).size;

  if (uniqueDays >= 1) award('first_checkin');
  if (streak >= 3) award('streak_3');
  if (streak >= 7) award('streak_7');
  if (streak >= 30) award('streak_30');
  if (streak >= 90) award('streak_90');
  if (streak >= 180) award('streak_180');
  if (streak >= 365) award('streak_365');
  if (totalDuration >= 100) award('duration_100');
  if (totalDuration >= 500) award('duration_500');
  if (totalDuration >= 10000) award('duration_10000');
  if (uniqueDays >= 300) award('total_days_300');
  if (yearDays >= 280) award('year_280');
  if (lastDuration && lastDuration >= 60) award('single_60');
  if (lastDuration && lastDuration >= 120) award('single_120');

  if (newBadges.length > 0) {
    saveEarnedBadges(earned);
    const pending = wx.getStorageSync('ht_pending_badge_notif') || [];
    pending.push(...newBadges);
    wx.setStorageSync('ht_pending_badge_notif', pending);
  }
  return newBadges;
}

module.exports = { BADGES, getEarnedBadges, saveEarnedBadges, getHabitBadges, checkAndAward };
