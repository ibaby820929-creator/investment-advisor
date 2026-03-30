const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: '请提供股票代码' });

  let qqCode = code.toLowerCase();
  if (/^\d{6}$/.test(qqCode)) {
    qqCode = (qqCode.startsWith('6') || qqCode.startsWith('5') || qqCode.startsWith('9'))
      ? 'sh' + qqCode : 'sz' + qqCode;
  }

  try {
    const url = `https://qt.gtimg.cn/q=${qqCode}`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const raw = await resp.text();

    if (!raw || raw.includes('none_match')) return res.json({ error: '未找到该股票' });
    const match = raw.match(/="(.+)"/);
    if (!match) return res.json({ error: '数据解析失败' });

    const parts = match[1].split('~');
    res.json({
      name: parts[1], code: parts[2], price: parseFloat(parts[3]),
      prevClose: parseFloat(parts[4]), open: parseFloat(parts[5]),
      volume: parts[6], high: parseFloat(parts[33]), low: parseFloat(parts[34]),
      pe: parseFloat(parts[39]) || null, pb: parseFloat(parts[46]) || null,
      totalMarketCap: parts[45], circulatingMarketCap: parts[44],
      turnoverRate: parseFloat(parts[38]) || null,
      change: parseFloat(parts[31]), changePercent: parseFloat(parts[32]),
      amplitude: parts[43]
    });
  } catch (err) {
    res.json({ error: '获取基本面数据失败: ' + err.message });
  }
};
