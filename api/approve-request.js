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
 * Sends a WhatsApp status update notification to the employee using Meta Cloud API
 */
async function sendWhatsAppMessage(row, status, approvedAmount, adminRemarks) {
  let digits = row.employee_mobile.toString().replace(/\D/g, '');
  if (digits.length === 10) {
    digits = '91' + digits;
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || 'gas_refill_status_update';
  const languageCode = process.env.WHATSAPP_LANGUAGE_CODE || 'en';

  if (!phoneNumberId || !accessToken) {
    console.log('--- WHATSAPP EMPLOYEE NOTIFICATION SIMULATION ---');
    console.log(`To: ${digits}`);
    console.log(`Template: ${templateName}`);
    console.log(`Params: [${row.employee_name}, ${row.request_id}, ${status}, ${status === 'Approved' ? '₹' + approvedAmount : 'N/A'}, ${adminRemarks || 'None'}]`);
    console.log('-------------------------------------------------');
    return 'Simulated (Meta Credentials Missing)';
  }

  const apiUrl = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: digits,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: languageCode
      },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: row.employee_name },
            { type: "text", text: row.request_id },
            { type: "text", text: status },
            { type: "text", text: status === 'Approved' ? '₹' + approvedAmount : 'N/A' },
            { type: "text", text: adminRemarks || 'None' }
          ]
        }
      ]
    }
  };

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();
  console.log(`WhatsApp Meta API Response Code: ${response.status} - ${responseText}`);

  if (response.ok) {
    return 'Sent';
  } else {
    return `Failed (HTTP ${response.status})`;
  }
}
