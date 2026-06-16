/**
 * Vercel Serverless Function: api/get-pending.js
 * Verifies admin password and returns all Pending requests from Supabase.
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

  const { password } = req.body;
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  if (password !== adminPassword) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Invalid password.' });
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
    const fetchUrl = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/gas_refill_requests?status=eq.Pending&order=id.asc`;
    const dbRes = await fetch(fetchUrl, {
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });

    if (!dbRes.ok) {
      const errText = await dbRes.text();
      throw new Error(`Failed to fetch pending requests from Supabase: ${errText}`);
    }

    const pending = await dbRes.json();

    const formatDbDate = (dateStr) => {
      try {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        // Format to yyyy-MM-dd HH:mm:ss in local/UTC format
        const pad = (n) => n < 10 ? '0' + n : n;
        return d.getFullYear() + '-' +
          pad(d.getMonth() + 1) + '-' +
          pad(d.getDate()) + ' ' +
          pad(d.getHours()) + ':' +
          pad(d.getMinutes()) + ':' +
          pad(d.getSeconds());
      } catch (e) {
        return dateStr;
      }
    };

    // Serialize to camelCase to match the existing front-end property names
    const mapped = pending.map(row => ({
      requestId: row.request_id,
      dateTime: formatDbDate(row.created_at),
      employeeName: row.employee_name,
      employeeMobile: row.employee_mobile,
      branch: row.branch,
      cylinderType: row.cylinder_type,
      quantity: row.quantity,
      expectedAmount: row.expected_amount,
      remarks: row.remarks,
      status: row.status
    }));

    return res.status(200).json(mapped);

  } catch (error) {
    console.error('Error in get-pending API:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal Server Error'
    });
  }
}
