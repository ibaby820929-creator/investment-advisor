const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    // Fetch the latest report from the GitHub repo
    const url = 'https://raw.githubusercontent.com/ibaby820929-creator/investment-advisor/main/data/latest-report.json';
    
    const resp = await new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r) => {
        // Handle redirects
        if (r.statusCode === 301 || r.statusCode === 302) {
          https.get(r.headers.location, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (r2) => {
            let data = '';
            r2.on('data', chunk => data += chunk);
            r2.on('end', () => resolve(data));
          }).on('error', reject);
          return;
        }
        let data = '';
        r.on('data', chunk => data += chunk);
        r.on('end', () => resolve(data));
      }).on('error', reject);
    });

    const parsed = JSON.parse(resp);
    res.json(parsed);
  } catch (err) {
    res.json({ error: '暂无分析报告', timestamp: null, content: null });
  }
};
