// ============================================================
// 📊 投资智能体 V2.1 - 市场监控系统
// 数据源：新浪财经（全球可访问） + 新浪滚动新闻
// 推送：Telegram + Gmail
// 部署：GitHub Actions
// ============================================================
const https = require('https');

const CONFIG = {
  watchlist: {
    a_shares: [
      { sina: 'sh601398', name: '工商银行', category: '银行股' },
      { sina: 'sh601939', name: '建设银行', category: '银行股' },
      { sina: 'sh601288', name: '农业银行', category: '银行股' },
      { sina: 'sh601988', name: '中国银行', category: '银行股' },
      { sina: 'sh601328', name: '交通银行', category: '银行股' },
      { sina: 'sh601998', name: '中信银行', category: '银行股' },
      { sina: 'sh601818', name: '光大银行', category: '银行股' },
      { sina: 'sh688795', name: '摩尔线程', category: 'GPU芯片' },
      { sina: 'sh688981', name: '沐曦股份', category: 'GPU芯片' },
      { sina: 'sh688256', name: '寒武纪',   category: 'AI芯片' },
      { sina: 'sh688041', name: '海光信息', category: 'AI芯片' },
    ],
    hk_shares: [
      { sina: 'rt_hk02513', name: '智谱AI',   category: 'AI大模型' },
      { sina: 'rt_hk00100', name: 'MiniMax',   category: 'AI大模型' },
      { sina: 'rt_hk06082', name: '壁仞科技', category: 'GPU芯片' },
      { sina: 'rt_hk02169', name: '天数智芯', category: 'AI芯片' },
    ],
    indices: [
      { sina: 's_sh000001', name: '上证指数', category: '指数' },
      { sina: 's_sz399001', name: '深证成指', category: '指数' },
      { sina: 's_sz399006', name: '创业板指', category: '指数' },
      { sina: 's_sh000688', name: '科创50',   category: '指数' },
      { sina: 'rt_hkHSI',   name: '恒生指数', category: '港股指数' },
      { sina: 'rt_hkHSTECH', name: '恒生科技', category: '港股指数' },
    ],
    commodities: [
      { sina: 'hf_GC', name: '国际金价', category: '黄金' },
      { sina: 'hf_SI', name: '国际银价', category: '白银' },
    ],
    ipo_watchlist: [
      { name: '燧原科技', status: '科创板已问询', note: '腾讯系GPU' },
      { name: '昆仑芯',   status: '港股递表中',   note: '百度系AI芯片' },
      { name: '宇树科技', status: '排队中',       note: '人形机器人' },
      { name: '月之暗面', status: '讨论中',       note: 'Moonshot大模型' },
      { name: '长鑫存储', status: '排队中',       note: '存储芯片' },
    ],
  },
  alerts: { index: 2.0, stock: 5.0, tech: 8.0, gold: 2.0 },
  telegram: { bot_token: process.env.TELEGRAM_BOT_TOKEN, chat_id: process.env.TELEGRAM_CHAT_ID },
  gmail: { user: process.env.GMAIL_USER, app_password: process.env.GMAIL_APP_PASSWORD },
  anthropic_key: process.env.ANTHROPIC_API_KEY,
};

// ==================== 新浪财经API ====================
function sinaFetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'Referer': 'https://finance.sina.com.cn/', 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

async function getSinaQuotes(items) {
  if (!items.length) return [];
  const codes = items.map(i => i.sina).join(',');
  const url = `https://hq.sinajs.cn/rn=${Date.now()}&list=${codes}`;
  try {
    const raw = await sinaFetch(url);
    if (!raw || raw.includes('Kinsoku') || raw.length < 10) {
      console.error('新浪返回异常:', raw?.substring(0, 80));
      return [];
    }
    const results = [];
    for (const line of raw.split(';\n')) {
      const m = line.match(/var hq_str_(.+?)="(.+)"/);
      if (!m) continue;
      const cfg = items.find(i => i.sina === m[1]);
      if (!cfg) continue;
      const d = m[2].split(',');
      if (d.length < 3) continue;
      const p = parseSinaData(m[1], d, cfg);
      if (p) results.push(p);
    }
    return results;
  } catch (e) {
    console.error('新浪请求失败:', e.message);
    return [];
  }
}

