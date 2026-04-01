const https = require('https');

function fetchUrl(url) {
  return new Promise((resolve) => {
    https.get(url, {
      headers: { 'Referer': 'https://finance.sina.com.cn/', 'User-Agent': 'Mozilla/5.0' }
    }, (resp) => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        const buf = Buffer.concat(chunks);
        const decoder = new TextDecoder('gbk');
        resolve(decoder.decode(buf));
      });
    }).on('error', () => resolve(''));
  });
}

module.exports = async (req, res) => {
  const { code, detail } = req.query;
  if (!code) return res.status(400).json({ error: 'missing code' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const hqText = await fetchUrl(`https://hq.sinajs.cn/rn=${Date.now()}&list=${code}`);

  if (detail === '1') {
    const fText = await fetchUrl(`https://finance.sina.com.cn/realstock/company/${code}/jsvar.js`);
    let pe = '', pb = '', totalMv = '', turnover = '', eps = '';
    const peM = fText.match(/pe_d[^=]*=\s*"?([0-9.]+)/);
    const pbM = fText.match(/pb[^=]*=\s*"?([0-9.]+)/);
    const mvM = fText.match(/totalMarketCap[^=]*=\s*"?([0-9.]+)/);
    const toM = fText.match(/turnover[^=]*=\s*"?([0-9.]+)/);
    if (peM) pe = peM[1];
    if (pbM) pb = pbM[1];
    if (mvM) totalMv = mvM[1];
    if (toM) turnover = toM[1];
    res.status(200).json({ hq: hqText, pe, pb, totalMv, turnover });
  } else {
    res.status(200).send(hqText);
  }
};

