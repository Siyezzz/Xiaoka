const { addHabit, updateHabit, getDb } = require('../../utils/db');

const REMINDER_TEMPLATE_ID = 'ZWD5t9gkBBHYmYN1luBC3PyLswOaYFRdSgg-bJCkeZw';

const ICONS = [
  '💪', '🏃', '📚', '💧', '🧘', '😴', '✍️',
  '🎯', '🎨', '🎵', '💻', '🧹', '📝', '🌞', '🌙',
  '🚶', '🏋️', '🏊', '🚴', '🍎', '🥦', '☕', '💊',
  '🌿', '🌸', '🔥', '⭐', '🎉', '🧗', '🤸', '🏸',
  '❤️'
];

const COLORS = [
  '#45C5A0', '#27AE60', '#FFD166', '#F2994A', '#EB5757',
  '#FF6B9D', '#FFACC7', '#56CCF2', '#2D9CDB', '#9B51E0',
  '#FF7043', '#5C6BC0',
];

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

const KEYWORD_ICONS = [
  [/跑|运动|健身|锻炼/, '🏃‍♀️'],
  [/读|看书|阅读|学习/, '📚'],
  [/水|喝水/, '💧'],
  [/冥想|打坐|瑜伽/, '🧘'],
  [/睡|早睡/, '😴'],
  [/写|日记|笔记|练字/, '✍️'],
  [/目标|计划/, '🎯'],
  [/画|绘画|艺术/, '🎨'],
  [/音乐|唱歌|乐器/, '🎵'],
  [/代码|编程|开发|工作/, '💻'],
  [/整理|打扫|收拾/, '🧹'],
  [/咖啡|茶/, '☕'],
  [/药|维生素|吃药/, '💊'],
  [/走路|步行|散步/, '🚶‍♀️'],
  [/游泳/, '🏊'],
  [/骑车|自行车/, '🚴'],
  [/力量|哑铃|举重|健身/, '🏋️‍♀️'],
];

function autoPickIcon(name) {
  for (const [pattern, icon] of KEYWORD_ICONS) {
    if (pattern.test(name)) return icon;
  }
  return null;
}

// 把 days 数组转成 map 供 WXML 使用，避免 indexOf 类型问题
function buildDaysMap(days) {
  const map = {};
  days.forEach(d => { map[d] = true; });
  return map;
}