function parseSinaData(code, f, cfg) {
  try {
    // A股个股
    if (/^s[hz]\d/.test(code) && f.length >= 30) {
      const price = +f[3], pre = +f[2];
      return { configName: cfg.name, code, price, preClose: pre, open: +f[1], high: +f[4], low: +f[5],
        volume: +f[8], amount: +f[9], changePercent: pre ? (((price-pre)/pre)*100).toFixed(2) : '0.00',
        category: cfg.category, date: f[30], time: f[31] };
    }
    // 指数简版
    if (code.startsWith('s_') && f.length >= 4) {
      return { configName: cfg.name, code, price: +f[1], changePercent: (+f[3]).toFixed(2),
        volume: +f[4], amount: +f[5], category: cfg.category };
    }
    // 港股
    if (code.startsWith('rt_hk') && f.length >= 9) {
      return { configName: cfg.name, code, price: +f[6], preClose: +f[3], open: +f[2],
        high: +f[4], low: +f[5], changePercent: (+f[8]).toFixed(2), category: cfg.category };
    }
    // 期货/贵金属
    if (code.startsWith('hf_') && f.length >= 6) {
      const price = +f[0], pre = +f[5];
      return { configName: cfg.name, code, price, preClose: pre,
        changePercent: pre ? (((price-pre)/pre)*100).toFixed(2) : '0.00', category: cfg.category };
    }
    return { configName: cfg.name, code, price: +f[1]||+f[0], changePercent: (+f[3]||0).toFixed(2), category: cfg.category };
  } catch(e) { return null; }
}

// ==================== 新闻API ====================
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.sina.com.cn/' },
      timeout: 15000,
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

async function getNews() {
  const classify = (t) => {
    const B = ['央行','降息','降准','美联储','暴跌','暴涨','熔断','战争','制裁'];
    const I = ['利好','利空','涨停','跌停','回购','增持','减持','GDP','CPI','PMI','黄金','AI','芯片','半导体','GPU','大模型',
      '摩尔线程','智谱','MiniMax','壁仞','沐曦','燧原','昆仑芯','寒武纪','海光','IPO','上市','科创板','港交所','机器人','宇树'];
    if (B.some(k => t.includes(k))) return 'breaking';
    if (I.some(k => t.includes(k))) return 'important';
    return 'normal';
  };
  // 新浪7x24财经快讯
  try {
    const r = await fetchJSON(`https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=20&zhibo_id=152&tag_id=0&dire=f&dpc=1&type=0&_=${Date.now()}`);
    if (r?.result?.data?.feed?.list) {
      return r.result.data.feed.list.map(i => {
        const txt = (i.rich_text||i.text||'').replace(/<[^>]+>/g, '');
        return { title: txt.substring(0, 120), content: txt, time: i.create_time||'', source: '新浪7x24', level: classify(txt) };
      });
    }
  } catch(e) { console.error('新闻获取失败:', e.message); }
  // 备用: 新浪滚动新闻
  try {
    const r = await fetchJSON(`https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&num=15&page=1&r=${Math.random()}`);
    if (r?.result?.data) {
      return r.result.data.map(i => ({
        title: i.title||'', content: i.summary||'', time: i.ctime ? new Date(i.ctime*1000).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}) : '',
        source: i.media_name||'新浪', level: classify(i.title||''),
      }));
    }
  } catch(e) { console.error('备用新闻也失败:', e.message); }
  return [];
}

