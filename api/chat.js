const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { apiKey, messages, system, model } = req.body;
  if (!apiKey) return res.status(400).json({ error: '请提供API Key' });

  // Support model switching: opus or sonnet
  const selectedModel = model === 'opus' 
    ? 'claude-opus-4-20250514' 
    : 'claude-sonnet-4-20250514';

  const postData = JSON.stringify({
    model: selectedModel,
    max_tokens: 4000,
    system: system || '',
    messages: messages || [],
    tools: [{
      type: "web_search_20250305",
      name: "web_search",
      max_uses: 5
    }]
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
      timeout: 120000
    };

    const apiReq = https.request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', chunk => data += chunk);
      apiRes.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.content && Array.isArray(parsed.content)) {
            const textParts = parsed.content
              .filter(block => block.type === 'text')
              .map(block => block.text);
            parsed.content = [{
              type: 'text',
              text: textParts.join('\n')
            }];
          }
          res.json(parsed);
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
