// 云函数拥有管理员权限，可以自动创建集合
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async () => {
  const collections = ['habits', 'checkins', 'users', 'friendships'];
  const results = {};

  for (const col of collections) {
    try {
      // 插入一条占位文档触发集合创建，然后立即删除
      const res = await db.collection(col).add({ data: { __init: true } });
      await db.collection(col).doc(res._id).remove();
      results[col] = 'created';
    } catch (e) {
      // 集合已存在或其他错误，忽略
      results[col] = 'exists_or_skipped';
    }
  }

  return { success: true, results };
};
