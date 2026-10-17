const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();

  // Read existing doc — safe, errors just mean "not found"
  let existing = null;
  try {
    const r = await db.collection('users').doc(OPENID).get();
    existing = r.data;
  } catch (_) {}

  if (existing) {
    // User exists — backfill customId if somehow missing
    if (!existing.customId) {
      const customId = await generateUniqueCustomId();
      await db.collection('users').doc(OPENID).update({ data: { customId } });
      existing.customId = customId;
    }
    return { user: existing, isNew: false };
  }

  // First time — create with unique 6-digit numeric ID
  const customId = await generateUniqueCustomId();
  const user = {
    _id: OPENID,
    openid: OPENID,
    customId,
    displayName: event.nickname || '习惯达人',
    avatarUrl: event.avatar || '',
    createTime: db.serverDate(),
  };
  await db.collection('users').doc(OPENID).set({ data: user });
  return { user, isNew: true };
};

async function generateUniqueCustomId() {
  for (let i = 0; i < 20; i++) {
    const id = String(Math.floor(100000 + Math.random() * 900000)); // 100000–999999
    const r = await db.collection('users').where({ customId: id }).get();
    if (r.data.length === 0) return id;
  }
  throw new Error('Failed to generate unique customId after 20 attempts');
}
