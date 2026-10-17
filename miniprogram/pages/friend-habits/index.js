// Badge priority — more impressive badges shown first when multiple earned
const BADGE_PRIORITY = [
  'streak_365','year_280','streak_180','duration_10000','streak_90',
  'total_days_300','streak_30','duration_500','single_120','streak_7',
  'duration_100','single_60','streak_3','first_checkin',
];

function pickBestBadge(earnedBadges) {
  if (!earnedBadges || earnedBadges.length === 0) return null;
  for (const id of BADGE_PRIORITY) {
    const b = earnedBadges.find(e => e.id === id);
    if (b) return { icon: b.icon, label: b.name };
  }
  // Fallback: most recently earned
  const last = earnedBadges[earnedBadges.length - 1];
  return last ? { icon: last.icon, label: last.name } : null;
}

// 获取中国时区的今日日期字符串（解决时区差问题）
function getTodayCN() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatTimeAgo(date) {
  if (!date) return '';
  let ts;
  if (date instanceof Date) {
    ts = date.getTime();
  } else if (typeof date === 'object' && date.$date != null) {
    // WeChat cloud returns $date as a number (ms) or ISO string
    ts = new Date(date.$date).getTime();
  } else {
    ts = Number(date);
  }
  if (!ts || isNaN(ts)) return '';
  const diff = Date.now() - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}

