const https = require('https');
const fs = require('fs');

// ─── 配置 ───────────────────────────────────────────
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const STATE_FILE = './data/kimi-ipo-state.json';

// 监控关键词（用于搜索）
const SEARCH_KEYWORDS = [
  '月之暗面 IPO',
  '月之暗面 上市',
  'Kimi 招股书',
  '月之暗面 港股',
  '月之暗面 融资',
];

// ─── 工具函数 ────────────────────────────────────────

function httpsRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// 读取上次状态（已推送过的新闻标题集合）
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {}
  return { sentTitles: [], lastCheck: null };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── 搜索新闻（用聚合数据或直接抓百度新闻RSS） ──────────────────
async function fetchNews(keyword) {
  // 使用百度新闻RSS
  return new Promise((resolve) => {
    const encodedKeyword = encodeURIComponent(keyword);
    const options = {
      hostname: 'news.baidu.com',
      path: `/search?word=${encodedKeyword}&tn=rss`,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 8000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // 从RSS XML中提取标题和链接
        const items = [];
        const titleMatches = data.matchAll(/<title><!\[CDATA\[(.+?)\]\]><\/title>/g);
        const linkMatches = [...data.matchAll(/<link>(.+?)<\/link>/g)];
        const dateMatches = [...data.matchAll(/<pubDate>(.+?)<\/pubDate>/g)];

        let i = 0;
        for (const match of titleMatches) {
          if (i === 0) { i++; continue; } // 跳过频道标题
          items.push({
            title: match[1].trim(),
            link: linkMatches[i] ? linkMatches[i][1].trim() : '',
            date: dateMatches[i - 1] ? dateMatches[i - 1][1].trim() : '',
          });
          i++;
          if (items.length >= 5) break;
        }
        resolve(items);
      });
    });
    req.on('error', () => resolve([]));
    req.setTimeout(8000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

// ─── 用Claude判断是否是有价值的新动态 ──────────────────────────
async function analyzeWithClaude(newItems) {
  const prompt = `你是一个帮助监控Kimi（月之暗面）上市动态的助手。

以下是今天抓取到的新闻标题列表：
${newItems.map((item, i) => `${i + 1}. ${item.title} (${item.date})`).join('\n')}

请判断：
1. 哪些是关于月之暗面/Kimi的重要资本动态（IPO进展、新融资、递交招股书、上市时间表、估值变化等）
2. 过滤掉无关新闻或纯产品功能更新

返回格式（JSON）：
{
  "important": [
    { "title": "标题", "reason": "重要原因（一句话）" }
  ],
  "hasImportant": true/false
}

只返回JSON，不要其他文字。`;

  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  try {
    const response = await httpsRequest(options, body);
    const text = response.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error('Claude分析失败:', e.message);
    return { hasImportant: false, important: [] };
  }
}

// ─── 发送Telegram消息 ────────────────────────────────
async function sendTelegram(message) {
  const body = JSON.stringify({
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: false,
  });

  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  };

  await httpsRequest(options, body);
  console.log('Telegram推送成功');
}

// ─── 主流程 ──────────────────────────────────────────
async function main() {
  console.log(`🔍 开始监控Kimi上市动态... ${new Date().toLocaleString('zh-CN')}`);

  const state = loadState();
  const allItems = [];

  // 抓取所有关键词的新闻
  for (const keyword of SEARCH_KEYWORDS) {
    const items = await fetchNews(keyword);
    for (const item of items) {
      // 过滤掉已推送过的
      if (!state.sentTitles.includes(item.title) && item.title) {
        allItems.push(item);
      }
    }
  }

  // 去重
  const uniqueItems = [...new Map(allItems.map(item => [item.title, item])).values()];
  console.log(`共抓取到 ${uniqueItems.length} 条新消息`);

  if (uniqueItems.length === 0) {
    console.log('没有新动态，本次监控结束');
    state.lastCheck = new Date().toISOString();
    saveState(state);
    return;
  }

  // 用Claude过滤出重要的
  const analysis = await analyzeWithClaude(uniqueItems);

  if (!analysis.hasImportant || analysis.important.length === 0) {
    console.log('无重要资本动态，跳过推送');
    // 仍然记录已检查过的标题，避免重复分析
    for (const item of uniqueItems) {
      if (!state.sentTitles.includes(item.title)) {
        state.sentTitles.push(item.title);
      }
    }
  } else {
    // 构建推送消息
    let message = `🚨 <b>Kimi上市动态预警</b>\n`;
    message += `📅 ${new Date().toLocaleString('zh-CN')}\n\n`;

    for (const item of analysis.important) {
      const original = uniqueItems.find(i => i.title === item.title);
      message += `📌 <b>${item.title}</b>\n`;
      message += `💡 ${item.reason}\n`;
      if (original && original.link) {
        message += `🔗 ${original.link}\n`;
      }
      message += '\n';

      // 记录已推送
      if (!state.sentTitles.includes(item.title)) {
        state.sentTitles.push(item.title);
      }
    }

    message += `─────────────\n监控关键词：月之暗面 IPO/上市/融资`;

    await sendTelegram(message);
  }

  // 只保留最近500条已推送标题，避免文件过大
  if (state.sentTitles.length > 500) {
    state.sentTitles = state.sentTitles.slice(-500);
  }

  state.lastCheck = new Date().toISOString();
  saveState(state);
  console.log('✅ 监控完成');
}

main().catch(err => {
  console.error('监控脚本出错:', err);
  process.exit(1);
});
