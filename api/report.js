const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  try {
    // Use GitHub API instead of raw.githubusercontent.com to avoid CDN caching
    const url = 'https://api.github.com/repos/ibaby820929-creator/investment-advisor/contents/data/latest-report.json';
    
    const resp = await new Promise((resolve, reject) => {
      https.get(url, { 
        headers: { 
          'User-Agent': 'investment-advisor',
          'Accept': 'application/vnd.github.v3+json'
        } 
      }, (r) => {
        let data = '';
        r.on('data', chunk => data += chunk);
        r.on('end', () => resolve(data));
      }).on('error', reject);
    });

    const githubData = JSON.parse(resp);
    
    if (githubData.content) {
      // GitHub API returns base64 encoded content
      const decoded = Buffer.from(githubData.content, 'base64').toString('utf-8');
      const report = JSON.parse(decoded);
      res.json(report);
    } else {
      res.json({ error: '暂无分析报告', timestamp: null, content: null });
    }
  } catch (err) {
    res.json({ error: '获取报告失败: ' + err.message, timestamp: null, content: null });
  }
};
