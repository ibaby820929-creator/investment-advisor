const https = require('https');
const iconv = require('iconv-lite');

module.exports = (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'missing code' });

  const url = `https://hq.sinajs.cn/rn=${Date.now()}&list=${code}`;
  https.get(url, {
    headers: { 'Referer': 'https://finance.sina.com.cn/', 'User-Agent': 'Mozilla/5.0' }
  }, (resp) => {
    const chunks = [];
    resp.on('data', c => chunks.push(c));
    resp.on('end', () => {
      const buf = Buffer.concat(chunks);
      const text = iconv.decode(buf, 'gbk');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.status(200).send(text);
    });
  }).on('error', (e) => {
    res.status(500).json({ error: e.message });
  });
};
