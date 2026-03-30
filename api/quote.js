const fetch = require('node-fetch');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: '请提供股票代码' });

  let sinaCode = code.toLowerCase();
  if (/^\d{6}$/.test(sinaCode)) {
    sinaCode = (sinaCode.startsWith('6') || sinaCode.startsWith('5') || sinaCode.startsWith('9'))
      ? 'sh' + sinaCode : 'sz' + sinaCode;
  } else if (/^\d{5}$/.test(sinaCode)) {
    sinaCode = 'hk' + sinaCode;
  }

  try {
    const url = `https://hq.sinajs.cn/list=${sinaCode}`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://finance.sina.com.cn'
      }
    });
    const raw = await resp.text();

    if (!raw || raw.includes('=""')) return res.json({ error: '未找到该股票' });
    const match = raw.match(/"(.+)"/);
    if (!match) return res.json({ error: '数据解析失败' });

    const parts = match[1].split(',');
    let result = {};

    if (sinaCode.startsWith('sh') || sinaCode.startsWith('sz')) {
      result = {
        name: parts[0], open: parseFloat(parts[1]), prevClose: parseFloat(parts[2]),
        price: parseFloat(parts[3]), high: parseFloat(parts[4]), low: parseFloat(parts[5]),
        volume: parseInt(parts[8]), turnover: parseFloat(parts[9]),
        date: parts[30], time: parts[31], code: sinaCode, market: 'A股',
        change: (parseFloat(parts[3]) - parseFloat(parts[2])).toFixed(2),
        changePercent: (((parseFloat(parts[3]) - parseFloat(parts[2])) / parseFloat(parts[2])) * 100).toFixed(2)
      };
    } else if (sinaCode.startsWith('hk')) {
      result = {
        name: parts[1], open: parseFloat(parts[2]), prevClose: parseFloat(parts[3]),
        price: parseFloat(parts[6]), high: parseFloat(parts[4]), low: parseFloat(parts[5]),
        volume: parseInt(parts[12]), turnover: parseFloat(parts[11]),
        date: parts[17], time: parts[18], code: sinaCode, market: '港股',
        change: (parseFloat(parts[6]) - parseFloat(parts[3])).toFixed(2),
        changePercent: (((parseFloat(parts[6]) - parseFloat(parts[3])) / parseFloat(parts[3])) * 100).toFixed(2)
      };
    }
    res.json(result);
  } catch (err) {
    res.json({ error: '获取行情失败: ' + err.message });
  }
};
