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

async function sendWhatsAppMessage(row, status, approvedAmount, adminRemarks) {
  const secret = process.env.WHATSIFY_SECRET || "b26433c6-7cb5-4db0-8ff0-8c200d4cfb98";
  const account = process.env.WHATSIFY_ACCOUNT || "1742193706259b3921152244c2f76a1b9270dd3b10e3d1642a";
  const url = "https://whatsify.me/api/send/whatsapp";

  let digits = row.employee_mobile.toString().replace(/\D/g, '');
  if (digits.length === 10) {
    digits = '+91' + digits;
  } else if (digits.startsWith('91') && digits.length === 12) {
    digits = '+' + digits;
  } else if (!digits.startsWith('+')) {
    digits = '+91' + digits;
  }

  const messageText = `*Gas Refill Request Status Update*

Hello ${row.employee_name},
Your gas refill request has been reviewed.

*Request ID:* ${row.request_id}
*Status:* ${status}
*Approved Amount:* ${status === 'Approved' ? '₹' + approvedAmount : 'N/A'}
*Admin Remarks:* ${adminRemarks || 'None'}

Thank you.`;

  try {
    const payload = new URLSearchParams();
    payload.append("secret", secret);
    payload.append("account", account);
    payload.append("recipient", digits);
    payload.append("message", messageText);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: payload.toString()
    });

    const responseText = await response.text();
    console.log(`Whatsify Employee Notification Response: Status ${response.status} - ${responseText}`);

    if (response.ok) {
      const jsonRes = JSON.parse(responseText);
      if (jsonRes.status === 200 || jsonRes.status === "200" || jsonRes.success === true) {
        return 'Sent';
      } else {
        return `Failed: ${jsonRes.message || 'Error'}`;
      }
    } else {
      return `Failed (HTTP ${response.status})`;
    }
  } catch (err) {
    console.error('Error sending Whatsify notification to employee:', err);
    return `Failed: ${err.message || err}`;
  }
}
