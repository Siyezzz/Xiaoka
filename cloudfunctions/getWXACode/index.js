const cloud = require('wx-server-sdk');
cloud.init({ env: 'cloud1-d1gk8zc6k0a6f1728' });

const db = cloud.database();
const https = require('https');

let _token = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const appid = 'wxa06f555ec5612bec';
  const secret = process.env.WX_APPSECRET;
  if (!secret) throw new Error('WX_APPSECRET not set');
  return new Promise((resolve, reject) => {
    https.get(
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`,
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.access_token) {
              _token = json.access_token;
              _tokenExpiry = Date.now() + (json.expires_in - 300) * 1000;
              resolve(json.access_token);
            } else {
              reject(new Error(JSON.stringify(json)));
            }
          } catch (e) { reject(e); }
        });
      }
    ).on('error', reject);
  });
}

async function getWXACodeHttp(token, scene) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      scene: String(scene),
      page: 'pages/social/index',
      env_version: 'trial',
      check_path: false, // 强制关闭路径校验，确保能正常跳转
      is_hyaline: false,
      width: 430,
    });
    const req = https.request({
      hostname: 'api.weixin.qq.com',
      path: `/wxa/getwxacodeunlimit?access_token=${token}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        // If first byte is '{', it's a JSON error response
        if (buf[0] === 0x7B) {
          try { reject(new Error(buf.toString())); }
          catch (e) { reject(e); }
        } else {
          resolve(buf.toString('base64'));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();

  let customId = event.customId;
  if (!customId) {
    // Try doc by _id = openid
    try {
      const r = await db.collection('users').doc(OPENID).get();
      customId = r.data?.customId;
    } catch (_) {}
    // Try by openid field
    if (!customId) {
      try {
        const r = await db.collection('users').where({ openid: OPENID }).limit(1).get();
        customId = r.data && r.data[0] && r.data[0].customId;
      } catch (_) {}
    }
    // Try by _openid field (WeChat auto-field)
    if (!customId) {
      try {
        const r = await db.collection('users').where({ _openid: OPENID }).limit(1).get();
        customId = r.data && r.data[0] && r.data[0].customId;
      } catch (_) {}
    }
    // Still no customId — generate and save one
    if (!customId) {
      try {
        let newId;
        for (let i = 0; i < 10; i++) {
          const candidate = String(Math.floor(100000 + Math.random() * 900000));
          const check = await db.collection('users').where({ customId: candidate }).get();
          if (!check.data || check.data.length === 0) { newId = candidate; break; }
        }
        if (newId) {
          customId = newId;
          try {
            await db.collection('users').doc(OPENID).update({ data: { customId, openid: OPENID } });
          } catch (_) {
            await db.collection('users').doc(OPENID).set({
              data: { _id: OPENID, openid: OPENID, customId, createTime: db.serverDate() },
            });
          }
          console.log('[getWXACode] created customId:', customId);
        }
      } catch (e) {
        console.error('[getWXACode] create customId failed:', e.message);
      }
    }
  }
  if (!customId) return { error: 'no_id', openid: OPENID };

  let buf = null;

  // Try cloud.openapi first
  try {
    const result = await cloud.openapi.wxacode.getUnlimited({
      scene: String(customId),
      page: 'pages/social/index',
      envVersion: 'release',
      check_path: false,
      is_hyaline: false,
      width: 430,
    });
    buf = Buffer.from(result.buffer);
    console.log('[getWXACode] cloud.openapi ok, bytes:', buf.length);
  } catch (e) {
    console.log('[getWXACode] cloud.openapi failed:', e.message, '— trying HTTP');
  }

  // Fallback: HTTP API with AppSecret
  if (!buf) {
    try {
      const token = await getAccessToken();
      const base64str = await getWXACodeHttp(token, customId);
      buf = Buffer.from(base64str, 'base64');
      console.log('[getWXACode] HTTP ok, bytes:', buf.length);
    } catch (e) {
      console.error('[getWXACode] HTTP failed:', e.message);
      return { error: e.message };
    }
  }

  // Upload buffer to Cloud Storage and return a temp HTTPS URL
  try {
    const cloudPath = `qrcodes/qr_${OPENID}.jpg`;
    const uploadRes = await cloud.uploadFile({ cloudPath, fileContent: buf });
    const urlRes = await cloud.getTempFileURL({ fileList: [uploadRes.fileID] });
    const tempUrl = urlRes.fileList[0]?.tempFileURL || '';
    console.log('[getWXACode] upload ok, url:', tempUrl ? 'yes' : 'empty');
    if (tempUrl) return { url: tempUrl };
  } catch (e) {
    console.error('[getWXACode] upload failed:', e.message);
  }

  // Last resort: return raw base64 for client-side file write
  return { base64: `data:image/jpeg;base64,${buf.toString('base64')}` };
};
