export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { appId, appSecret, baseId, tableId, records } = req.body;

  if (!appId || !appSecret || !baseId || !tableId || !records?.length) {
    return res.status(400).json({ success: false, error: 'Thiếu thông tin bắt buộc' });
  }

  try {
    // Bước 1: Lấy token từ server (không qua browser nên không bị CORS)
    const tokenRes = await fetch(
      'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      }
    );
    const tokenData = await tokenRes.json();

    if (tokenData.code !== 0) {
      return res.status(401).json({
        success: false,
        error: 'Lỗi lấy token: ' + (tokenData.msg || 'Unknown'),
      });
    }

    const token = tokenData.tenant_access_token;

    // Bước 2: Gửi records theo batch lên LarkBase
    const BATCH_SIZE = 500;
    let totalCreated = 0;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);

      const syncRes = await fetch(
        `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/records/batch_create`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: 'Bearer ' + token,
          },
          body: JSON.stringify({ records: batch }),
        }
      );

      const syncData = await syncRes.json();

      if (syncData.code !== 0) {
        return res.status(400).json({
          success: false,
          error: 'Lỗi tạo records: ' + (syncData.msg || JSON.stringify(syncData)),
        });
      }

      totalCreated += syncData.data?.records?.length || batch.length;
    }

    return res.status(200).json({ success: true, created: totalCreated });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Lỗi server: ' + error.message });
  }
}
