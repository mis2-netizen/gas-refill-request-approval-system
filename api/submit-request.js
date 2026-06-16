/**
 * Vercel Serverless Function: api/submit-request.js
 * Saves employee gas refill request to Supabase and returns sequential GAS-XXXX ID.
 */
export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(455).json({ success: false, message: 'Method Not Allowed. Use POST.' });
  }

  const { employeeName, employeeMobile, branch, cylinderType, quantity, expectedAmount, remarks } = req.body;

  // Validation
  if (!employeeName || !employeeMobile || !branch || !cylinderType || !quantity || !expectedAmount) {
    return res.status(400).json({ success: false, message: 'Missing required form fields.' });
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
    // 1. Fetch the last inserted record to calculate the next sequence ID
    const selectUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/gas_refill_requests?select=request_id&order=id.desc&limit=1`;
    const lastRowRes = await fetch(selectUrl, {
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });

    if (!lastRowRes.ok) {
      const errText = await lastRowRes.text();
      throw new Error(`Failed to query sequence from Supabase: ${errText}`);
    }

    const lastRows = await lastRowRes.json();
    let nextIdNum = 1;

    if (lastRows && lastRows.length > 0) {
      const lastIdVal = lastRows[0].request_id.toString();
      const match = lastIdVal.match(/^GAS-(\d+)$/i);
      if (match) {
        nextIdNum = parseInt(match[1], 10) + 1;
      }
    }

    const padZero = (num, size) => {
      let s = num + "";
      while (s.length < size) s = "0" + s;
      return s;
    };

    const requestId = `GAS-${padZero(nextIdNum, 4)}`;

    // 2. Insert the new row into Supabase
    const insertUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/gas_refill_requests`;
    const insertPayload = {
      request_id: requestId,
      employee_name: employeeName,
      employee_mobile: employeeMobile,
      branch: branch,
      cylinder_type: cylinderType,
      quantity: Number(quantity),
      expected_amount: Number(expectedAmount),
      remarks: remarks || '',
      status: 'Pending',
      whatsapp_status: 'Pending Approval'
    };

    const insertRes = await fetch(insertUrl, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(insertPayload)
    });

    if (!insertRes.ok) {
      const errText = await insertRes.text();
      throw new Error(`Failed to insert request: ${errText}`);
    }

    // Notify Admin (Arun) via WhatsApp
    await sendAdminWhatsAppNotification(requestId, employeeName, branch, cylinderType, quantity, expectedAmount);

    return res.status(200).json({
      success: true,
      requestId: requestId
    });

  } catch (error) {
    console.error('Error in submit-request API:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal Server Error'
    });
  }
}

async function sendAdminWhatsAppNotification(requestId, employeeName, branch, cylinderType, quantity, expectedAmount) {
  const secret = process.env.WHATSIFY_SECRET || "b26433c6-7cb5-4db0-8ff0-8c200d4cfb98";
  const account = process.env.WHATSIFY_ACCOUNT || "1742193706259b3921152244c2f76a1b9270dd3b10e3d1642a";
  const url = "https://whatsify.me/api/send/whatsapp";
  const recipient = "+918800166247"; // Admin Arun

  const messageText = `*New Gas Refill Request Submitted*

Hello Arun,
A new gas refill request has been submitted.

*Request ID:* ${requestId}
*Employee Name:* ${employeeName}
*Centre/Branch:* ${branch}
*Cylinder:* ${quantity} Kg (${cylinderType})
*Expected Amount:* ₹${expectedAmount}

Please log in to the admin panel to approve or reject this request.`;

  try {
    const payload = new URLSearchParams();
    payload.append("secret", secret);
    payload.append("account", account);
    payload.append("recipient", recipient);
    payload.append("message", messageText);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: payload.toString(),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const responseText = await response.text();
    console.log(`Whatsify Admin Notification Response: Status ${response.status} - ${responseText}`);
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn('Whatsify admin notification timed out after 1.5s');
    } else {
      console.error('Error sending Whatsify notification to admin:', err);
    }
  }
}
