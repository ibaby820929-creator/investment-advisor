const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  const { keyword } = req.query;
  if (!keyword) return res.status(400).json({ results: [] });

  try {
    const url = `https://smartbox.gtimg.cn/s3/?v=2&q=${encodeURIComponent(keyword)}&t=all&c=1`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const raw = await resp.text();

    if (!raw) return res.json({ results: [] });
    const match = raw.match(/v_hint="(.*)"/);
    if (!match || !match[1]) return res.json({ results: [] });

    const items = match[1].split('^').filter(Boolean);
    const results = items.slice(0, 10).map(item => {
      const p = item.split('~');
      return { market: p[0], code: p[1], name: p[2], fullCode: p[0] + p[1] };
    });
    res.json({ results });
  } catch (err) {
    res.json({ results: [], error: err.message });
  }
};
