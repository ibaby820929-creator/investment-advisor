const https = require('https');
const iconv = require('iconv-lite');

module.exports = (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'missing code' });

  const urls = [
    `https://hq.sinajs.cn/rn=${Date.now()}&list=${code}`,
    `https://finance.sina.com.cn/realstock/company/${code}/jsvar.js`
  ];

  const fetchUrl = (url) => new Promise((resolve) => {
    https.get(url, {
      headers: { 'Referer': 'https://finance.sina.com.cn/', 'User-Agent': 'Mozilla/5.0' }
    }, (resp) => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => resolve(iconv.decode(Buffer.concat(chunks), 'gbk')));
    }).on('error', () => resolve(''));
  });

  fetchUrl(urls[0]).then(text => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.status(200).send(text);
  });
};
