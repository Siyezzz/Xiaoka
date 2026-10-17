const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const { OPENID } = cloud.getWXContext();

  // 云函数有管理员权限，第一次运行时自动创建所有必要集合
  for (const col of ['habits', 'checkins', 'users', 'friendships']) {
    try {
      const r = await db.collection(col).add({ data: { __init: true } });
      await db.collection(col).doc(r._id).remove();
    } catch (_) { /* 集合已存在，忽略 */ }
  }

  return { openid: OPENID };
};