// ==================== AI分析 ====================
async function aiAnalyze(md, news, apiKey) {
  if (!apiKey) return basicAnalysis(md, news);
  const prompt = `你是Jessica的私人投资顾问AI。基于以下数据分析市场。
## 框架: 2025-26慢牛入场，2027.3财富分化拐点，2028谨慎
重点：银行股(防守)+AI大模型(智谱02513.HK/MiniMax00100.HK)+GPU(摩尔线程688795)+黄金
即将上市：燧原科技(腾讯系)、昆仑芯(百度系)
## 指数
${md.indices.map(i=>`${i.configName}: ${i.price} (${i.changePercent>0?'+':''}${i.changePercent}%)`).join('\n')}
## A股
${md.stocks.map(s=>`${s.configName}(${s.category}): ${s.price} (${s.changePercent>0?'+':''}${s.changePercent}%)`).join('\n')}
## 港股
${md.hk_stocks.map(s=>`${s.configName}(${s.category}): ${s.price} (${s.changePercent>0?'+':''}${s.changePercent}%)`).join('\n')}
## 黄金
${md.commodities.map(c=>`${c.configName}: ${c.price} (${c.changePercent>0?'+':''}${c.changePercent}%)`).join('\n')}
## 快讯
${news.filter(n=>n.level!=='normal').slice(0,8).map(n=>`[${n.level==='breaking'?'🔴':'🟡'}] ${n.title}`).join('\n')||'暂无'}

请用中文: 1.📊今日概况(3句) 2.🔔重要信号 3.💡操作建议 4.⚠️风险提示。不超300字。`;

  try {
    const body = JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:800, messages:[{role:'user',content:prompt}] });
    const data = await new Promise((resolve, reject) => {
      const req = https.request({ hostname:'api.anthropic.com', path:'/v1/messages', method:'POST',
        headers:{ 'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','Content-Length':Buffer.byteLength(body) },
        timeout:30000 }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch(e){reject(e)} }); });
      req.on('error',reject); req.on('timeout',()=>{req.destroy();reject(new Error('AI超时'))}); req.write(body); req.end();
    });
    if (data?.content?.[0]?.text) return data.content[0].text;
    return basicAnalysis(md, news);
  } catch(e) { console.error('AI失败:', e.message); return basicAnalysis(md, news); }
}

function basicAnalysis(md, news) {
  let r = '📊 市场快报\n\n';
  if (md.indices[0]) { const s=md.indices[0]; r+=`${s.configName} ${s.changePercent>0?'📈':'📉'} ${s.changePercent}%，报${s.price}\n`; }
  const banks = md.stocks.filter(s=>s.category==='银行股');
  if (banks.length) { const avg=(banks.reduce((a,b)=>a+parseFloat(b.changePercent||0),0)/banks.length).toFixed(2); r+=`🏦 银行股均值: ${avg>0?'+':''}${avg}%\n`; }
  const techs = [...md.stocks.filter(s=>s.category!=='银行股'), ...md.hk_stocks];
  techs.forEach(t=>{ r+=`🔬 ${t.configName}: ${t.price} (${t.changePercent>0?'+':''}${t.changePercent}%)\n`; });
  news.filter(n=>n.level!=='normal').slice(0,3).forEach(n=>{ r+=`📰 ${n.title}\n`; });
  return r;
}

