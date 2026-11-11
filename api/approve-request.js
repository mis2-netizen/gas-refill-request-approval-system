/**
 * Vercel Serverless Function: api/approve-request.js
 * Updates status, approved amount, admin remarks in Supabase, and triggers WhatsApp webhook.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed. Use POST.' });
  }

  const { password, requestId, status, approvedAmount, adminRemarks, approvedBy } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  if (password !== adminPassword) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Invalid password.' });
  }

  if (!requestId || !status) {
    return res.status(400).json({ success: false, message: 'Missing requestId or status.' });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      success: false,
      message: 'Supabase credentials are not configured in Vercel environment variables.'
    });
  }

  try {
    // 1. Perform database UPDATE (PATCH request)
    const patchUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/gas_refill_requests?request_id=eq.${requestId}`;
    const patchPayload = {
      status: status,
      approved_amount: status === 'Approved' ? Number(approvedAmount) : null,
      admin_remarks: adminRemarks || '',
      approved_by: approvedBy || 'Admin',
      approval_date_time: new Date().toISOString()
    };

    const dbRes = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(patchPayload)
    });

    if (!dbRes.ok) {
      const errText = await dbRes.text();
      throw new Error(`Failed to update request in Supabase: ${errText}`);
    }

    const updatedRows = await dbRes.json();

    if (!updatedRows || updatedRows.length === 0) {
      return res.status(404).json({ success: false, message: `Request ID ${requestId} not found.` });
    }

    const row = updatedRows[0];

    // 2. Send WhatsApp notification
    let whatsAppStatus = 'Failed';
    try {
      whatsAppStatus = await sendWhatsAppMessage(row, status, approvedAmount, adminRemarks);
    } catch (wsErr) {
      console.error('WhatsApp dispatch error:', wsErr);
      whatsAppStatus = `Failed: ${wsErr.message || wsErr}`;
    }

    // 3. Sync to Google Sheets
    try {
      await syncToGoogleSheets(row);
    } catch (sheetErr) {
      console.error('Google Sheets sync error:', sheetErr);
    }

    // 4. Update WhatsApp Status column in Supabase
    await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ whatsapp_status: whatsAppStatus })
    });

    return res.status(200).json({
      success: true,
      whatsAppStatus: whatsAppStatus
    });

  } catch (error) {
    console.error('Error in approve-request API:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal Server Error'
    });
  }
}

/**
 * Helper to normalize Indian phone number to 91XXXXXXXXXX (without leading + or 0)
 */
function normalizeIndianPhone(value) {
  let phone = String(value || '').trim().replace(/[\s()\-]/g, '').replace(/^\+/, '');
  if (/^0[6-9]\d{9}$/.test(phone)) phone = phone.substring(1);
  if (/^[6-9]\d{9}$/.test(phone)) return '91' + phone;
  return /^91[6-9]\d{9}$/.test(phone) ? phone : phone;
}

async function sendWhatsAppMessage(row, status, approvedAmount, adminRemarks) {
  const apiKey = process.env.WHATSHUB_API_KEY || "wp_live_cb4c026df1b09d6fe6c062149b55dbbd2279f8e80944bbf5";
  const baseUrl = (process.env.WHATSHUB_API_BASE || "https://whatshub-production.up.railway.app").replace(/\/$/, "");
  const slot = parseInt(process.env.WHATSHUB_SLOT || "1", 10);
  const url = `${baseUrl}/api/messages/send`;

  const recipient = normalizeIndianPhone(row.employee_mobile);

  const messageText = `*Gas Refill Request Status Update*

Hello ${row.employee_name},
Your gas refill request has been reviewed.

*Request ID:* ${row.request_id}
*Status:* ${status}
*Approved Amount:* ${status === 'Approved' ? '₹' + approvedAmount : 'N/A'}
*Admin Remarks:* ${adminRemarks || 'None'}

Thank you.`;

  if (!apiKey) {
    console.warn('WHATSHUB_API_KEY is not configured in environment variables. Skipping WhatsApp notification to employee.');
    return 'Not Configured (Missing WHATSHUB_API_KEY)';
  }

  try {
    const payload = {
      to: recipient,
      message: messageText,
      type: "text",
      provider: "qr",
      slot: slot
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-API-Key": apiKey
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const responseText = await response.text();
    console.log(`WhatsHub Employee Notification Response: Status ${response.status} - ${responseText}`);

    if (response.ok) {
      let jsonRes = null;
      try { jsonRes = JSON.parse(responseText); } catch (_) {}
      if (jsonRes && (jsonRes.success === true || jsonRes.status === 200 || jsonRes.status === "200")) {
        return 'Sent';
      } else {
        return `Failed: ${(jsonRes && (jsonRes.error || jsonRes.message)) || 'Error'}`;
      }
    } else {
      return `Failed (HTTP ${response.status})`;
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('WhatsHub employee notification timed out after 5s');
      return 'Sent (Pending background delivery)';
    }
    console.error('Error sending WhatsHub notification to employee:', err);
    return `Failed: ${err.message || err}`;
  }
}

/**
 * Syncs the approved request data to the Google Sheets Web App
 */
async function syncToGoogleSheets(row) {
  const webAppUrl = process.env.GOOGLE_SHEET_WEBAPP_URL;
  if (!webAppUrl) {
    console.log('GOOGLE_SHEET_WEBAPP_URL is not set in environment variables. Skipping Google Sheet sync.');
    return;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const response = await fetch(webAppUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(row),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const text = await response.text();
    console.log(`Google Sheets Web App Sync response: Status ${response.status} - ${text}`);
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('Google Sheets sync timed out after 2.5s');
    } else {
      console.error('Error in Google Sheets sync:', err);
    }
  }
}
