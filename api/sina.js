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
        try { resolve(new TextDecoder('gbk').decode(buf)); }
        catch(e) { resolve(buf.toString()); }
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
    const rawCode = code.replace(/^sh|^sz/, '');
    const market = code.startsWith('sh') ? 'sh' : 'sz';
    const fUrl = `https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=${code}&scale=240&ma=5&datalen=1`;
    const iUrl = `http://push2.eastmoney.com/api/qt/stock/get?secid=${market === 'sh' ? '1' : '0'}.${rawCode}&ut=fa5fd1943c7b386f172d6893dbfba10b&fltt=2&invt=2&fields=f162,f167,f168,f116,f117`;
    
    let pe = '', pb = '', totalMv = '', turnover = '';
    try {
      const iText = await fetchUrl(iUrl);
      const iJson = JSON.parse(iText);
      if (iJson && iJson.data) {
        pe = iJson.data.f162 || '';
        pb = iJson.data.f167 || '';
        turnover = iJson.data.f168 || '';
        totalMv = iJson.data.f116 || '';
      }
    } catch(e) {}

    res.status(200).json({ hq: hqText, pe, pb, totalMv, turnover });
  } else {
    res.status(200).send(hqText);
  }
};
