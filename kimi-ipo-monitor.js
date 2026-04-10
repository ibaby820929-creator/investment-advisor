const https = require('https');
const fs = require('fs');

// ─── 配置 ───────────────────────────────────────────
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const STATE_FILE = './data/kimi-ipo-state.json';

// 监控关键词
const SEARCH_KEYWORDS = [
  '月之暗面 IPO',
  '月之暗面 上市',
  '月之暗面 招股书',
  '月之暗面 融资',
  'Moonshot AI IPO',
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

// ─── 抓取 Google News RSS ────────────────────────────
function fetchGoogleNews(keyword) {
  return new Promise((resolve) => {
    const encodedKeyword = encodeURIComponent(keyword);
    const path = `/rss/search?q=${encodedKeyword}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;

    const options = {
      hostname: 'news.google.com',
      path,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
      timeout: 10000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const items = [];
        const itemBlocks = [...data.matchAll(/<item>([\s\S]*?)<\/item>/g)];
        for (const block of itemBlocks) {
          const content = block[1];

          const titleMatch = content.match(/<title>([\s\S]*?)<\/title>/);
          const linkMatch = content.match(/<link>([\s\S]*?)<\/link>/) ||
                            content.match(/<guid[^>]*>([\s\S]*?)<\/guid>/);
          const dateMatch = content.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
          const sourceMatch = content.match(/<source[^>]*>([\s\S]*?)<\/source>/);

          if (titleMatch) {
            const title = titleMatch[1]
              .replace(/<!\[CDATA\[|\]\]>/g, '')
              .replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .trim();

            if (title.includes('Google 新闻') || title.length < 5) continue;

            items.push({
              title,
              link: linkMatch ? linkMatch[1].trim() : '',
              date: dateMatch ? dateMatch[1].trim() : '',
              source: sourceMatch ? sourceMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '',
            });
          }
          if (items.length >= 8) break;
        }
        resolve(items);
      });
    });

    req.on('error', () => resolve([]));
    req.setTimeout(10000, () => { req.destroy(); resolve([]); });
    req.end();
  });
}

// ─── Claude 分析重要性 ────────────────────────────────
async function analyzeWithClaude(newItems) {
  const prompt = `你是一个帮助监控Kimi（月之暗面）上市动态的助手。

以下是今天抓取到的新闻标题：
${newItems.map((item, i) => `${i + 1}. [${item.source}] ${item.title} (${item.date})`).join('\n')}

请判断哪些是重要资本动态，包括：
- IPO进展、递交招股书、上市时间表确定
- 新一轮融资完成或接近完成
- 估值重大变化
- 港交所或证监会审批动态
- 影响上市进程的重要事件

过滤掉：无关新闻、纯产品更新、重复报道。

IMPORTANT: Return ONLY valid JSON, no other text, no markdown, no explanation.
Format:
{
  "hasImportant": true,
  "important": [
    { "index": 1, "title": "news title here", "reason": "why important in one sentence" }
  ]
}`;

  const body = JSON.stringify({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
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
    console.log('Claude原始返回:', text.substring(0, 200));

    // 多层清理：去掉markdown、中文引号、控制字符
    let clean = text
      .replace(/```json|```/g, '')
      .replace(/[\u201c\u201d\u2018\u2019]/g, '"') // 中文引号转英文
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '') // 控制字符
      .trim();

    // 提取JSON块（防止前后有多余文字）
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (jsonMatch) clean = jsonMatch[0];

    return JSON.parse(clean);
  } catch (e) {
    console.error('Claude分析失败:', e.message);
    return { hasImportant: false, important: [] };
  }
}

// ─── 发送Telegram ─────────────────────────────────────
async function sendTelegram(message) {
  const body = JSON.stringify({
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
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
  console.log('✅ Telegram推送成功');
}

// ─── 主流程 ──────────────────────────────────────────
async function main() {
  console.log(`🔍 Kimi上市监控启动... ${new Date().toLocaleString('zh-CN')}`);

  const state = loadState();
  const allItems = [];

  for (const keyword of SEARCH_KEYWORDS) {
    console.log(`  搜索: ${keyword}`);
    const items = await fetchGoogleNews(keyword);
    console.log(`  → 获取 ${items.length} 条`);

    for (const item of items) {
      if (!state.sentTitles.includes(item.title) && item.title) {
        allItems.push(item);
      }
    }

    await new Promise(r => setTimeout(r, 1500));
  }

  // 按标题去重
  const uniqueItems = [...new Map(allItems.map(item => [item.title, item])).values()];
  console.log(`\n共 ${uniqueItems.length} 条未推送过的新消息`);

  if (uniqueItems.length === 0) {
    console.log('没有新动态，本次监控结束');
    state.lastCheck = new Date().toISOString();
    saveState(state);
    return;
  }

  console.log('正在用Claude分析...');
  const analysis = await analyzeWithClaude(uniqueItems);

  // 无论结果如何，记录已处理标题
  for (const item of uniqueItems) {
    if (!state.sentTitles.includes(item.title)) {
      state.sentTitles.push(item.title);
    }
  }

  if (!analysis.hasImportant || analysis.important.length === 0) {
    console.log('无重要资本动态，本次不推送');
  } else {
    let message = `🚨 <b>Kimi / 月之暗面 上市动态</b>\n`;
    message += `🕐 ${new Date().toLocaleString('zh-CN')}\n`;
    message += `─────────────────\n\n`;

    for (const item of analysis.important) {
      const original = uniqueItems[item.index - 1] || uniqueItems.find(i => i.title === item.title);
      message += `📌 <b>${item.title}</b>\n`;
      if (original?.source) message += `来源：${original.source}\n`;
      message += `💡 ${item.reason}\n`;
      if (original?.link) message += `🔗 <a href="${original.link}">查看原文</a>\n`;
      message += '\n';
    }

    message += `─────────────────\n#Kimi #月之暗面 #IPO`;
    await sendTelegram(message);
  }

  if (state.sentTitles.length > 500) {
    state.sentTitles = state.sentTitles.slice(-500);
  }

  state.lastCheck = new Date().toISOString();
  saveState(state);
  console.log('✅ 本次监控完成');
}

main().catch(err => {
  console.error('脚本出错:', err);
  process.exit(1);
});
