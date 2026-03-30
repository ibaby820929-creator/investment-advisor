const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { apiKey, messages, system } = req.body;
  if (!apiKey) return res.status(400).json({ error: '请提供API Key' });

  const postData = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: system || '',
    messages: messages || []
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 60000
    };

    const apiReq = https.request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try {
          res.json(JSON.parse(data));
        } catch (e) {
          res.json({ error: '解析响应失败' });
        }
        resolve();
      });
    });

    apiReq.on('error', (err) => {
      res.json({ error: 'API请求失败: ' + err.message });
      resolve();
    });

    apiReq.on('timeout', () => {
      apiReq.destroy();
      res.json({ error: 'API请求超时，请重试' });
      resolve();
    });

    apiReq.write(postData);
    apiReq.end();
  });
};
