const { getHabits, invalidateHabits, invalidateCheckins } = require('../../utils/db');
const { getHabitBadges } = require('../../utils/badges');

const AVATAR_COLORS = ['#45C5A0', '#FF6B6B', '#FFD166', '#56CCF2', '#AA96DA', '#F2994A'];

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
  const last = earnedBadges[earnedBadges.length - 1];
  return last ? { icon: last.icon, label: last.name } : null;
}
function avatarColor(openid) {
  let h = 0;
  for (let i = 0; i < openid.length; i++) h = (h + openid.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[h];
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

// Group flat notifications by sender, newest items first within each group
function groupNotifications(notifs) {
  const map = new Map();
  notifs.forEach(n => {
    if (!map.has(n.fromOpenid)) {
      map.set(n.fromOpenid, {
        fromOpenid: n.fromOpenid,
        fromName: n.fromName,
        fromAvatar: n.fromAvatar,
        fromColor: n.fromColor,
        fromInitial: n.fromInitial,
        items: [],
        lastComment: '',
      });
    }
    const g = map.get(n.fromOpenid);
    g.items.push(n);
    // Keep track of the most recent comment for quote-reply pre-fill
    if (n.type === 'comment' && !g.lastComment) g.lastComment = n.text;
  });
  return Array.from(map.values());
}

const _sys = wx.getSystemInfoSync();
const _statusBarHeight = _sys.statusBarHeight || 0;
const _safeAreaBottom = _sys.safeArea ? _sys.screenHeight - _sys.safeArea.bottom : 0;
const _safeBottom = Math.round(116 * _sys.screenWidth / 750) + _safeAreaBottom;

Page({
  data: {
    myProfile: { displayName: '', avatarUrl: '', customId: '' },
    friends: [],
    myHabits: [],
    sharedHabits: [],
    sharedCount: 0,
    sharingMap: {},
    loading: true,
    showShareModal: false,
    showFriendModal: false,
    friendModalHabit: null,
    friendModalSel: {},
    savingFriendModal: false,
    friendManageMode: false,
    savingSharing: false,
    statusBarHeight: _statusBarHeight,
    safeBottom: _safeBottom,
    showShareCodeModal: false,
    qrCodePath: '',
    loadingQR: false,
    showProfileSetup: false,
    tempAvatarUrl: '',
    tempNickname: '',
    tempNote: '',
    savingProfile: false,
    showPendingModal: false,
    pendingCode: '',
    pendingFriend: null,
    acceptingFriend: false,
    showBadge: false,
    unreadCount: 0,
    showMessages: false,
    messagesTab: 'received',
    notifications: [],
    sentNotifications: [],
    loadingMessages: false,
    totalReceivedLikes: 0,
    totalReceivedComments: 0,
    receivedNotifications: [],
    notifGroups: [],
    activeReplyId: '',
    replyInputText: '',
    replyPhotoPath: '',
    sendingInlineReply: false,
    myNote: '',
    curQuote: null,
  },

  async onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 3 });
    }
    this._refreshUnreadCount();
    const app = getApp();
    // Handle warm-start share link (app already running when user taps share card)
    if (app.globalData._pendingFromUid) {
      this._autoAddCode = app.globalData._pendingFromUid;
      app.globalData._pendingFromUid = null;
      this._lastLoadTime = 0;
    }
    if (app.globalData._needsRefresh) {
      app.globalData._needsRefresh = false;
      await this._loadAll();
      return;
    }
    const now = Date.now();
    if (!this._lastLoadTime || now - this._lastLoadTime > 5000) {
      await this._loadAll();
    }
  },

  async onPullDownRefresh() {
    invalidateHabits();
    invalidateCheckins();
    this._lastLoadTime = 0;
    await this._loadAll();
    wx.stopPullDownRefresh();
  },

  async _loadAll() {
    // Angle 3: pre-populate from local cache so avatars show immediately before cloud resolves
    if (this.data.friends.length === 0) {
      try {
        const cached = wx.getStorageSync('ht_friends_cache');
        if (cached && cached.length > 0) {
          this.setData({ friends: cached, loading: false });
        } else {
          this.setData({ loading: true });
        }
      } catch (_) { this.setData({ loading: true }); }
    }
    try {
      const [profileRes, friendsRes, habitsRes, notifRes] = await Promise.allSettled([
        wx.cloud.callFunction({ name: 'social', data: { action: 'getOrCreateProfile' } }),
        wx.cloud.callFunction({ name: 'social', data: { action: 'getFriendsWithHabits' } }),
        getHabits(),
        wx.cloud.callFunction({ name: 'social', data: { action: 'getMyNotifications' } }),
      ]);
      const profile = profileRes.status === 'fulfilled' ? (profileRes.value.result?.profile || null) : null;
      const showBadge = profile ? (profile.showBadge !== false) : false;
      let rawFriends = friendsRes.status === 'fulfilled' ? (friendsRes.value.result?.friends) : undefined;
      if (!rawFriends) {
        try {
          const fb = await wx.cloud.callFunction({ name: 'social', data: { action: 'getFriends' } });
          rawFriends = (fb.result?.friends || []).map(f => ({ ...f, habitDots: [] }));
        } catch (e) { rawFriends = []; }
      }
      const friends = rawFriends.map(f => {
        const cachedAvatar = wx.getStorageSync(`ht_avatar_${f.openid}`) || '';
        const avatarUrl = f.avatarUrl || cachedAvatar;
        if (avatarUrl) {
          try { wx.setStorageSync(`ht_avatar_${f.openid}`, avatarUrl); } catch (_) {}
        }
        return {
          ...f,
          avatarUrl,
          initial: (f.displayName || '?')[0],
          color: avatarColor(f.openid),
          badge: (f.showBadge !== false) ? pickBestBadge(f.earnedBadges) : null,
        };
      });
      // Update local cache for next cold start
      try { wx.setStorageSync('ht_friends_cache', friends.map(f => ({
        openid: f.openid, displayName: f.displayName, avatarUrl: f.avatarUrl,
        color: f.color, initial: f.initial, badge: f.badge, habitDots: f.habitDots || [],
      }))); } catch (_) {}
      const habits  = habitsRes.status  === 'fulfilled' ? habitsRes.value : [];

      const sharingMap = {};
      habits.forEach(h => { sharingMap[h._id] = h.visibility === 'friends'; });
      const sharedHabits = habits.filter(h => h.visibility === 'friends').map(h => {
        const sids = h.sharedFriendIds || ['*'];
        const isAll = sids[0] === '*';
        const matched = isAll ? friends : friends.filter(f => sids.includes(f.openid));
        const sharedWith = matched.slice(0, 10).map(f => ({
          initial: (f.displayName || '?')[0],
          color: avatarColor(f.openid),
          avatarUrl: f.avatarUrl || '',
        }));
        const label = matched.length === 0
          ? (friends.length === 0 ? '等待好友加入' : '好友可见')
          : (isAll ? `所有 ${friends.length} 位好友` : `${matched.length} 位好友`);
        return { ...h, sharedWith, sharedWithLabel: label };
      });
      // Sync earned badges to cloud so friends can see them
      if (showBadge) {
        const earned = getHabitBadges();
        if (earned.length > 0) {
          wx.cloud.callFunction({
            name: 'social',
            data: { action: 'updateBadges', earnedBadges: earned },
          }).catch(() => {});
        }
      }

      const rawNotifs = notifRes?.status === 'fulfilled' ? (notifRes.value.result?.notifications || []) : [];
      const friendsMap = {};
      friends.forEach(f => { friendsMap[f.openid] = f; });
      const receivedNotifications = rawNotifs.map(n => {
        if (n.type === 'reminder_sent') {
          // Group sent reminders under the friend they were sent to
          const f = friendsMap[n.targetOpenid] || {};
          return {
            ...n,
            fromOpenid: n.targetOpenid,
            fromName: n.targetName || f.displayName || '好友',
            fromAvatar: f.avatarUrl || '',
            fromInitial: (n.targetName || f.displayName || '?')[0],
            fromColor: avatarColor(n.targetOpenid || 'x'),
            timeStr: formatTimeAgo(n.createdAt),
          };
        }
        return {
          ...n,
          fromInitial: (n.fromName || '?')[0],
          fromColor: avatarColor(n.fromOpenid || 'x'),
          timeStr: formatTimeAgo(n.createdAt),
        };
      });
      const notifGroups = groupNotifications(receivedNotifications);

      this._lastLoadTime = Date.now();
      this.setData({
        myProfile: profile,
        myNote: profile?.note || '',
        friends,
        myHabits: habits,
        sharingMap,
        sharedHabits,
        sharedCount: sharedHabits.length,
        loading: false,
        friendManageMode: false,
        showBadge,
        receivedNotifications,
        notifGroups,
        unreadCount: 0,
      });
      // Notifications are now visible — mark read and clear badge
      wx.cloud.callFunction({ name: 'social', data: { action: 'markNotificationsRead' } }).catch(() => {});
      if (typeof this.getTabBar === 'function' && this.getTabBar()) {
        this.getTabBar().setData({ 'list[3].dot': false, 'list[3].badge': 0 });
      }

      if (this._autoAddCode) {
        const code = this._autoAddCode;
        this._autoAddCode = null;
        this._execAddFriend(code);
      }
    } catch (e) {
      console.error('social load error:', e);
      this.setData({ loading: false });
    }
  },

  async _execAddFriend(code) {
    wx.showLoading({ title: '添加好友中...' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'social',
        data: { action: 'addFriendByCode', code },
      });
      wx.hideLoading();
      const { error, friend } = res.result || {};
      if (error === 'self_friend') return;
      if (error === 'already_friends') return;
      if (error === 'code_not_found') {
        wx.showToast({ title: '邀请码不存在', icon: 'none' });
        return;
      }
      if (res.result?.success) {
        wx.showToast({ title: `已添加 ${friend?.displayName || '好友'}`, icon: 'success', duration: 1500 });
        await this._loadAll();
        // Navigate new users (no habits yet) to tutorial
        const habits = await getHabits();
        if (!habits || habits.length === 0) {
          wx.navigateTo({ url: '/pages/tutorial/index' });
        }
      } else if (error) {
        wx.showToast({ title: '添加失败，请重试', icon: 'none' });
      }
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '添加失败，请重试', icon: 'none' });
    }
  },

  async onAcceptPending() {
    if (this.data.acceptingFriend) return;
    this.setData({ acceptingFriend: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'social',
        data: { action: 'addFriendByCode', code: this.data.pendingCode },
      });
      const { error } = res.result;
      if (error === 'self_friend') {
        wx.showToast({ title: '不能添加自己哦', icon: 'none' });
      } else if (error === 'already_friends') {
        wx.showToast({ title: '已经是好友了', icon: 'none' });
      } else if (res.result.success) {
        this.setData({ showPendingModal: false });
        wx.showToast({ title: `已添加 ${this.data.pendingFriend.displayName}`, icon: 'success' });
        await this._loadAll();
        return;
      } else {
        wx.showToast({ title: '添加失败，请重试', icon: 'none' });
      }
      this.setData({ showPendingModal: false });
    } catch (e) {
      wx.showToast({ title: '添加失败，请重试', icon: 'none' });
      this.setData({ showPendingModal: false });
    } finally {
      this.setData({ acceptingFriend: false });
    }
  },

  onDeclinePending() {
    this.setData({ showPendingModal: false, pendingCode: '', pendingFriend: null });
  },

  _uploadedFileID: '',

  async onChooseAvatar(e) {
    const filePath = e.detail.avatarUrl;
    this.setData({ tempAvatarUrl: filePath, savingProfile: true });
    this._uploadedFileID = '';
    try {
      const openid = getApp().globalData.openid || 'user';
      const cloudPath = `avatars/${openid}_${Date.now()}.jpg`;
      const up = await wx.cloud.uploadFile({ cloudPath, filePath });
      this._uploadedFileID = up.fileID;
    } catch (err) {
      wx.showToast({ title: '头像上传失败，请重试', icon: 'none' });
    } finally {
      this.setData({ savingProfile: false });
    }
  },

  onNicknameInput(e) {
    this.setData({ tempNickname: e.detail.value });
  },

  onSkipProfile() {
    this.setData({ showProfileSetup: false });
  },

  onEditProfile() {
    const profile = this.data.myProfile || {};
    this.setData({
      showProfileSetup: true,
      tempAvatarUrl: profile.avatarUrl || '',
      tempNickname: profile.displayName !== '习惯达人' ? (profile.displayName || '') : '',
      tempNote: this.data.myNote || '',
    });
  },

  async onSaveProfile() {
    if (this.data.savingProfile) return;
    const { tempNickname, tempNote } = this.data;
    const name = tempNickname.trim() || this.data.myProfile?.displayName || '习惯达人';
    const note = tempNote.trim();
    this.setData({ savingProfile: true });
    try {
      const avatarUrl = this._uploadedFileID || (this.data.myProfile?.avatarUrl || '');
      const [res] = await Promise.all([
        wx.cloud.callFunction({ name: 'social', data: { action: 'updateProfile', displayName: name, avatarUrl } }),
        wx.cloud.callFunction({ name: 'social', data: { action: 'updateNote', note } }),
      ]);
      const profile = res.result?.profile;
      if (profile) {
        this._uploadedFileID = '';
        this.setData({ myProfile: profile, myNote: note, showProfileSetup: false, savingProfile: false });
        getApp().globalData.displayName = profile.displayName;
      }
    } catch (e) {
      this.setData({ savingProfile: false });
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    }
  },

  noop() {},

  onTempNoteInput(e) {
    this.setData({ tempNote: e.detail.value });
  },

  onShowShareCode() {
    this.setData({ showShareCodeModal: true, qrCodePath: '', loadingQR: true });
    this._loadQRCode();
  },

  onHideShareCode() {
    this.setData({ showShareCodeModal: false });
  },

  // Returns a Promise<localPath>. If qrCodePath is an HTTPS URL, downloads it first.
  _getLocalQRPath() {
    const { qrCodePath } = this.data;
    if (!qrCodePath) return Promise.reject(new Error('no path'));
    if (!qrCodePath.startsWith('http')) return Promise.resolve(qrCodePath);
    return new Promise((resolve, reject) => {
      wx.showLoading({ title: '准备中...' });
      wx.downloadFile({
        url: qrCodePath,
        success: (res) => {
          wx.hideLoading();
          if (res.statusCode === 200) resolve(res.tempFilePath);
          else reject(new Error('download failed'));
        },
        fail: (err) => { wx.hideLoading(); reject(err); },
      });
    });
  },

  onSaveQRCode() {
    const { loadingQR } = this.data;
    if (loadingQR) return;
    this._getLocalQRPath().then((filePath) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
        fail: (err) => {
          if (err.errMsg && err.errMsg.includes('auth deny')) {
            wx.showModal({
              title: '需要相册权限',
              content: '请在设置中允许访问相册',
              confirmText: '去设置',
              success: r => { if (r.confirm) wx.openSetting(); },
            });
          } else {
            wx.showToast({ title: '保存失败', icon: 'none' });
          }
        },
      });
    }).catch(() => wx.showToast({ title: '保存失败', icon: 'none' }));
  },

  onShareQRImage() {
    const { loadingQR } = this.data;
    if (loadingQR) return;
    this._getLocalQRPath().then((filePath) => {
      wx.showShareImageMenu({
        path: filePath,
        fail: () => {
          wx.saveImageToPhotosAlbum({
            filePath,
            success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
            fail: () => wx.showToast({ title: '保存失败', icon: 'none' }),
          });
        },
      });
    }).catch(() => wx.showToast({ title: '保存失败', icon: 'none' }));
  },

  async _loadQRCode() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getWXACode', data: {} });
      const { url, base64, error } = res.result || {};
      if (error || (!url && !base64)) {
        this.setData({ loadingQR: false });
        wx.showToast({ title: '生成失败，请重试', icon: 'none' });
        return;
      }
      // Primary path: cloud storage URL — <image> can display it directly
      if (url) {
        this.setData({ qrCodePath: url, loadingQR: false });
        return;
      }
      // Fallback: write base64 to local file
      const base64Data = base64.replace(/^data:[^;]+;base64,/, '');
      const ext = base64Data.startsWith('/9j/') ? 'jpg' : 'png';
      const userDataPath = wx.env?.USER_DATA_PATH || '';
      if (!userDataPath) {
        this.setData({ loadingQR: false });
        wx.showToast({ title: '生成失败，请重试', icon: 'none' });
        return;
      }
      const tmpPath = `${userDataPath}/qrcode_share.${ext}`;
      wx.getFileSystemManager().writeFile({
        filePath: tmpPath,
        data: base64Data,
        encoding: 'base64',
        success: () => this.setData({ qrCodePath: tmpPath, loadingQR: false }),
        fail: (err) => {
          console.error('QR writeFile fail:', JSON.stringify(err));
          this.setData({ loadingQR: false });
          wx.showToast({ title: '生成失败，请重试', icon: 'none' });
        },
      });
    } catch (e) {
      console.error('QR load error:', e.message);
      this.setData({ loadingQR: false });
      wx.showToast({ title: '生成失败，请重试', icon: 'none' });
    }
  },

  onShareAppMessage() {
    const customId = this.data.myProfile?.customId || '';
    const name     = this.data.myProfile?.displayName || '好友';
    return {
      title: `${name} 邀请你一起元气打卡！`,
      path: `/pages/social/index?fromUid=${customId}`,
    };
  },

  async _refreshUnreadCount() {
    try {
      const res = await wx.cloud.callFunction({ name: 'social', data: { action: 'getUnreadCount' } });
      const count = res.result?.count || 0;
      this.setData({ unreadCount: count });
      if (typeof this.getTabBar === 'function' && this.getTabBar()) {
        this.getTabBar().setData({ 'list[3].dot': count > 0, 'list[3].badge': count });
      }
    } catch (e) {}
  },

  async onShowMessages() {
    this.setData({ showMessages: true, loadingMessages: true, messagesTab: 'received' });
    try {
      const [recvRes, sentRes] = await Promise.all([
        wx.cloud.callFunction({ name: 'social', data: { action: 'getMyNotifications' } }),
        wx.cloud.callFunction({ name: 'social', data: { action: 'getSentNotifications' } }),
      ]);
      const notifications = (recvRes.result?.notifications || []).map(n => ({
        ...n,
        fromInitial: (n.fromName || '?')[0],
        fromColor: avatarColor(n.fromOpenid || 'x'),
        timeStr: formatTimeAgo(n.createdAt),
      }));
      const totalReceivedLikes = notifications.filter(n => n.type === 'like').length;
      const totalReceivedComments = notifications.filter(n => n.type === 'comment').length;
      const friends = this.data.friends;
      const sentNotifications = (sentRes.result?.notifications || []).map(n => {
        const friend = friends.find(f => f.openid === n.toOpenid);
        return {
          ...n,
          toName: friend ? friend.displayName : '好友',
          toInitial: friend ? (friend.displayName || '?')[0] : '?',
          toColor: friend ? friend.color : '#45C5A0',
          timeStr: formatTimeAgo(n.createdAt),
        };
      });
      this.setData({ notifications, sentNotifications, loadingMessages: false, totalReceivedLikes, totalReceivedComments });
      wx.cloud.callFunction({ name: 'social', data: { action: 'markNotificationsRead' } })
        .then(() => {
          this.setData({ unreadCount: 0 });
          if (typeof this.getTabBar === 'function' && this.getTabBar()) {
            this.getTabBar().setData({ 'list[3].dot': false, 'list[3].badge': 0 });
          }
        }).catch(() => {});
    } catch (e) {
      this.setData({ loadingMessages: false });
    }
  },

  onHideMessages() {
    this.setData({ showMessages: false });
  },

  onTapNotification(e) {
    const { openid, name, avatar, color } = e.currentTarget.dataset;
    if (!openid) return;
    this.setData({ showMessages: false });
    wx.navigateTo({
      url: `/pages/friend-habits/index?openid=${openid}&name=${encodeURIComponent(name || '')}&avatarurl=${encodeURIComponent(avatar || '')}&color=${encodeURIComponent(color || '#45C5A0')}`,
    });
  },

  onSwitchMessagesTab(e) {
    this.setData({ messagesTab: e.currentTarget.dataset.tab });
  },

  async onDeleteNotification(e) {
    const { id, tab } = e.currentTarget.dataset;
    if (!id) return;
    if (tab === 'sent') {
      this.setData({ sentNotifications: this.data.sentNotifications.filter(n => n._id !== id) });
    } else {
      this.setData({ notifications: this.data.notifications.filter(n => n._id !== id) });
    }
    wx.cloud.callFunction({
      name: 'social',
      data: { action: 'deleteNotification', notificationId: id },
    }).catch(() => {});
  },

  // 分享我的习惯设置
  onShowShareModal() {
    this.setData({ showShareModal: true });
  },

  onHideShareModal() {
    this.setData({ showShareModal: false });
  },

  onToggleHabitShare(e) {
    const id = e.currentTarget.dataset.id;
    const sharingMap = { ...this.data.sharingMap };
    sharingMap[id] = !sharingMap[id];
    this.setData({ sharingMap });
  },

  async onSaveSharing() {
    if (this.data.savingSharing) return;
    // Request subscription consent while still in tap handler context
    const { sharingMap } = this.data;
    if (Object.values(sharingMap).some(v => v)) {
      try {
        await wx.requestSubscribeMessage({
          tmplIds: ['rGCBioESxOPquFSmQyzwwavqtKQAJiJBRyrysC99zpM'],
        });
      } catch (e) {}
    }
    this.setData({ savingSharing: true });
    try {
      const db = wx.cloud.database();
      const { myHabits, sharingMap } = this.data;
      await Promise.all(myHabits.map(h => {
        const sharing = !!sharingMap[h._id];
        return db.collection('habits').doc(h._id).update({
          data: {
            visibility: sharing ? 'friends' : 'private',
            sharedFriendIds: sharing ? ['*'] : [],
          },
        });
      }));
      this.setData({ showShareModal: false });
      invalidateHabits();
      await this._loadAll();
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ savingSharing: false });
    }
  },

  onShowFriendEdit(e) {
    const id = e.currentTarget.dataset.id;
    const habit = this.data.sharedHabits.find(h => h._id === id);
    if (!habit) return;
    const sids = habit.sharedFriendIds || ['*'];
    const isAll = sids[0] === '*';
    const sel = {};
    this.data.friends.forEach(f => { sel[f.openid] = isAll || sids.includes(f.openid); });
    this.setData({ showFriendModal: true, friendModalHabit: habit, friendModalSel: sel });
  },

  onToggleFriendForHabit(e) {
    const openid = e.currentTarget.dataset.openid;
    const friendModalSel = { ...this.data.friendModalSel };
    friendModalSel[openid] = !friendModalSel[openid];
    this.setData({ friendModalSel });
  },

  async onSaveFriendForHabit() {
    const { friendModalHabit, friendModalSel, friends, savingFriendModal } = this.data;
    if (savingFriendModal || !friendModalHabit) return;
    const selectedIds = friends.filter(f => friendModalSel[f.openid]).map(f => f.openid);
    if (friends.length > 0 && selectedIds.length === 0) {
      wx.showToast({ title: '请至少选择一位好友', icon: 'none' });
      return;
    }
    const sharedFriendIds = selectedIds.length === friends.length && friends.length > 0 ? ['*'] : selectedIds;
    this.setData({ savingFriendModal: true });
    try {
      const db = wx.cloud.database();
      await db.collection('habits').doc(friendModalHabit._id).update({ data: { sharedFriendIds } });
      this.setData({ showFriendModal: false });
      invalidateHabits();
      await this._loadAll();
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ savingFriendModal: false });
    }
  },

  onHideFriendModal() {
    this.setData({ showFriendModal: false });
  },

  onToggleManage() {
    this.setData({ friendManageMode: !this.data.friendManageMode });
  },

  onViewFriend(e) {
    const { openid, name, avatarurl, color } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/friend-habits/index?openid=${openid}&name=${encodeURIComponent(name || '')}&avatarurl=${encodeURIComponent(avatarurl || '')}&color=${encodeURIComponent(color || '#45C5A0')}`,
    });
  },

  // ── 收到的点赞/评论区（首页内联回复）────────────────────────
  onViewFriendFromNotif(e) {
    const { openid, name, avatar, color } = e.currentTarget.dataset;
    if (!openid) return;
    wx.navigateTo({
      url: `/pages/friend-habits/index?openid=${openid}&name=${encodeURIComponent(name || '')}&avatarurl=${encodeURIComponent(avatar || '')}&color=${encodeURIComponent(color || '#45C5A0')}`,
    });
  },

  onToggleReply(e) {
    const { openid, name, lastcomment } = e.currentTarget.dataset;
    const isOpen = this.data.activeReplyId === openid;
    this.setData({
      activeReplyId: isOpen ? '' : openid,
      replyInputText: isOpen ? '' : (lastcomment ? `回复 ${name}：` : ''),
      replyPhotoPath: '',
    });
  },

  onInlineReplyInput(e) {
    this.setData({ replyInputText: e.detail.value });
  },

  async onPickReplyPhoto() {
    try {
      const res = await wx.chooseMedia({
        count: 1, mediaType: ['image'],
        sourceType: ['album', 'camera'], sizeType: ['compressed'],
      });
      if (res.tempFiles?.[0]) this.setData({ replyPhotoPath: res.tempFiles[0].tempFilePath });
    } catch (e) {}
  },

  onRemoveReplyPhoto() {
    this.setData({ replyPhotoPath: '' });
  },

  async _uploadPhoto(tempPath) {
    const ext = (tempPath.split('.').pop() || 'jpg').toLowerCase().split('?')[0];
    const name = `notif-imgs/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const res = await wx.cloud.uploadFile({ cloudPath: name, filePath: tempPath });
    return res.fileID;
  },

  async onSendInlineReply(e) {
    const { openid } = e.currentTarget.dataset;
    const { replyInputText, replyPhotoPath, sendingInlineReply, curQuote } = this.data;
    const text = replyInputText.trim();
    if (sendingInlineReply || (!text && !replyPhotoPath) || !openid) return;
    this.setData({ sendingInlineReply: true });
    try {
      let imageUrl = '';
      if (replyPhotoPath) {
        wx.showLoading({ title: '上传中...' });
        imageUrl = await this._uploadPhoto(replyPhotoPath);
        wx.hideLoading();
      }
      await wx.cloud.callFunction({
        name: 'social',
        data: { 
          action: 'sendComment', 
          targetOpenid: openid, 
          text, 
          imageUrl,
          quoteId: curQuote?.id || ''
        },
      });
      this.setData({ 
        activeReplyId: '', 
        replyInputText: '', 
        replyPhotoPath: '', 
        sendingInlineReply: false,
        curQuote: null
      });
      wx.showToast({ title: '回复已发送', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      this.setData({ sendingInlineReply: false });
      wx.showToast({ title: '发送失败', icon: 'none' });
    }
  },

  onPreviewNotifImg(e) {
    const { url } = e.currentTarget.dataset;
    if (url) wx.previewImage({ current: url, urls: [url] });
  },

  onDeleteHomeNotif(e) {
    const { id } = e.currentTarget.dataset;
    const updated = this.data.receivedNotifications.filter(n => n._id !== id);
    const newGroups = groupNotifications(updated);
    const activeStillExists = newGroups.some(g => g.fromOpenid === this.data.activeReplyId);
    this.setData({
      receivedNotifications: updated,
      notifGroups: newGroups,
      notifications: this.data.notifications.filter(n => n._id !== id),
      activeReplyId: activeStillExists ? this.data.activeReplyId : '',
    });
    wx.cloud.callFunction({
      name: 'social',
      data: { action: 'deleteNotification', notificationId: id },
    }).catch(() => {});
  },

  async onToggleBadgeShare() {
    const newVal = !this.data.showBadge;
    this.setData({ showBadge: newVal });
    try {
      const res = await wx.cloud.callFunction({
        name: 'social',
        data: { action: 'updateShowBadge', showBadge: newVal },
      });
      if (res.result?.error) throw new Error(res.result.error);
      // When turning on, push current badges to cloud immediately
      if (newVal) {
        const earned = getHabitBadges();
        if (earned.length > 0) {
          wx.cloud.callFunction({
            name: 'social',
            data: { action: 'updateBadges', earnedBadges: earned },
          }).catch(() => {});
        }
      }
    } catch (e) {
      this.setData({ showBadge: !newVal });
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  async onSeedFakeData() {
    wx.showLoading({ title: '添加中...' });
    try {
      await wx.cloud.callFunction({ name: 'social', data: { action: 'seedFakeData' } });
      wx.hideLoading();
      wx.showToast({ title: '示例好友已添加', icon: 'success' });
      await this._loadAll();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: '添加失败', icon: 'none' });
    }
  },

  onDeleteFriend(e) {
    const { openid, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除好友',
      content: `确定删除好友「${name}」？`,
      confirmText: '删除',
      confirmColor: '#FF6B6B',
      success: async res => {
        if (res.confirm) {
          await wx.cloud.callFunction({
            name: 'social',
            data: { action: 'removeFriend', friendOpenid: openid },
          });
          await this._loadAll();
          wx.showToast({ title: '已删除', icon: 'none' });
        }
      },
    });
  },
    // 点击消息，设置为要引用的内容
    onTapRecvMsg(e) {
      const { id, text, name, openid } = e.currentTarget.dataset;
      this.setData({
        activeReplyId: openid, // 自动打开回复框
        curQuote: { id, text, name, openid }
      });
    },
  
    // 取消引用
  cancelQuote() {
      this.setData({
        curQuote: null
      });
    },
      // 点击消息，设置为要引用的内容
  onTapRecvMsg(e) {
    const { id, text, name, openid } = e.currentTarget.dataset;
    this.setData({
      activeReplyId: openid, // 自动打开回复框
      curQuote: { id, text, name, openid }
    });
  },

  // 取消引用
  cancelQuote() {
    this.setData({
      curQuote: null
    });
  },
  onLoad(options) {
    wx.showShareMenu({ menus: ['shareAppMessage'] });
    // Share card: ?fromUid=123456
    const uid = options?.fromUid || options?.code;
    // QR code scan: options.scene = customId (6-digit)
    const scene = options?.scene ? decodeURIComponent(String(options.scene)) : null;
    const pending = uid || scene;
    if (pending) {
      this._autoAddCode = pending;
      this._lastLoadTime = 0;
    }
  },
});
