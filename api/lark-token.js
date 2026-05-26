export default async function handler(req, res) {
  // CORS headers — bắt buộc để browser có thể gọi được
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ code: -1, msg: 'Method not allowed' });
  }

  const { app_id, app_secret } = req.body;

  if (!app_id || !app_secret) {
    return res.status(400).json({ code: -1, msg: 'Thiếu app_id hoặc app_secret' });
  }

  try {
    const response = await fetch(
      'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ app_id, app_secret }),
      }
    );

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ code: -1, msg: 'Lỗi server: ' + error.message });
  }
}
