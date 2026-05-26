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
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: 'Bearer ' + token,
    };

    // Bước 2: Lấy field IDs của bảng Quotation Lines
    const fieldsRes = await fetch(
      `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${tableId}/fields`,
      { headers }
    );
    const fieldsData = await fieldsRes.json();
    if (fieldsData.code !== 0) {
      return res.status(400).json({ success: false, error: 'Lỗi lấy fields: ' + fieldsData.msg });
    }

    // Map: tên field (lowercase) → field_id
    const fieldMap = {};
    for (const f of fieldsData.data.items) {
      fieldMap[f.field_name.trim().toLowerCase()] = f.field_id;
    }

    // Bước 3: Tìm Master Project record ID (độc lập, không ảnh hưởng sync chính)
    let masterProjectRecordId = null;
    let masterProjectFieldId = fieldMap['master project'] || null;

    if (masterProjectFieldId && projectName && masterProjectTableId) {
      try {
        // Lấy danh sách fields của Master Project để tìm tên đúng cột "Project Name"
        const mpFieldsRes = await fetch(
          `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${masterProjectTableId}/fields`,
          { headers }
        );
        const mpFieldsData = await mpFieldsRes.json();

        let projectNameFieldName = 'Project Name'; // default
        if (mpFieldsData.code === 0) {
          // Tìm field nào có tên gần giống "project name"
          const pnField = mpFieldsData.data.items.find(f =>
            f.field_name.toLowerCase().includes('project name') ||
            f.field_name.toLowerCase().includes('project')
          );
          if (pnField) projectNameFieldName = pnField.field_name;
        }

        // Tìm record trong Master Project khớp với tên project
        const searchRes = await fetch(
          `https://open.larksuite.com/open-apis/bitable/v1/apps/${baseId}/tables/${masterProjectTableId}/records/search`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({
              filter: {
                conjunction: 'and',
                conditions: [{
                  field_name: projectNameFieldName,
                  operator: 'contains',
                  value: [projectName],
                }],
              },
              page_size: 1,
            }),
          }
        );
        const searchData = await searchRes.json();
        if (searchData.code === 0 && searchData.data?.items?.length > 0) {
          masterProjectRecordId = searchData.data.items[0].record_id;
        }
      } catch (_) {
        // Bỏ qua lỗi project search — sync chính vẫn chạy
      }
    }

    // Bước 4: Build records với field IDs
    const mappedRecords = records.map(r => {
      const newFields = {};
      for (const [name, value] of Object.entries(r.fields)) {
        const fid = fieldMap[name.trim().toLowerCase()];
        if (fid && value !== undefined && value !== null && value !== '') {
          newFields[fid] = value;
        }
      }
      // Gắn Master Project nếu tìm được record ID
      if (masterProjectFieldId && masterProjectRecordId) {
        newFields[masterProjectFieldId] = [{ record_id: masterProjectRecordId }];
      }
      return { fields: newFields };
    });

    // Bước 5: Batch create
    const BATCH_SIZE = 500;
    let totalCreated = 0;

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
      totalCreated += syncData.data?.records?.length || batch.length;
    }

    return res.status(200).json({
      success: true,
      created: totalCreated,
      projectLinked: !!masterProjectRecordId,
    });

  } catch (error) {
    return res.status(500).json({ success: false, error: 'Lỗi server: ' + error.message });
  }
}