Page({
  data: {
    isEdit: false,
    habitId: null,
    name: '',
    goalText: '',
    selectedIcon: '💪',
    selectedColor: '#45C5A0',
    navBgStyle: 'background: #45C5A0;',
    statusBarHeight: 0,
    freqType: 'daily',
    selectedDays: [0, 1, 2, 3, 4, 5, 6],
    selectedDaysMap: { 0: true, 1: true, 2: true, 3: true, 4: true, 5: true, 6: true },
    isActive: true,
    navTopPadding: 0,
    // 分享设置
    sharingEnabled: false,
    sharePhotos: false,
    shareMode: 'all',      // 'all' = 所有好友, 'custom' = 指定好友
    friends: [],
    selectedFriendIds: {},  // { openid: true/false }
    loadingFriends: false,
    // 提醒设置
    reminderEnabled: false,
    reminderTimes: ['08:00'],
    reminderSkipCount: 1,
    pickerVisible: false,
    editingTimeIndex: -1,
    pickerVal: [8, 0],
    pickerHours: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')),
    pickerMinutes: ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'],
    colors: COLORS,
    // UI 状态
    weekLabels: WEEK_LABELS,
    saving: false,
    showEmojiInput: false,
    emojiInputVal: '',
    navBarHeightPx: 80,
    pageReady: false,
    // 邀请好友小程序码
    showShareCodeModal: false,
    qrCodePath: '',
    loadingQR: false,
  },

  async onLoad(options) {
    const app = getApp();
    const navTopPadding = app.globalData.navTopPadding || app.globalData.statusBarHeight || 0;
    const sys = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    const ratio = sys.windowWidth / 750;
    const navBarHeightPx = Math.round(navTopPadding + 72 * ratio);
    const base = { statusBarHeight: app.globalData.statusBarHeight || 0, navTopPadding, navBarHeightPx, pageReady: true };

    if (options.id) {
      const pending = getApp().globalData._pendingEdit;
      if (pending && pending._id === options.id) {
        const days = (pending.frequency && pending.frequency.days) || [];
        const sharedFriendIds = pending.sharedFriendIds || [];
        const selFriends = {};
        sharedFriendIds.forEach(fid => { selFriends[fid] = true; });
        this.setData({
          ...base,
          isEdit: true, habitId: options.id,
          name: pending.name || '',
          goalText: pending.goal || '',
          selectedIcon: pending.icon || '💪',
          selectedColor: pending.color || '#45C5A0',
          navBgStyle: `background: ${pending.color || '#45C5A0'};`,
          freqType: (pending.frequency && pending.frequency.type) || 'daily',
          selectedDays: days,
          selectedDaysMap: buildDaysMap(days),
          isActive: pending.isActive !== false,
          sharingEnabled: (pending.visibility || 'private') !== 'private',
          sharePhotos: !!pending.sharePhotos,
          shareMode: sharedFriendIds[0] === '*' ? 'all' : (sharedFriendIds.length > 0 ? 'custom' : 'all'),
          selectedFriendIds: selFriends,
          reminderEnabled: !!(pending.reminder && pending.reminder.enabled),
          reminderTimes: (pending.reminder && pending.reminder.times && pending.reminder.times.length > 0) ? pending.reminder.times : ['08:00'],
          reminderSkipCount: pending.reminder && pending.reminder.skipThreshold != null ? pending.reminder.skipThreshold : 1,
        });
        getApp().globalData._pendingEdit = null;
      } else {
        this.setData({ ...base, isEdit: true, habitId: options.id });
      }
      await this._loadHabit(options.id);
    } else {
      this.setData(base);
    }
  },

  onBack() { wx.navigateBack(); },

  onShareAppMessage() {
    const app = getApp();
    const code = app.globalData.customId || '';
    const name = app.globalData.displayName || '好友';
    return {
      title: `${name} 邀请你一起打卡习惯！`,
      path: `/pages/social/index?fromUid=${code}`,
    };
  },

  async _loadHabit(id) {
    try {
      const db = getDb();
      const res = await db.collection('habits').doc(id).get();
      const h = res.data;
      const days = h.frequency.days || [];
      const sharedFriendIds = h.sharedFriendIds || [];
      const selectedFriendIds = {};
      sharedFriendIds.forEach(fid => { selectedFriendIds[fid] = true; });
      this.setData({
        name: h.name,
        goalText: h.goal || '',
        selectedIcon: h.icon,
        selectedColor: h.color,
        navBgStyle: `background: ${h.color};`,
        freqType: h.frequency.type,
        selectedDays: days,
        selectedDaysMap: buildDaysMap(days),
        isActive: h.isActive !== false,
        sharingEnabled: (h.visibility || 'private') !== 'private',
        sharePhotos: !!h.sharePhotos,
        shareMode: sharedFriendIds[0] === '*' ? 'all' : (sharedFriendIds.length > 0 ? 'custom' : 'all'),
        selectedFriendIds,
        reminderEnabled: !!(h.reminder && h.reminder.enabled),
        reminderTimes: (h.reminder && h.reminder.times && h.reminder.times.length > 0) ? h.reminder.times : ['08:00'],
        reminderSkipCount: h.reminder && h.reminder.skipThreshold != null ? h.reminder.skipThreshold : 1,
      });
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onNameInput(e) {
    const name = e.detail.value;
    const suggested = autoPickIcon(name);
    if (suggested && !this.data.isEdit) {
      const color = this._emojiColor(suggested);
      this.setData({ name, selectedIcon: suggested, selectedColor: color, navBgStyle: `background: ${color};` });
    } else {
      this.setData({ name });
    }
  },

  onGoalInput(e) {
    this.setData({ goalText: e.detail.value });
  },

  onTapIcon() {
    this.setData({ showEmojiInput: true, emojiInputVal: '' });
  },

  onEmojiInput(e) {
    const val = e.detail.value;
    if (!val) return;
    const icon = [...val][0] || val[0]; // first perceived character
    if (!icon) return;
    this.setData({ selectedIcon: icon, emojiInputVal: icon });
  },

  onEmojiDone() {
    this.setData({ showEmojiInput: false });
  },

  _emojiColor(icon) {
    const code = (icon || '').codePointAt(0) || 0;
    return COLORS[code % COLORS.length];
  },

  onSelectColor(e) {
    const color = e.currentTarget.dataset.color;
    this.setData({ selectedColor: color, navBgStyle: `background: ${color};` });
  },

  onFreqChange(e) {
    const type = e.currentTarget.dataset.type;
    if (type === 'free') {
      this.setData({ freqType: 'free', selectedDays: [], selectedDaysMap: {} });
      return;
    }
    const days = type === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
    this.setData({ freqType: type, selectedDays: days, selectedDaysMap: buildDaysMap(days) });
  },

  onToggleDay(e) {
    // 强制转 Number 避免 string vs number 类型不匹配
    const day = Number(e.currentTarget.dataset.day);
    let days = [...this.data.selectedDays];
    const idx = days.indexOf(day);
    if (idx > -1) {
      if (days.length <= 1) {
        wx.showToast({ title: '至少选择一天', icon: 'none', duration: 1200 });
        return;
      }
      days.splice(idx, 1);
    } else {
      days.push(day);
      days.sort((a, b) => a - b);
    }
    this.setData({ selectedDays: days, selectedDaysMap: buildDaysMap(days) });
  },

  onActiveChange(e) {
    this.setData({ isActive: e.detail.value });
  },

  onSharePhotosChange(e) {
    this.setData({ sharePhotos: e.detail.value });
  },

  async onSharingChange(e) {
    const sharingEnabled = e.detail.value;
    if (!sharingEnabled) this.setData({ sharePhotos: false });
    this.setData({ sharingEnabled });
    if (sharingEnabled) {
      wx.requestSubscribeMessage({
        tmplIds: ['rGCBioESxOPquFSmQyzwwavqtKQAJiJBRyrysC99zpM'],
        success: () => {},
        fail: () => {},
      });
      if (this.data.friends.length === 0) {
        await this._loadFriends();
      }
    }
  },

  onShareModeChange(e) {
    this.setData({ shareMode: e.currentTarget.dataset.mode });
  },

  async _loadFriends() {
    this.setData({ loadingFriends: true });
    try {
      const res = await wx.cloud.callFunction({ name: 'social', data: { action: 'getFriends' } });
      const friends = res.result.friends || [];
      const selectedFriendIds = { ...this.data.selectedFriendIds };
      this.setData({ friends, loadingFriends: false });
    } catch (e) {
      this.setData({ loadingFriends: false });
    }
  },

  async onCopyInviteLink() {
    try {
      const res = await wx.cloud.callFunction({ name: 'social', data: { action: 'getOrCreateProfile' } });
      const { customId, displayName } = res.result.profile || {};
      if (!customId) { wx.showToast({ title: '获取邀请码失败', icon: 'none' }); return; }
      const text = `${displayName || '我'} 邀请你一起打卡养成好习惯！打开小程序「每天都要元气打卡」，在好友页面输入邀请码 ${customId} 添加好友。`;
      wx.setClipboardData({
        data: text,
        success: () => wx.showToast({ title: '邀请链接已复制', icon: 'success' }),
      });
    } catch (e) {
      wx.showToast({ title: '复制失败', icon: 'none' });
    }
  },

  onToggleFriend(e) {
    const openid = e.currentTarget.dataset.openid;
    const selectedFriendIds = { ...this.data.selectedFriendIds };
    if (selectedFriendIds[openid]) {
      delete selectedFriendIds[openid];
    } else {
      selectedFriendIds[openid] = true;
    }
    this.setData({ selectedFriendIds });
  },

  onReminderChange(e) {
    const enabled = e.detail.value;
    this.setData({ reminderEnabled: enabled });
    // Must use callback style — Promise loses the tap event context in WeChat
    if (enabled && REMINDER_TEMPLATE_ID) {
      wx.requestSubscribeMessage({
        tmplIds: [REMINDER_TEMPLATE_ID],
        success: () => {},
        fail: () => {},
      });
    }
  },

  onAddReminderTime() {
    const times = [...this.data.reminderTimes];
    if (times.length >= 5) return;
    times.push('09:00');
    this.setData({ reminderTimes: times });
  },

  onOpenTimePicker(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const time = this.data.reminderTimes[idx];
    const [hStr, mStr] = time.split(':');
    const hourIdx = parseInt(hStr);
    const minuteIdx = Math.round(parseInt(mStr) / 5);
    this.setData({ pickerVisible: true, editingTimeIndex: idx, pickerVal: [hourIdx, minuteIdx] });
  },

  onPickerChange(e) {
    this.setData({ pickerVal: e.detail.value });
  },

  onPickerConfirm() {
    const { pickerVal, pickerHours, pickerMinutes, editingTimeIndex, reminderTimes } = this.data;
    const h = pickerHours[pickerVal[0]];
    const m = pickerMinutes[pickerVal[1]];
    const times = [...reminderTimes];
    times[editingTimeIndex] = `${h}:${m}`;
    this.setData({ reminderTimes: times, pickerVisible: false });
    if (REMINDER_TEMPLATE_ID) {
      wx.requestSubscribeMessage({ tmplIds: [REMINDER_TEMPLATE_ID], success: () => {}, fail: () => {} });
    }
  },

  onPickerCancel() {
    this.setData({ pickerVisible: false });
  },

  onDecSkipCount() {
    const v = this.data.reminderSkipCount;
    if (v > 0) this.setData({ reminderSkipCount: v - 1 });
  },

  onIncSkipCount() {
    const v = this.data.reminderSkipCount;
    if (v < 10) this.setData({ reminderSkipCount: v + 1 });
  },

  onRemoveReminderTime(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const times = this.data.reminderTimes.filter((_, i) => i !== idx);
    this.setData({ reminderTimes: times.length > 0 ? times : ['08:00'] });
  },

  async onSave() {
    const {
      name, selectedIcon, selectedColor, freqType, selectedDays,
      isActive, sharingEnabled, sharePhotos, shareMode, selectedFriendIds,
      reminderEnabled, reminderTimes,
      isEdit, habitId, saving,
    } = this.data;

    if (saving) return;
    if (!name.trim()) {
      wx.showToast({ title: '请输入习惯名称', icon: 'none' });
      return;
    }

    if (freqType === 'weekly' && selectedDays.length === 0) {
      wx.showToast({ title: '请至少选择一天', icon: 'none' });
      return;
    }

    // 计算分享设置
    let visibility = 'private';
    let sharedFriendIds = [];
    if (sharingEnabled) {
      visibility = 'friends';
      if (shareMode === 'all') {
        sharedFriendIds = ['*'];
      } else {
        sharedFriendIds = Object.keys(selectedFriendIds).filter(k => selectedFriendIds[k]);
        if (sharedFriendIds.length === 0) {
          wx.showToast({ title: '请选择至少一位好友', icon: 'none' });
          return;
        }
      }
    }

    const data = {
      name: name.trim(),
      goal: this.data.goalText.trim(),
      icon: selectedIcon,
      color: selectedColor,
      frequency: { type: freqType, days: selectedDays },
      isActive,
      visibility,
      sharedFriendIds,
      sharePhotos: sharingEnabled ? !!sharePhotos : false,
      reminder: { enabled: reminderEnabled, times: reminderEnabled ? reminderTimes : [], skipThreshold: this.data.reminderSkipCount },
    };

    // 开启了提醒：先请求订阅授权，用户操作后再保存
    const afterSubscribe = () => {
      this._doSaveHabit(data);
    };

    if (reminderEnabled && REMINDER_TEMPLATE_ID) {
      wx.requestSubscribeMessage({
        tmplIds: [REMINDER_TEMPLATE_ID],
        success: (res) => { 
          console.log('[reminder sub]', JSON.stringify(res)); 
          afterSubscribe();
        },
        fail: (err) => { 
          console.error('[reminder sub fail]', JSON.stringify(err)); 
          afterSubscribe();
        },
      });
    } else {
      afterSubscribe();
    }
  },

  // 实际保存习惯的逻辑，授权完成后调用
  async _doSaveHabit(data) {
    const { isEdit, habitId } = this.data;
    this.setData({ saving: true });
    wx.showLoading({ title: '保存中...' });

    try {
      if (isEdit) {
        await updateHabit(habitId, data);
        wx.hideLoading();
        wx.showToast({ title: '保存成功', icon: 'success' });
      } else {
        await addHabit(data);
        wx.hideLoading();
        wx.showToast({ title: '添加成功', icon: 'success' });
      }
      getApp().globalData._needsRefresh = true;
      setTimeout(() => wx.navigateBack(), 800);
    } catch (e) {
      wx.hideLoading();
      console.error('save habit error:', e);
      wx.showModal({
        title: '保存失败',
        content: e.errMsg || '请检查网络或云开发配置',
        showCancel: false,
      });
    } finally {
      this.setData({ saving: false });
    }
  },

  onShowShareCode() {
    this.setData({ showShareCodeModal: true, qrCodePath: '', loadingQR: true });
    this._loadQRCode();
  },

  onHideShareCode() {
    this.setData({ showShareCodeModal: false });
  },

  onSaveQRCode() {
    const { qrCodePath, loadingQR } = this.data;
    if (loadingQR || !qrCodePath) return;
    wx.saveImageToPhotosAlbum({
      filePath: qrCodePath,
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
  },

  onShareQRImage() {
    const { qrCodePath, loadingQR } = this.data;
    if (loadingQR || !qrCodePath) return;
    wx.showShareImageMenu({
      path: qrCodePath,
      fail: () => { this.onSaveQRCode(); },
    });
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
      if (url) {
        this.setData({ qrCodePath: url, loadingQR: false });
        return;
      }
      const base64Data = base64.replace(/^data:[^;]+;base64,/, '');
      const ext = base64Data.startsWith('/9j/') ? 'jpg' : 'png';
      const userDataPath = wx.env?.USER_DATA_PATH || '';
      if (!userDataPath) {
        this.setData({ loadingQR: false });
        wx.showToast({ title: '生成失败，请重试', icon: 'none' });
        return;
      }
      const tmpPath = `${userDataPath}/qrcode_addhab.${ext}`;
      wx.getFileSystemManager().writeFile({
        filePath: tmpPath,
        data: base64Data,
        encoding: 'base64',
        success: () => this.setData({ qrCodePath: tmpPath, loadingQR: false }),
        fail: () => {
          this.setData({ loadingQR: false });
          wx.showToast({ title: '生成失败，请重试', icon: 'none' });
        },
      });
    } catch (e) {
      this.setData({ loadingQR: false });
      wx.showToast({ title: '生成失败，请重试', icon: 'none' });
    }
  },
});