Page({
  data: {
    friendOpenid: '',
    friendName: '',
    friendAvatarUrl: '',
    friendColor: '',
    friendBadge: null,
    friendNote: '',
    habits: [],
    loading: true,
    doneCount: 0,
    total: 0,
    progress: 0,
    navTopPadding: 0,
    navBarHeightPx: 80,
    headerPaddingTopPx: 92,
    liked: false,
    liking: false,
    showComment: false,
    commentText: '',
    commentQuote: null,
    commentPhotoPath: '',
    sendingComment: false,
    myOpenid: '',
    conversation: [],
    showReminderModal: false,
    reminderHabitId: '',
    reminderHabitName: '',
    reminderText: '',
    sendingReminder: false,
    showPhotoPreview: false,
    previewPhoto: {},
  },

  async onLoad(options) {
    const app = getApp();
    const navTopPadding = app.globalData.navTopPadding || app.globalData.statusBarHeight || 0;
    const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const ratio = sys.windowWidth / 750;
    const navRowPx = Math.round(90 * ratio);
    const navBarHeightPx = navTopPadding + navRowPx;
    const headerPaddingTopPx = navBarHeightPx + Math.round(12 * ratio);
    const myOpenid = app.globalData.openid || '';
    // Set today's date synchronously so onShow (fired immediately after onLoad) sees it
    const _d = new Date();
    this._lastLoadDate = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`;
    // Use cached avatar immediately to avoid fallback-text flash on first render
    const cachedAvatar = wx.getStorageSync(`ht_avatar_${options.openid}`) || '';
    const navAvatar = decodeURIComponent(options.avatarurl || '');
    this.setData({
      navTopPadding,
      navBarHeightPx,
      headerPaddingTopPx,
      myOpenid,
      friendOpenid: options.openid || '',
      friendName: decodeURIComponent(options.name || ''),
      friendAvatarUrl: cachedAvatar || navAvatar,
      friendColor: decodeURIComponent(options.color || ''),
    });
    await this._loadFriendHabits(options.openid);
    this._loadConversation(options.openid);
  },

  onBack() { wx.navigateBack(); },

  onShow() {
    const d = new Date();
    const todayStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const dateChanged = this._lastLoadDate && this._lastLoadDate !== todayStr;
    if (dateChanged) {
      // New day: immediately zero out stale checkin state so user never sees yesterday's counts
      this._lastLoadDate = todayStr;
      this._lastLoadTime = 0;
      const resetHabits = this.data.habits.map(h => ({ ...h, checked: false, todayCount: 0 }));
      this.setData({ habits: resetHabits, doneCount: 0, total: resetHabits.length, progress: 0 });
      this._loadFriendHabits(this.data.friendOpenid);
      return;
    }
    const stale = !this._lastLoadTime || (Date.now() - this._lastLoadTime > 60000);
    if (stale) {
      this._loadFriendHabits(this.data.friendOpenid);
    }
  },

  noop() {},

  async _loadFriendHabits(openid) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'social',
        data: { action: 'getFriendHabits', friendOpenid: openid },
      });
      const { habits = [], checkins = [], profile, error, totalCheckins = 0 } = res.result;
      if (error) {
        wx.showToast({ title: '无法查看好友数据', icon: 'none' });
        this.setData({ loading: false });
        return;
      }

      // Build all updates in one setData to avoid double render
      const updates = { loading: false };

      if (profile) {
        updates.friendName = profile.displayName || this.data.friendName;
        if (profile.avatarUrl) {
          try { wx.setStorageSync(`ht_avatar_${openid}`, profile.avatarUrl); } catch (_) {}
          updates.friendAvatarUrl = profile.avatarUrl;
        }
        updates.friendNote = profile.note || '';
        updates.friendBadge = profile.showBadge !== false
          ? (pickBestBadge(profile.earnedBadges) || null) : null;
      }

      const checkedIds = new Set(checkins.map(c => c.habitId));
      const checkinCountMap = {};
      checkins.forEach(c => { checkinCountMap[c.habitId] = (checkinCountMap[c.habitId] || 0) + 1; });
      const d2 = new Date();
      const todayDay = d2.getDay();
      const todayKey = `${d2.getFullYear()}-${String(d2.getMonth()+1).padStart(2,'0')}-${String(d2.getDate()).padStart(2,'0')}`;
      const todayHabits = habits.filter(h => {
        if (!h.isActive) return false;
        if (h.frequency.type === 'daily') return true;
        if (h.frequency.type === 'free') return true;
        return (h.frequency.days || []).includes(todayDay);
      }).map(h => ({
        ...h,
        checked: checkedIds.has(h._id),
        todayCount: checkinCountMap[h._id] || 0,
        totalDays: h.totalDays || 0,
        recentPhotos: (h.recentPhotos || []).map(p => {
          if (typeof p === 'string' || !p.date) return p;
          return { ...p, dateLabel: `${p.date.slice(5, 7)}/${p.date.slice(8, 10)}` };
        }),
      }));

      updates.habits = todayHabits;

      // Progress: prefer progressMap[today] from profile (same source as home page).
      // progressMap is date-keyed, so a missing entry means 0 today — no frontend reset needed.
      // Fall back to computing from live checkins if progressMap hasn't been written yet today.
      const pm = profile && profile.progressMap && profile.progressMap[todayKey];
      if (pm) {
        updates.doneCount = pm.done || 0;
        updates.total = pm.total || todayHabits.length;
      } else {
        updates.doneCount = todayHabits.filter(h => h.checked).length;
        updates.total = todayHabits.length;
      }
      updates.progress = updates.total > 0 ? Math.round(updates.doneCount / updates.total * 100) : 0;
      updates.totalCheckins = totalCheckins;

      const d = new Date();
      this._lastLoadDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      this._lastLoadTime = Date.now();
      this.setData(updates);

      // 先从本地缓存查今日是否已点赞，提升体验
      const todayStr = getTodayCN();
      const cachedLikeDate = wx.getStorageSync(`ht_like_${openid}`);
      if (cachedLikeDate === todayStr) {
        this.setData({ liked: true });
      }
      
      // 异步拉取最新点赞状态，和缓存同步
      wx.cloud.callFunction({
        name: 'social',
        data: { action: 'getLikeStatus', targetOpenid: openid },
      }).then(r => { 
        const serverLiked = !!r.result?.liked;
        this.setData({ 
          liked: serverLiked,
          likeCount: r.result?.likeCount || 0 
        });
        // 同步缓存
        if (serverLiked) {
          wx.setStorageSync(`ht_like_${openid}`, todayStr);
        } else {
          wx.removeStorageSync(`ht_like_${openid}`);
        }
      }).catch(() => {});
    } catch (e) {
      console.error(e);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async _loadConversation(openid) {
    const fid = openid || this.data.friendOpenid;
    if (!fid) return;
    try {
      const res = await wx.cloud.callFunction({
        name: 'social',
        data: { action: 'getConversation', friendOpenid: fid },
      });
      const { friendName, friendAvatarUrl, friendColor } = this.data;
      const tsOf = d => {
        if (!d) return 0;
        if (typeof d === 'object' && d.$date != null) return new Date(d.$date).getTime();
        if (d instanceof Date) return d.getTime();
        return Number(d) || 0;
      };
      const conversation = (res.result?.messages || [])
        .filter(m => m.type !== 'like')
        .sort((a, b) => tsOf(a.createdAt) - tsOf(b.createdAt))
        .map(m => {
        const raw = m.createdAt;
        const tsObj = raw instanceof Date ? raw : (raw && raw.$date ? new Date(raw.$date) : null);
      const timeStr = tsObj ? `${String(tsObj.getHours()).padStart(2,'0')}:${String(tsObj.getMinutes()).padStart(2,'0')}` : '';
        return {
          ...m,
          timeStr,
          senderName: m.isMine ? '我' : friendName,
          senderAvatar: m.isMine ? '' : friendAvatarUrl,
          senderColor: m.isMine ? '#45C5A0' : friendColor,
          senderInitial: m.isMine ? '我' : (friendName[0] || '?'),
        };
      });
      this.setData({ conversation });
    } catch (e) {}
  },

  async onLikeFriend() {
    const { liking, friendOpenid, likeCount } = this.data;
    if (liking) return;

    this.setData({ liking: true });
    const todayStr = getTodayCN();

    try {
      const res = await wx.cloud.callFunction({
        name: 'social',
        data: { action: 'sendLike', targetOpenid: friendOpenid },
      });
      if (res.result && res.result.error === 'already_liked_today') {
        wx.showToast({ title: '今天已经点过赞了', icon: 'none' });
        this.setData({ liked: true });
        wx.setStorageSync(`ht_like_${friendOpenid}`, todayStr);
      } else if (res.result && res.result.success) {
        wx.setStorageSync(`ht_like_${friendOpenid}`, todayStr);
        this.setData({ liked: true, likeCount: likeCount + 1 });
        this._loadConversation();
      }
    } catch (e) {
      wx.showToast({ title: '点赞失败，请重试', icon: 'none' });
    } finally {
      this.setData({ liking: false });
    }
  },

  onShowComment() {
    this.setData({ showComment: true, commentText: '', commentQuote: null, commentPhotoPath: '' });
  },

  onTapConvForReply(e) {
    const { text, habitname, tiptext, sendername, type } = e.currentTarget.dataset;
    let preview = '';
    if (type === 'reminder' || type === 'reminder_sent') {
      preview = `🔔「${habitname}」${tiptext ? '：' + tiptext : ''}`;
    } else if (type === 'like') {
      preview = '❤️ 点赞';
    } else if (text) {
      preview = text.length > 30 ? text.slice(0, 30) + '…' : text;
    }
    if (!preview) return;
    this.setData({ showComment: true, commentText: '', commentQuote: { sender: sendername, preview }, commentPhotoPath: '' });
  },

  onHideComment() {
    this.setData({ showComment: false, commentText: '', commentQuote: null, commentPhotoPath: '' });
  },

  onClearQuote() {
    this.setData({ commentQuote: null });
  },

  onCommentInput(e) {
    this.setData({ commentText: e.detail.value });
  },

  async onPickCommentPhoto() {
    try {
      const res = await wx.chooseMedia({
        count: 1, mediaType: ['image'],
        sourceType: ['album', 'camera'], sizeType: ['compressed'],
      });
      if (res.tempFiles?.[0]) this.setData({ commentPhotoPath: res.tempFiles[0].tempFilePath });
    } catch (e) {}
  },

  onRemoveCommentPhoto() {
    this.setData({ commentPhotoPath: '' });
  },

  async _uploadPhoto(tempPath) {
    const ext = (tempPath.split('.').pop() || 'jpg').toLowerCase().split('?')[0];
    const name = `notif-imgs/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const res = await wx.cloud.uploadFile({ cloudPath: name, filePath: tempPath });
    return res.fileID;
  },

  async onSendComment() {
    const { commentText, commentPhotoPath, commentQuote, sendingComment, friendOpenid } = this.data;
    if (sendingComment || (!commentText.trim() && !commentPhotoPath)) return;
    this.setData({ sendingComment: true });
    try {
      let imageUrl = '';
      if (commentPhotoPath) {
        wx.showLoading({ title: '上传中...' });
        imageUrl = await this._uploadPhoto(commentPhotoPath);
        wx.hideLoading();
      }
      const quoteText = commentQuote ? `回复 ${commentQuote.sender}：${commentQuote.preview}` : '';
      await wx.cloud.callFunction({
        name: 'social',
        data: { action: 'sendComment', targetOpenid: friendOpenid, text: commentText.trim(), imageUrl, quoteText },
      });
      this.setData({ showComment: false, commentText: '', commentQuote: null, commentPhotoPath: '', sendingComment: false });
      wx.showToast({ title: '留言已发送', icon: 'success' });
      this._loadConversation();
    } catch (e) {
      wx.hideLoading();
      this.setData({ sendingComment: false });
      wx.showToast({ title: '发送失败', icon: 'none' });
    }
  },

  onDeleteMessage(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    this.setData({ conversation: this.data.conversation.filter(m => m._id !== id) });
    wx.cloud.callFunction({
      name: 'social',
      data: { action: 'deleteNotification', notificationId: id },
    }).catch(() => {});
  },

  onShowReminder(e) {
    const { id, name } = e.currentTarget.dataset;
    this.setData({ showReminderModal: true, reminderHabitId: id, reminderHabitName: name, reminderText: '' });
  },

  onHideReminder() {
    this.setData({ showReminderModal: false, reminderText: '' });
  },

  onReminderInput(e) {
    this.setData({ reminderText: e.detail.value });
  },

  async onSendReminder() {
    const { reminderHabitName, reminderText, sendingReminder, friendOpenid } = this.data;
    if (sendingReminder) return;
    this.setData({ sendingReminder: true });
    try {
      await wx.cloud.callFunction({
        name: 'social',
        data: { action: 'sendReminder', targetOpenid: friendOpenid, habitName: reminderHabitName, tipText: reminderText.trim() },
      });
      this.setData({ showReminderModal: false, reminderText: '', sendingReminder: false });
      wx.showToast({ title: '提醒已发送', icon: 'success' });
    } catch (e) {
      this.setData({ sendingReminder: false });
      wx.showToast({ title: '发送失败', icon: 'none' });
    }
  },

  onPreviewConvImg(e) {
    const { url } = e.currentTarget.dataset;
    if (url) wx.previewImage({ current: url, urls: [url] });
  },

  onPreviewPhoto(e) {
    const { habitid, index } = e.currentTarget.dataset;
    const habit = this.data.habits.find(h => h._id === habitid);
    if (!habit || !habit.recentPhotos || habit.recentPhotos.length === 0) return;
    const photo = habit.recentPhotos[Number(index)];
    this.setData({
      showPhotoPreview: true,
      previewPhoto: {
        url: photo.url || photo,
        date: photo.date || '',
        timeStr: photo.timeStr || '',
        note: photo.note || '',
      }
    });
  },

  onClosePhotoPreview() {
    this.setData({ showPhotoPreview: false, previewPhoto: {} });
  },

  onPullDownRefresh() {
    this._loadFriendHabits(this.data.friendOpenid)
      .then(() => wx.stopPullDownRefresh());
  },
});