// ==================== 推送 ====================
async function sendTelegram(msg) {
  const {bot_token,chat_id}=CONFIG.telegram;
  if(!bot_token||!chat_id){console.log('Telegram未配置');return;}
  const send = (text,mode) => new Promise(resolve => {
    const body=JSON.stringify({chat_id,text,parse_mode:mode||undefined,disable_web_page_preview:true});
    const req=https.request({hostname:'api.telegram.org',path:`/bot${bot_token}/sendMessage`,method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},timeout:15000},
      res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{const r=JSON.parse(d);resolve(r.ok)}catch(e){resolve(false)}})});
    req.on('error',()=>resolve(false));req.on('timeout',()=>{req.destroy();resolve(false)});req.write(body);req.end();
  });
  let ok = await send(msg, 'Markdown');
  if (!ok) { console.log('Markdown失败，用纯文本重试'); ok = await send(msg.replace(/[*_`\[\]]/g,''), ''); }
  if (ok) console.log('✅ Telegram推送成功'); else console.error('❌ Telegram推送失败');
}

// ==================== 主流程 ====================
async function main() {
  console.log('🚀 投资智能体 V2.1 启动');
  console.log(`⏰ ${new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}`);
  console.log('数据源: 新浪财经 (全球可访问)');
  console.log('---');

  console.log('📡 获取数据...');
  const [indices, stocks, hkStocks, commodities, news] = await Promise.all([
    getSinaQuotes(CONFIG.watchlist.indices),
    getSinaQuotes(CONFIG.watchlist.a_shares),
    getSinaQuotes(CONFIG.watchlist.hk_shares),
    getSinaQuotes(CONFIG.watchlist.commodities),
    getNews(),
  ]);

  const md = { indices, stocks, hk_stocks: hkStocks, commodities };
  console.log(`✅ 获取完成: ${indices.length}指数 ${stocks.length}A股 ${hkStocks.length}港股 ${commodities.length}商品 ${news.length}新闻`);

  // IPO追踪
  const ipoAlerts = [];
  CONFIG.watchlist.ipo_watchlist.forEach(ipo => {
    news.forEach(n => { if ((n.title+n.content).includes(ipo.name)) ipoAlerts.push({name:ipo.name,news:n.title}); });
  });

  // 预警
  const alerts = [];
  const chk = (list,thr,pre='') => (list||[]).forEach(s => {
    const p=Math.abs(parseFloat(s.changePercent)||0);
    if(p>=thr) alerts.push({level:p>=thr*1.5?'🔴':'🟡',message:`${pre}${s.configName} ${s.changePercent>0?'涨':'跌'}${s.changePercent}%`});
  });
  chk(indices, CONFIG.alerts.index);
  chk(stocks.filter(s=>s.category==='银行股'), CONFIG.alerts.stock);
  chk(stocks.filter(s=>s.category!=='银行股'), CONFIG.alerts.tech);
  chk(hkStocks, CONFIG.alerts.tech, '🇭🇰');
  chk(commodities, CONFIG.alerts.gold);

  // AI分析
  console.log('🤖 AI分析...');
  const ai = await aiAnalyze(md, news, CONFIG.anthropic_key);

  // 构建消息
  const now = new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'});
  const fl = s => { const e=s.changePercent>0?'🔴':s.changePercent<0?'🟢':'⚪'; return `${e} ${s.configName}: ${s.price} (${s.changePercent>0?'+':''}${s.changePercent}%)\n`; };

  let msg = `📊 *投资智能体 V2.1*\n⏰ ${now}\n📡 新浪财经\n\n`;
  if(alerts.length){msg+=`🚨 *预警*\n`;alerts.forEach(a=>{msg+=`${a.level} ${a.message}\n`});msg+='\n';}
  if(ipoAlerts.length){msg+=`🆕 *IPO动态*\n`;ipoAlerts.forEach(a=>{msg+=`📌 ${a.name}: ${a.news}\n`});msg+='\n';}
  if(indices.length){msg+=`📈 *指数*\n`;indices.forEach(i=>{msg+=fl(i)});msg+='\n';}
  const banks=stocks.filter(s=>s.category==='银行股');
  if(banks.length){msg+=`🏦 *银行股*\n`;banks.forEach(s=>{msg+=fl(s)});msg+='\n';}
  const aTech=stocks.filter(s=>s.category!=='银行股');
  if(aTech.length){msg+=`🔬 *A股科技*\n`;aTech.forEach(s=>{msg+=fl(s)});msg+='\n';}
  if(hkStocks.length){msg+=`🇭🇰 *港股科技*\n`;hkStocks.forEach(s=>{msg+=fl(s)});msg+='\n';}
  if(commodities.length){msg+=`💰 *贵金属*\n`;commodities.forEach(c=>{msg+=fl(c)});msg+='\n';}
  msg+=`🤖 *AI分析*\n${ai}\n`;
  const top=news.filter(n=>n.level!=='normal').slice(0,5);
  if(top.length){msg+=`\n📰 *重要快讯*\n`;top.forEach(n=>{msg+=`• ${n.title}\n`});}

  console.log('📤 推送...');
  console.log(msg.substring(0, 400) + '...');
  await sendTelegram(msg);

  console.log('\n✅ 完成!');
}

main().catch(e => { console.error('❌', e); process.exit(1); });
