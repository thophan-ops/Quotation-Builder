export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { appId, appSecret, baseId, tableId, masterProjectTableId, projectName, records } = req.body;
  if (!appId || !appSecret || !baseId || !tableId || !records?.length) {
    return res.status(400).json({ success: false, error: 'Thiếu thông tin bắt buộc' });
  }

  try {
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
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: 'Bearer ' + token,
    };

    const fieldsRes = await fetch(
      `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/fields`,
      { headers }
    );
    const fieldsData = await fieldsRes.json();
    if (fieldsData.code !== 0) {
      return res.status(400).json({ success: false, error: 'Lỗi lấy fields: ' + fieldsData.msg });
    }

    const fieldMap = {};
    for (const f of fieldsData.data.items) {
      fieldMap[f.field_name.trim().toLowerCase()] = f.field_id;
    }
    const masterProjectFieldId = fieldMap['master project'] || null;

    const mappedRecords = records.map(r => {
      const newFields = {};
      for (const [name, value] of Object.entries(r.fields)) {
        const key = name.trim().toLowerCase();
        if (key === 'master project') continue;
        const fid = fieldMap[key];
        if (fid && value !== undefined && value !== null && value !== '') {
          newFields[fid] = value;
        }
      }
      return { fields: newFields };
    });

    const BATCH_SIZE = 500;
    const createdRecordIds = [];

    for (let i = 0; i < mappedRecords.length; i += BATCH_SIZE) {
      const batch = mappedRecords.slice(i, i + BATCH_SIZE);
      const syncRes = await fetch(
        `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/records/batch_create`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ records: batch }),
        }
      );
      const syncData = await syncRes.json();
      if (syncData.code !== 0) {
        return res.status(400).json({ success: false, error: 'Lỗi tạo records: ' + syncData.msg });
      }
      for (const r of (syncData.data?.records || [])) {
        createdRecordIds.push(r.record_id);
      }
    }

    let projectLinked = false;
    if (masterProjectFieldId && projectName && masterProjectTableId && createdRecordIds.length > 0) {
      try {
        const mpRes = await fetch(
          `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${masterProjectTableId}/records?page_size=100`,
          { headers }
        );
        const mpData = await mpRes.json();

        let masterProjectRecordId = null;
        if (mpData.code === 0 && mpData.data?.items) {
          for (const item of mpData.data.items) {
            const fields = item.fields;
            for (const [, val] of Object.entries(fields)) {
              const text = typeof val === 'string' ? val : (val?.[0]?.text || '');
              if (text.toLowerCase().includes(projectName.toLowerCase())) {
                masterProjectRecordId = item.record_id;
                break;
              }
            }
            if (masterProjectRecordId) break;
          }
        }

        if (masterProjectRecordId) {
          const updateRecords = createdRecordIds.map(rid => ({
            record_id: rid,
            fields: { [masterProjectFieldId]: [{ record_id: masterProjectRecordId }] },
          }));

          for (let i = 0; i < updateRecords.length; i += 500) {
            const batch = updateRecords.slice(i, i + 500);
            await fetch(
              `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/records/batch_update`,
              {
                method: 'POST',
                headers,
                body: JSON.stringify({ records: batch }),
              }
            );
          }
          projectLinked = true;
        }
      } catch (_) {}
    }

    return res.status(200).json({
      success: true,
      created: createdRecordIds.length,
      projectLinked,
    });

  } catch (error) {
    return res.status(500).json({ success: false, error: 'Lỗi server: ' + error.message });
  }
}
