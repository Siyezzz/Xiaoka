const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const { friendOpenid } = event;

  if (!friendOpenid) return { error: 'no_friend_id' };
  if (friendOpenid === OPENID) return { error: 'self_friend' };

  // Deduplication check — one direction is enough given we store bidirectionally
  const existing = await db.collection('friends')
    .where({ userId: OPENID, friendId: friendOpenid })
    .get();
  if (existing.data.length > 0) return { error: 'already_friends' };

  const now = db.serverDate();
  // Bidirectional storage — both parties can now query WHERE userId = self
  await Promise.all([
    db.collection('friends').add({ data: { userId: OPENID,       friendId: friendOpenid, createTime: now } }),
    db.collection('friends').add({ data: { userId: friendOpenid, friendId: OPENID,       createTime: now } }),
  ]);

  let friend = { openid: friendOpenid, displayName: '好友', avatarUrl: '' };
  try {
    const r = await db.collection('users').doc(friendOpenid).get();
    friend = r.data;
  } catch (_) {}

  return { success: true, friend };
};
