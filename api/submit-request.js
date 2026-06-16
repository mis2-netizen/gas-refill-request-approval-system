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

/**
 * Sends a WhatsApp notification to Admin Arun using Meta Cloud API
 */
async function sendAdminWhatsAppNotification(requestId, employeeName, branch, cylinderType, quantity, expectedAmount) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const adminTemplateName = process.env.WHATSAPP_ADMIN_TEMPLATE_NAME || 'new_refill_request_admin';
  const languageCode = process.env.WHATSAPP_LANGUAGE_CODE || 'en';

  if (!phoneNumberId || !accessToken) {
    console.log('--- WHATSAPP ADMIN NOTIFICATION SIMULATION ---');
    console.log('To: 918800166247 (Arun)');
    console.log(`Template: ${adminTemplateName}`);
    console.log(`Params: [Arun, ${requestId}, ${employeeName}, ${branch}, ${quantity} Kg of ${cylinderType}, ₹${expectedAmount}]`);
    console.log('----------------------------------------------');
    return;
  }

  const apiUrl = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
  
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "918800166247",
    type: "template",
    template: {
      name: adminTemplateName,
      language: {
        code: languageCode
      },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: "Arun" },
            { type: "text", text: requestId },
            { type: "text", text: employeeName },
            { type: "text", text: branch },
            { type: "text", text: `${quantity} Kg of ${cylinderType}` },
            { type: "text", text: `₹${expectedAmount}` }
          ]
        }
      ]
    }
  };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const responseText = await response.text();
    console.log(`Admin WhatsApp API Response Code: ${response.status} - ${responseText}`);
  } catch (err) {
    console.error('Error sending WhatsApp notification to admin:', err);
  }
}
