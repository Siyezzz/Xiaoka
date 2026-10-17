const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { customId } = event;
  if (!customId) return { error: 'no_id' };

  try {
    const r = await db.collection('users').where({ customId: String(customId) }).get();
    if (r.data.length === 0) return { error: 'not_found' };
    const u = r.data[0];
    return {
      user: {
        openid: u.openid,
        customId: u.customId,
        displayName: u.displayName || '习惯达人',
        avatarUrl: u.avatarUrl || '',
      },
    };
  } catch (e) {
    console.error('getUserById error:', e);
    return { error: e.message };
  }
};
