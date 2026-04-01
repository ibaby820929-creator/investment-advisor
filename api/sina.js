export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'missing code' });
  try {
    const r = await fetch(`https://hq.sinajs.cn/rn=${Date.now()}&list=${code}`, {
      headers: { 'Referer': 'https://finance.sina.com.cn/', 'User-Agent': 'Mozilla/5.0' }
    });
    const text = await r.text();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).send(text);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
```

Commit 之后，再去 `index.html` 里把 `fetchStockByCode` 函数中的新浪 URL 改成你自己的代理地址。搜索：
```
https://hq.sinajs.cn/rn=${Date.now()}&list=${sinaCode}
```

替换成：
```
/api/sina?code=${sinaCode}
```

同时删掉后面的 `{headers: {'Referer': 'https://finance.sina.com.cn/'}}`，变成简单的：
```
const sinaRes = await fetch(`/api/sina?code=${sinaCode}`);
