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

    // 2. Draft message template
    let message = '';
    if (status === 'Approved') {
      message = `Dear ${row.employee_name},\n` +
                `Your gas refill request ${requestId} has been approved.\n` +
                `Approved Amount: ₹${approvedAmount}\n` +
                `Centre: ${row.branch}\n` +
                `Remarks: ${adminRemarks || 'None'}\n` +
                `Thank you.`;
    } else {
      message = `Dear ${row.employee_name},\n` +
                `Your gas refill request ${requestId} has been rejected.\n` +
                `Reason: ${adminRemarks || 'No reason specified'}\n` +
                `Please contact admin for more details.`;
    }

    // 3. Send WhatsApp notification
    let whatsAppStatus = 'Failed';
    try {
      whatsAppStatus = await sendWhatsAppMessage(row.employee_mobile, message);
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
 * Normalizes Indian mobile number and posts message to API webhook
 */
async function sendWhatsAppMessage(mobile, message) {
  let digits = mobile.toString().replace(/\D/g, '');
  if (digits.length === 10) {
    digits = '91' + digits;
  }

  const apiUrl = process.env.WHATSAPP_API_URL;
  const apiToken = process.env.WHATSAPP_API_TOKEN;

  const isPlaceholderUrl = !apiUrl || apiUrl.includes('PASTE_YOUR_WHATSAPP_API') || apiUrl.trim() === '';
  const isPlaceholderToken = !apiToken || apiToken.includes('PASTE_YOUR_API_TOKEN') || apiToken.trim() === '';

  if (isPlaceholderUrl || isPlaceholderToken) {
    console.log('--- WHATSAPP MESSAGE SIMULATION ---');
    console.log(`To: ${digits}`);
    console.log(`Message:\n${message}`);
    console.log('-----------------------------------');
    return 'Simulated (API Not Configured)';
  }

  const payload = {
    to: digits,
    message: message
  };

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();
  console.log(`WhatsApp API Response Code: ${response.status} - ${responseText}`);

  if (response.status >= 200 && response.status < 300) {
    return 'Sent';
  } else {
    return `Failed (HTTP ${response.status})`;
  }
}
