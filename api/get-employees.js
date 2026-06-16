/**
 * Vercel Serverless Function: api/get-employees.js
 * Returns list of active employees from Supabase active_employees table.
 */
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed. Use GET.' });
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
    const url = `${supabaseUrl.replace(/\/$/, '')}/rest/v1/active_employees?select=*`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Failed to fetch active employees from Supabase: ${errText}`);
    }

    const data = await response.json();
    return res.status(200).json({ success: true, data: data });

  } catch (error) {
    console.error('Error in get-employees API:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Internal Server Error'
    });
  }
}
