const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const AUTHOR_OPENID = 'oCzFz3fJmDAZLGJGf0I31CmF8w_c';

exports.main = async (event, context) => {
  const { action } = event;
  const { OPENID: openid } = cloud.getWXContext();
  const isAuthor = openid === AUTHOR_OPENID;

  if (action === 'sendMessage') {
    const { content, senderName } = event;
    if (!content || !String(content).trim()) return { error: 'empty' };
    const r = await db.collection('inbox_messages').add({
      data: {
        senderOpenid: openid,
        senderName: senderName || '用户',
        content: String(content).trim(),
        replies: [],
        createdAt: db.serverDate(),
        hasNewReply: false,
      },
    });
    return { success: true, id: r._id };
  }

  if (action === 'getMessages') {
    if (isAuthor) {
      const r = await db.collection('inbox_messages')
        .orderBy('createdAt', 'desc')
        .limit(200)
        .get();
      return { messages: r.data, isAuthor: true };
    }
    const r = await db.collection('inbox_messages')
      .where({ senderOpenid: openid })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    return { messages: r.data, isAuthor: false };
  }

  if (action === 'reply') {
    if (!isAuthor) return { error: 'forbidden' };
    const { messageId, content } = event;
    if (!content || !String(content).trim()) return { error: 'empty' };
    await db.collection('inbox_messages').doc(messageId).update({
      data: {
        replies: db.command.push({
          content: String(content).trim(),
          createdAt: new Date().toISOString(),
        }),
        hasNewReply: true,
      },
    });
    return { success: true };
  }

  if (action === 'getInboxUnreadCount') {
    try {
      const r = await db.collection('inbox_messages')
        .where({ senderOpenid: openid, hasNewReply: true })
        .count();
      return { count: r.total || 0 };
    } catch (e) {
      return { count: 0 };
    }
  }

  if (action === 'markInboxRead') {
    try {
      const r = await db.collection('inbox_messages')
        .where({ senderOpenid: openid, hasNewReply: true })
        .limit(50)
        .get();
      await Promise.all(
        (r.data || []).map(m =>
          db.collection('inbox_messages').doc(m._id).update({ data: { hasNewReply: false } }).catch(() => {})
        )
      );
      return { success: true };
    } catch (e) {
      return { success: false };
    }
  }

  if (action === 'getAppVersion') {
    const { currentVersion } = event;
    const validVersion = currentVersion && currentVersion !== '开发版';
    if (isAuthor && validVersion) {
      await db.collection('config').doc('app_version').set({
        data: { _id: 'app_version', latest: currentVersion },
      });
      return { latest: currentVersion };
    }
    try {
      const r = await db.collection('config').doc('app_version').get();
      return { latest: r.data.latest || '' };
    } catch (e) {
      return { latest: '' };
    }
  }

  return { error: 'unknown_action' };
};
