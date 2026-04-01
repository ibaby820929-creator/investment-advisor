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
    const iText = await fetchUrl(`https://hq.sinajs.cn/rn=${Date.now()}&list=${code}_i`);
    let pe = '', pb = '', totalMv = '', turnover = '', eps = '';
    if (iText) {
      try {
        const m = iText.match(/"(.+)"/);
        if (m) {
          const raw = m[1];
          const segments = raw.split(',');
          if (segments.length > 30) {
            eps = segments[30] || '';
          }
          const pipeGroups = raw.split('|');
          for (const pg of pipeGroups) {
            const n = parseFloat(pg);
            if (pg.match(/^\d{10,}$/) || pg.match(/^\d{10,}\.\d+$/)) {
              if (!totalMv) totalMv = pg;
            }
          }
          const epsVal = parseFloat(eps);
          const priceMatch = hqText.match(/"[^"]+"/);
          if (priceMatch) {
            const hqFields = priceMatch[0].replace(/"/g,'').split(',');
            const price = parseFloat(hqFields[3]);
            if (price && epsVal) {
              pe = (price / epsVal).toFixed(2);
            }
            const bvMatch = raw.match(/(\d+\.\d{3})\|(\d+\.\d{3})\|(\d+\.\d{3})\|(\d+\.\d{3})\|(\d+\.\d{3})/);
            if (bvMatch && price) {
              const bv = parseFloat(bvMatch[1]);
              if (bv > 0) pb = (price / bv).toFixed(2);
            }
          }
          const mvMatch = raw.match(/\|(\d{11,})\|/g);
          if (mvMatch) {
            for (const mv of mvMatch) {
              const clean = mv.replace(/\|/g, '');
              if (!totalMv || clean.length < totalMv.length) totalMv = clean;
            }
          }
        }
      } catch(e) {}
    }
    res.status(200).json({ hq: hqText, pe, pb, totalMv, turnover });
  } else {
    res.status(200).send(hqText);
  }
};
