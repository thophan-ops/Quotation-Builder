export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { appId, appSecret, baseId, tableId, records } = req.body;
  if (!appId || !appSecret || !baseId || !tableId || !records?.length) {
    return res.status(400).json({ success: false, error: 'Thiếu thông tin bắt buộc' });
  }

  try {
    // Bước 1: Lấy token
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
      return res.status(401).json({ success: false, error: 'Lỗi lấy token: ' + tokenData.msg });
    }
    const token = tokenData.tenant_access_token;

    // Bước 2: Lấy danh sách fields để map tên → field_id
    const fieldsRes = await fetch(
      `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/fields`,
      { headers: { Authorization: 'Bearer ' + token } }
    );
    const fieldsData = await fieldsRes.json();
    if (fieldsData.code !== 0) {
      return res.status(400).json({ success: false, error: 'Lỗi lấy fields: ' + fieldsData.msg });
    }

    // Tạo map: tên field (lowercase, trim) → field_id
    const fieldMap = {};
    for (const f of fieldsData.data.items) {
      fieldMap[f.field_name.trim().toLowerCase()] = f.field_id;
    }

    // Bước 3: Chuyển records dùng field_id thay vì tên
    const mappedRecords = records.map(r => {
      const newFields = {};
      for (const [name, value] of Object.entries(r.fields)) {
        const fid = fieldMap[name.trim().toLowerCase()];
        if (fid && value !== undefined && value !== null && value !== '') {
          newFields[fid] = value;
        }
      }
      return { fields: newFields };
    });

    // Bước 4: Batch create
    const BATCH_SIZE = 500;
    let totalCreated = 0;

    for (let i = 0; i < mappedRecords.length; i += BATCH_SIZE) {
      const batch = mappedRecords.slice(i, i + BATCH_SIZE);
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
        return res.status(400).json({ success: false, error: 'Lỗi tạo records: ' + syncData.msg });
      }
      totalCreated += syncData.data?.records?.length || batch.length;
    }

    return res.status(200).json({ success: true, created: totalCreated });

  } catch (error) {
    return res.status(500).json({ success: false, error: 'Lỗi server: ' + error.message });
  }
}
