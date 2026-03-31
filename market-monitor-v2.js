// ============================================================
// 📊 投资智能体 - 市场监控系统 V2.0
// 数据源：东方财富（行情） + 财联社（快讯） + 备用源
// 推送：Telegram + Gmail
// 部署：GitHub Actions (每30分钟运行)
// ============================================================

const https = require('https');
const http = require('http');

// ==================== 配置区 ====================
const CONFIG = {
  // 监控的股票列表（根据投资课程重点标的）
  watchlist: {
    // ====== A股 ======
    // secid格式: 1.代码(沪市主板) 或 0.代码(深市/创业板/科创板)
    a_shares: [
      // --- 银行股（防守配置，高股息） ---
      { code: '1.601398', name: '工商银行', category: '银行股' },
      { code: '1.601939', name: '建设银行', category: '银行股' },
      { code: '1.601288', name: '农业银行', category: '银行股' },
      { code: '1.601988', name: '中国银行', category: '银行股' },
      { code: '1.601328', name: '交通银行', category: '银行股' },
      { code: '1.601998', name: '中信银行', category: '银行股' },
      { code: '1.601818', name: '光大银行', category: '银行股' },
      // --- GPU四小龙（A股已上市） ---
      { code: '0.688795', name: '摩尔线程', category: 'GPU芯片' },   // 2025.12.5上市 科创板
      { code: '0.688981', name: '沐曦股份', category: 'GPU芯片' },   // 2025.12.17上市 科创板
      // --- AI芯片龙头 ---
      { code: '0.688256', name: '寒武纪', category: 'AI芯片' },      // AI芯片第一股
      { code: '1.688041', name: '海光信息', category: 'AI芯片' },     // 国产CPU+GPU
    ],
    // ====== 港股 ======
    // secid格式: 116.代码(港股个股)
    hk_shares: [
      // --- 大模型双雄 ---
      { code: '116.02513', name: '智谱AI',   category: 'AI大模型' },   // 2026.1.8上市 港股
      { code: '116.00100', name: 'MiniMax',   category: 'AI大模型' },   // 2026.1.9上市 港股
      // --- GPU四小龙（港股已上市） ---
      { code: '116.06082', name: '壁仞科技', category: 'GPU芯片' },    // 2026.1.2上市 港股
      // --- 其他AI芯片 ---
      { code: '116.02169', name: '天数智芯', category: 'AI芯片' },     // 2026.1.8上市 港股
    ],
    // ====== 重要指数 ======
    indices: [
      { code: '1.000001', name: '上证指数', category: '指数' },
      { code: '0.399001', name: '深证成指', category: '指数' },
      { code: '0.399006', name: '创业板指', category: '指数' },
      { code: '1.000688', name: '科创50',   category: '指数' },
      { code: '100.HSI',  name: '恒生指数', category: '港股指数' },
      { code: '100.HSTECH', name: '恒生科技', category: '港股指数' },
    ],
    // ====== 黄金 & 商品 ======
    commodities: [
      { code: '133.au_shfe', name: '沪金主力', category: '黄金' },
      { code: '100.XAU',    name: '伦敦金',   category: '黄金' },
    ],
    // ====== 即将上市追踪（新闻关键词监控） ======
    ipo_watchlist: [
      { name: '燧原科技', status: '科创板已问询', backer: '腾讯系', note: 'GPU四小龙最后一家，募资60亿' },
      { name: '昆仑芯',   status: '港股递表中',   backer: '百度系', note: 'AI芯片，估值30-165亿美元' },
      { name: '宇树科技', status: '排队中',       backer: '',       note: '人形机器人龙头，具身智能' },
      { name: '月之暗面', status: '讨论中',       backer: '',       note: '大模型六小虎之一(Moonshot)' },
      { name: '长鑫存储', status: '排队中',       backer: '',       note: '存储芯片国产替代' },
    ],
  },

  // 涨跌幅预警阈值
  alerts: {
    index_threshold: 2.0,      // 指数涨跌幅超过2%触发
    stock_threshold: 5.0,      // 个股涨跌幅超过5%触发
    tech_threshold: 8.0,       // 科技股涨跌幅超过8%触发（波动大，阈值高一些）
    gold_threshold: 2.0,       // 黄金涨跌幅超过2%触发
  },

  // 推送配置
  telegram: {
    bot_token: process.env.TELEGRAM_BOT_TOKEN,
    chat_id: process.env.TELEGRAM_CHAT_ID,
  },
  gmail: {
    user: process.env.GMAIL_USER,
    app_password: process.env.GMAIL_APP_PASSWORD,
    to: process.env.GMAIL_TO || process.env.GMAIL_USER,
  },
  anthropic_key: process.env.ANTHROPIC_API_KEY,
};

// ==================== 东方财富 API 模块 ====================
class EastMoneyAPI {
  constructor() {
    this.baseUrl = 'push2.eastmoney.com';
    this.histUrl = 'push2his.eastmoney.com';
  }

  // HTTP GET 请求封装
  _fetch(hostname, path) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname,
        path,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://quote.eastmoney.com/',
        },
        timeout: 15000,
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            // 处理 JSONP 回调格式
            let jsonStr = data;
            if (data.startsWith('jQuery') || data.startsWith('callback')) {
              jsonStr = data.replace(/^[^(]*\(/, '').replace(/\);?\s*$/, '');
            }
            resolve(JSON.parse(jsonStr));
          } catch (e) {
            reject(new Error(`JSON解析失败: ${e.message}, 原始数据前200字符: ${data.substring(0, 200)}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
      req.end();
    });
  }

  // 获取单只股票/指数实时行情
  async getQuote(secid) {
    const fields = 'f43,f44,f45,f46,f47,f48,f50,f51,f52,f55,f57,f58,f60,f116,f117,f162,f167,f168,f169,f170,f171';
    const path = `/api/qt/stock/get?secid=${secid}&ut=fa5fd1943c7b386f172d6893dbfba10b&fltt=2&invt=2&fields=${fields}&_=${Date.now()}`;
    try {
      const result = await this._fetch(this.baseUrl, path);
      if (result && result.data) {
        const d = result.data;
        return {
          code: d.f57,           // 代码
          name: d.f58,           // 名称
          price: d.f43 / 100 || d.f43,    // 最新价（有些接口返回*100）
          open: d.f46,           // 开盘价
          high: d.f44,           // 最高
          low: d.f45,            // 最低
          preClose: d.f60,       // 昨收
          volume: d.f47,         // 成交量
          amount: d.f48,         // 成交额
          changePercent: d.f170, // 涨跌幅%
          change: d.f169,        // 涨跌额
          turnover: d.f168,      // 换手率
          pe: d.f162,            // 市盈率
          marketCap: d.f116,     // 总市值
          circulatingCap: d.f117,// 流通市值
          amplitude: d.f171,     // 振幅%
          high52w: d.f51,        // 52周最高
          low52w: d.f52,         // 52周最低
          _raw: d,
        };
      }
      return null;
    } catch (e) {
      console.error(`获取行情失败 [${secid}]:`, e.message);
      return null;
    }
  }

  // 批量获取行情（更高效）
  async getBatchQuotes(secids) {
    const secidStr = secids.join(',');
    const fields = 'f2,f3,f4,f5,f6,f7,f8,f9,f12,f13,f14,f15,f16,f17,f18,f20,f21,f24,f25';
    const path = `/api/qt/ulist.np/get?fltt=2&invt=2&fields=${fields}&secids=${secidStr}&_=${Date.now()}`;
    try {
      const result = await this._fetch(this.baseUrl, path);
      if (result && result.data && result.data.diff) {
        return result.data.diff.map(d => ({
          code: d.f12,
          name: d.f14,
          price: d.f2,
          changePercent: d.f3,
          change: d.f4,
          volume: d.f5,
          amount: d.f6,
          amplitude: d.f7,
          turnover: d.f8,
          pe: d.f9,
          high: d.f15,
          low: d.f16,
          open: d.f17,
          preClose: d.f18,
          marketCap: d.f20,
          circulatingCap: d.f21,
        }));
      }
      return [];
    } catch (e) {
      console.error('批量获取行情失败:', e.message);
      return [];
    }
  }

  // 获取板块资金流向
  async getSectorFlow() {
    const path = `/api/qt/clist/get?pn=1&pz=10&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f62&fs=m:90+t:2&fields=f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87,f204,f205,f124&_=${Date.now()}`;
    try {
      const result = await this._fetch(this.baseUrl, path);
      if (result && result.data && result.data.diff) {
        return result.data.diff.map(d => ({
          code: d.f12,
          name: d.f14,
          changePercent: d.f3,
          mainNetInflow: d.f62,   // 主力净流入
          mainNetRatio: d.f184,   // 主力净占比
        }));
      }
      return [];
    } catch (e) {
      console.error('获取板块资金流向失败:', e.message);
      return [];
    }
  }

  // 获取涨跌停统计
  async getLimitStats() {
    // 涨停
    const upPath = `/api/qt/clist/get?pn=1&pz=5&po=1&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=m:0+t:6+f:2,m:0+t:80+f:2,m:1+t:2+f:2,m:1+t:23+f:2&fields=f2,f3,f12,f14&_=${Date.now()}`;
    // 跌停
    const downPath = `/api/qt/clist/get?pn=1&pz=5&po=0&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f3&fs=m:0+t:6+f:4,m:0+t:80+f:4,m:1+t:2+f:4,m:1+t:23+f:4&fields=f2,f3,f12,f14&_=${Date.now()}`;

    try {
      const [upResult, downResult] = await Promise.all([
        this._fetch(this.baseUrl, upPath).catch(() => null),
        this._fetch(this.baseUrl, downPath).catch(() => null),
      ]);

      return {
        limitUp: upResult?.data?.total || 0,
        limitDown: downResult?.data?.total || 0,
      };
    } catch (e) {
      console.error('获取涨跌停统计失败:', e.message);
      return { limitUp: '-', limitDown: '-' };
    }
  }
}

// ==================== 财联社快讯 API 模块 ====================
class CLSNewsAPI {
  constructor() {
    // 主接口：觅知API（免费，稳定）
    this.primaryUrl = 'api.98dou.cn';
    // 备用接口：直接请求财联社
    this.backupUrl = 'www.cls.cn';
  }

  _fetch(hostname, path, isHttps = true) {
    return new Promise((resolve, reject) => {
      const module = isHttps ? https : http;
      const options = {
        hostname,
        path,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        timeout: 15000,
      };
      const req = module.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON解析失败: ${e.message}`));
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
      req.end();
    });
  }

  // 获取财联社电报快讯（觅知API）
  async getFlashNews() {
    try {
      const result = await this._fetch(this.primaryUrl, '/api/hotlist/cls/all');
      if (result && result.code === 200 && result.data) {
        return result.data.map(item => ({
          title: item.title || '',
          content: item.desc || item.content || '',
          time: item.hot || '',
          source: '财联社电报',
          level: this._classifyImportance(item.title || item.desc || ''),
        })).slice(0, 30); // 最多取30条
      }
      return [];
    } catch (e) {
      console.error('获取财联社快讯失败(主接口):', e.message);
      return this._getFlashNewsBackup();
    }
  }

  // 备用方案：直接请求财联社nodeapi
  async _getFlashNewsBackup() {
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const path = `/nodeapi/telegraphList?app=CailianpressWeb&category=&lastTime=${timestamp}&last_time=${timestamp}&os=web&refresh_type=1&rn=20&sv=8.4.6`;
      const result = await this._fetch(this.backupUrl, path);
      if (result && result.data && result.data.roll_data) {
        return result.data.roll_data.map(item => ({
          title: item.title || '',
          content: item.brief || item.content || '',
          time: new Date(item.ctime * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
          source: '财联社电报',
          level: item.level === 'B' ? 'important' : (item.level === 'A' ? 'breaking' : 'normal'),
        })).slice(0, 20);
      }
      return [];
    } catch (e) {
      console.error('获取财联社快讯失败(备用接口):', e.message);
      return [];
    }
  }

  // 新闻重要性分类
  _classifyImportance(text) {
    const breakingKeywords = ['央行', '降息', '降准', '美联储', '暴跌', '暴涨', '熔断', '停牌', '退市', '战争', '制裁'];
    const importantKeywords = ['利好', '利空', '涨停', '跌停', '回购', '增持', '减持', '分红', 'GDP', 'CPI', 'PMI', '黄金', 'AI', '芯片', '半导体', 'GPU', '大模型', '摩尔线程', '智谱', 'MiniMax', '壁仞', '沐曦', '燧原', '昆仑芯', '寒武纪', '海光', 'IPO', '上市', '科创板', '港交所'];
    
    if (breakingKeywords.some(k => text.includes(k))) return 'breaking';
    if (importantKeywords.some(k => text.includes(k))) return 'important';
    return 'normal';
  }
}

// ==================== 聚合新闻 API（备用免费源）====================
class JuheNewsAPI {
  // 聚合数据财经新闻（需要注册免费key）
  // 如果你注册了聚合数据，可以在环境变量中设置 JUHE_NEWS_KEY
  constructor() {
    this.apiKey = process.env.JUHE_NEWS_KEY || '';
  }

  async getFinanceNews() {
    if (!this.apiKey) return [];
    return new Promise((resolve) => {
      const options = {
        hostname: 'apis.juhe.cn',
        path: `/fapigx/caijing/query?key=${this.apiKey}&num=10&page=1`,
        method: 'GET',
        timeout: 10000,
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.error_code === 0 && result.result && result.result.newslist) {
              resolve(result.result.newslist.map(item => ({
                title: item.title,
                source: item.source || '聚合财经',
                time: item.ctime,
                url: item.url,
              })));
            } else {
              resolve([]);
            }
          } catch (e) { resolve([]); }
        });
      });
      req.on('error', () => resolve([]));
      req.on('timeout', () => { req.destroy(); resolve([]); });
      req.end();
    });
  }
}

// ==================== AI 分析模块 ====================
class AIAnalyzer {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async analyze(marketData, newsData) {
    if (!this.apiKey) {
      return this._generateBasicAnalysis(marketData, newsData);
    }

    const prompt = this._buildPrompt(marketData, newsData);
    
    try {
      const response = await this._callClaude(prompt);
      return response;
    } catch (e) {
      console.error('AI分析失败:', e.message);
      return this._generateBasicAnalysis(marketData, newsData);
    }
  }

  _buildPrompt(marketData, newsData) {
    const { indices, stocks, hk_stocks, commodities, sectorFlow, limitStats } = marketData;
    const newsText = newsData.slice(0, 15).map(n => `[${n.level === 'breaking' ? '🔴重大' : n.level === 'important' ? '🟡重要' : '⚪'}] ${n.title || n.content}`).join('\n');

    return `你是Jessica的私人投资顾问AI。请基于以下实时市场数据进行分析。

## 投资框架提醒
- 当前阶段（2025-2026）：慢牛入场期，分辨真假价值期
- 重点关注：五大行+中信光大银行股（防守配置），AI大模型（智谱AI 02513.HK、MiniMax 00100.HK），GPU芯片（摩尔线程688795、沐曦688981、壁仞06082.HK），矿产资源（长持对冲），黄金
- 即将上市关注：燧原科技(腾讯系，科创板已问询)、昆仑芯(百度系，港股递表)
- 关键节点：2027年3月为财富分化拐点，2028年需谨慎
- 铁律：看好就早进，用杠杆要谨慎，和大众反着来，研究历史

## 实时指数
${indices.map(i => `${i.name}: ${i.price} (${i.changePercent > 0 ? '+' : ''}${i.changePercent}%)`).join('\n')}

## 监控个股（A股）
${stocks.map(s => `${s.name}(${s.category}): ${s.price} (${s.changePercent > 0 ? '+' : ''}${s.changePercent}%) 换手率:${s.turnover || '-'}%`).join('\n')}

## 港股科技标的
${(hk_stocks || []).map(s => `${s.name}(${s.category}): ${s.price} (${s.changePercent > 0 ? '+' : ''}${s.changePercent}%)`).join('\n')}

## 黄金/商品
${commodities.map(c => `${c.name}: ${c.price} (${c.changePercent > 0 ? '+' : ''}${c.changePercent}%)`).join('\n')}

## 市场情绪
涨停数: ${limitStats.limitUp} | 跌停数: ${limitStats.limitDown}

## 板块资金流向TOP5
${(sectorFlow || []).slice(0, 5).map(s => `${s.name}: ${s.changePercent > 0 ? '+' : ''}${s.changePercent}% 主力净流入:${(s.mainNetInflow / 100000000).toFixed(2)}亿`).join('\n')}

## 财联社最新快讯
${newsText}

请用中文分析并给出：
1. 📊 今日市场概况（3句话以内）
2. 🔔 重要信号提醒（哪些与Jessica的投资标的相关）
3. 💡 操作建议（基于投资框架，给出具体建议）
4. ⚠️ 风险提示

保持简洁实用，不超过300字。`;
  }

  async _callClaude(prompt) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        messages: [{ role: 'user', content: prompt }],
      });

      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 30000,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.content && result.content[0]) {
              resolve(result.content[0].text);
            } else {
              reject(new Error('AI返回格式异常'));
            }
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('AI请求超时')); });
      req.write(body);
      req.end();
    });
  }

  _generateBasicAnalysis(marketData, newsData) {
    const { indices, stocks, limitStats } = marketData;
    const shIndex = indices.find(i => i.name?.includes('上证'));
    const importantNews = newsData.filter(n => n.level !== 'normal').slice(0, 5);
    
    let analysis = '📊 市场快报\n\n';
    
    if (shIndex) {
      const trend = shIndex.changePercent > 0 ? '上涨📈' : shIndex.changePercent < 0 ? '下跌📉' : '持平';
      analysis += `上证指数 ${trend} ${shIndex.changePercent}%，报${shIndex.price}\n`;
    }
    
    analysis += `涨停${limitStats.limitUp}家 / 跌停${limitStats.limitDown}家\n\n`;

    // 银行股表现
    const banks = stocks.filter(s => s.category === '银行股');
    if (banks.length > 0) {
      const avgChange = (banks.reduce((s, b) => s + (b.changePercent || 0), 0) / banks.length).toFixed(2);
      analysis += `🏦 银行股平均: ${avgChange > 0 ? '+' : ''}${avgChange}%\n`;
    }

    if (importantNews.length > 0) {
      analysis += '\n📰 重要快讯:\n';
      importantNews.forEach(n => {
        analysis += `• ${n.title || n.content}\n`;
      });
    }

    return analysis;
  }
}

// ==================== 推送模块 ====================
class NotificationService {
  // Telegram 推送
  static async sendTelegram(message) {
    const { bot_token, chat_id } = CONFIG.telegram;
    if (!bot_token || !chat_id) {
      console.log('Telegram未配置，跳过推送');
      return;
    }

    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        chat_id,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      });

      const options = {
        hostname: 'api.telegram.org',
        path: `/bot${bot_token}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 15000,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.ok) {
              console.log('✅ Telegram推送成功');
              resolve(true);
            } else {
              console.error('Telegram推送返回错误:', result.description);
              // 如果Markdown解析失败，用纯文本重试
              if (result.description?.includes("can't parse")) {
                NotificationService._sendTelegramPlainText(message).then(resolve).catch(reject);
              } else {
                resolve(false);
              }
            }
          } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Telegram超时')); });
      req.write(body);
      req.end();
    });
  }

  static async _sendTelegramPlainText(message) {
    const { bot_token, chat_id } = CONFIG.telegram;
    return new Promise((resolve, reject) => {
      const cleanMsg = message.replace(/[*_`\[\]]/g, '');
      const body = JSON.stringify({ chat_id, text: cleanMsg });
      const options = {
        hostname: 'api.telegram.org',
        path: `/bot${bot_token}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 15000,
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          console.log('✅ Telegram纯文本推送成功');
          resolve(true);
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  // Gmail 推送（使用 nodemailer 或简单 SMTP）
  static async sendGmail(subject, htmlContent) {
    const { user, app_password, to } = CONFIG.gmail;
    if (!user || !app_password) {
      console.log('Gmail未配置，跳过推送');
      return;
    }

    // 简化版：通过 Gmail SMTP 发送
    // 注意：GitHub Actions 中建议使用 nodemailer 包
    try {
      // 尝试使用 nodemailer（如果已安装）
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass: app_password },
      });

      await transporter.sendMail({
        from: user,
        to,
        subject,
        html: htmlContent,
      });
      console.log('✅ Gmail推送成功');
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND') {
        console.log('nodemailer未安装，跳过Gmail推送。请运行: npm install nodemailer');
      } else {
        console.error('Gmail推送失败:', e.message);
      }
    }
  }
}

// ==================== 预警检查模块 ====================
class AlertChecker {
  static checkAlerts(marketData) {
    const alerts = [];
    const { indices, stocks, hk_stocks, commodities } = marketData;

    // 检查指数异动
    indices.forEach(idx => {
      if (Math.abs(idx.changePercent) >= CONFIG.alerts.index_threshold) {
        alerts.push({
          type: 'index',
          level: Math.abs(idx.changePercent) >= 3 ? '🔴' : '🟡',
          message: `${idx.configName || idx.name} ${idx.changePercent > 0 ? '大涨' : '大跌'} ${idx.changePercent}%`,
        });
      }
    });

    // 检查A股个股异动
    stocks.forEach(s => {
      const isTech = ['GPU芯片', 'AI芯片', 'AI/科技'].includes(s.category);
      const threshold = isTech ? CONFIG.alerts.tech_threshold : CONFIG.alerts.stock_threshold;
      if (Math.abs(s.changePercent) >= threshold) {
        alerts.push({
          type: 'stock',
          level: Math.abs(s.changePercent) >= 10 ? '🔴' : '🟡',
          message: `${s.configName || s.name} ${s.changePercent > 0 ? '大涨' : '大跌'} ${s.changePercent}%`,
        });
      }
    });

    // 检查港股异动
    (hk_stocks || []).forEach(s => {
      const threshold = CONFIG.alerts.tech_threshold;
      if (Math.abs(s.changePercent) >= threshold) {
        alerts.push({
          type: 'hk_stock',
          level: Math.abs(s.changePercent) >= 15 ? '🔴' : '🟡',
          message: `🇭🇰 ${s.configName || s.name} ${s.changePercent > 0 ? '大涨' : '大跌'} ${s.changePercent}%`,
        });
      }
    });

    // 检查黄金异动
    commodities.forEach(c => {
      if (Math.abs(c.changePercent) >= CONFIG.alerts.gold_threshold) {
        alerts.push({
          type: 'commodity',
          level: '🟡',
          message: `${c.configName || c.name} ${c.changePercent > 0 ? '大涨' : '大跌'} ${c.changePercent}%`,
        });
      }
    });

    return alerts;
  }
}

// ==================== 主流程 ====================
async function main() {
  console.log('🚀 投资智能体 V2.0 - 市场监控启动');
  console.log(`⏰ ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
  console.log('数据源: 东方财富(行情) + 财联社(快讯)');
  console.log('---');

  const eastmoney = new EastMoneyAPI();
  const clsNews = new CLSNewsAPI();
  const juheNews = new JuheNewsAPI();
  const ai = new AIAnalyzer(CONFIG.anthropic_key);

  // Step 1: 并行获取所有数据
  console.log('📡 正在获取市场数据...');
  
  const allSecids = [
    ...CONFIG.watchlist.indices.map(i => i.code),
    ...CONFIG.watchlist.a_shares.map(s => s.code),
    ...(CONFIG.watchlist.hk_shares || []).map(s => s.code),
    ...CONFIG.watchlist.commodities.map(c => c.code),
  ];

  const [batchQuotes, sectorFlow, limitStats, clsFlash, juheFinance] = await Promise.all([
    eastmoney.getBatchQuotes(allSecids),
    eastmoney.getSectorFlow(),
    eastmoney.getLimitStats(),
    clsNews.getFlashNews(),
    juheNews.getFinanceNews(),
  ]);

  // Step 2: 整理数据
  const allConfigItems = [
    ...CONFIG.watchlist.indices,
    ...CONFIG.watchlist.a_shares,
    ...(CONFIG.watchlist.hk_shares || []),
    ...CONFIG.watchlist.commodities,
  ];
  const indexCodes = CONFIG.watchlist.indices.map(i => i.code.split('.').pop());
  const stockCodes = CONFIG.watchlist.a_shares.map(s => s.code.split('.').pop());
  const hkCodes = (CONFIG.watchlist.hk_shares || []).map(s => s.code.split('.').pop());
  
  // 匹配配置中的分类信息
  const enrichQuote = (q) => {
    const configItem = allConfigItems.find(c => c.code.includes(q.code));
    return { ...q, category: configItem?.category || '未分类', configName: configItem?.name || q.name };
  };

  const marketData = {
    indices: batchQuotes.filter(q => indexCodes.includes(q.code)).map(enrichQuote),
    stocks: batchQuotes.filter(q => stockCodes.includes(q.code)).map(enrichQuote),
    hk_stocks: batchQuotes.filter(q => hkCodes.includes(q.code)).map(enrichQuote),
    commodities: batchQuotes.filter(q => {
      const comCodes = CONFIG.watchlist.commodities.map(c => c.code.split('.').pop());
      return comCodes.includes(q.code);
    }).map(enrichQuote),
    sectorFlow,
    limitStats,
    ipoWatchlist: CONFIG.watchlist.ipo_watchlist || [],
  };

  // 如果批量接口没返回全部数据，补充单独请求
  if (marketData.indices.length === 0) {
    console.log('批量接口数据不全，尝试单独请求...');
    for (const idx of CONFIG.watchlist.indices) {
      const quote = await eastmoney.getQuote(idx.code);
      if (quote) {
        marketData.indices.push({ ...quote, category: idx.category, configName: idx.name });
      }
    }
  }
  if (marketData.hk_stocks.length === 0 && (CONFIG.watchlist.hk_shares || []).length > 0) {
    console.log('港股数据补充请求...');
    for (const hk of CONFIG.watchlist.hk_shares) {
      const quote = await eastmoney.getQuote(hk.code);
      if (quote) {
        marketData.hk_stocks.push({ ...quote, category: hk.category, configName: hk.name });
      }
    }
  }

  // 合并新闻数据
  const allNews = [
    ...clsFlash,
    ...juheFinance.map(n => ({ ...n, source: '财经快讯', level: 'normal' })),
  ];

  // IPO新闻过滤：检查新闻中是否提到即将上市的公司
  const ipoAlerts = [];
  const ipoNames = (CONFIG.watchlist.ipo_watchlist || []).map(i => i.name);
  allNews.forEach(n => {
    const text = (n.title || '') + (n.content || '');
    ipoNames.forEach(name => {
      if (text.includes(name)) {
        ipoAlerts.push({ name, news: n.title || n.content });
      }
    });
  });
  if (ipoAlerts.length > 0) {
    console.log(`🆕 检测到${ipoAlerts.length}条IPO相关新闻!`);
  }

  console.log(`✅ 数据获取完成: ${marketData.indices.length}个指数, ${marketData.stocks.length}只A股, ${marketData.hk_stocks.length}只港股, ${allNews.length}条新闻`);

  // Step 3: 预警检查
  const alerts = AlertChecker.checkAlerts(marketData);
  if (alerts.length > 0) {
    console.log(`⚠️ 检测到${alerts.length}个预警信号!`);
  }

  // Step 4: AI分析
  console.log('🤖 正在进行AI分析...');
  const aiAnalysis = await ai.analyze(marketData, allNews);

  // Step 5: 构建推送消息
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  
  // Telegram 消息（简洁版）
  let telegramMsg = `📊 *投资智能体 V2.0*\n⏰ ${now}\n`;
  telegramMsg += `📡 数据源: 东方财富+财联社\n\n`;

  // 预警
  if (alerts.length > 0) {
    telegramMsg += `🚨 *预警信号*\n`;
    alerts.forEach(a => { telegramMsg += `${a.level} ${a.message}\n`; });
    telegramMsg += '\n';
  }

  // IPO新闻提醒
  if (ipoAlerts.length > 0) {
    telegramMsg += `🆕 *IPO动态*\n`;
    ipoAlerts.forEach(a => { telegramMsg += `📌 ${a.name}: ${a.news}\n`; });
    telegramMsg += '\n';
  }

  // 指数
  telegramMsg += `📈 *主要指数*\n`;
  marketData.indices.forEach(i => {
    const emoji = i.changePercent > 0 ? '🔴' : i.changePercent < 0 ? '🟢' : '⚪';
    telegramMsg += `${emoji} ${i.configName || i.name}: ${i.price} (${i.changePercent > 0 ? '+' : ''}${i.changePercent}%)\n`;
  });

  // 银行股
  telegramMsg += `\n🏦 *银行股*\n`;
  marketData.stocks.filter(s => s.category === '银行股').forEach(s => {
    const emoji = s.changePercent > 0 ? '🔴' : s.changePercent < 0 ? '🟢' : '⚪';
    telegramMsg += `${emoji} ${s.configName || s.name}: ${s.price} (${s.changePercent > 0 ? '+' : ''}${s.changePercent}%)\n`;
  });

  // A股科技股
  const aTechStocks = marketData.stocks.filter(s => ['GPU芯片', 'AI芯片', 'AI/科技'].includes(s.category));
  if (aTechStocks.length > 0) {
    telegramMsg += `\n🔬 *A股科技*\n`;
    aTechStocks.forEach(s => {
      const emoji = s.changePercent > 0 ? '🔴' : s.changePercent < 0 ? '🟢' : '⚪';
      telegramMsg += `${emoji} ${s.configName || s.name}: ${s.price} (${s.changePercent > 0 ? '+' : ''}${s.changePercent}%)\n`;
    });
  }

  // 港股科技
  if (marketData.hk_stocks.length > 0) {
    telegramMsg += `\n🇭🇰 *港股科技*\n`;
    marketData.hk_stocks.forEach(s => {
      const emoji = s.changePercent > 0 ? '🔴' : s.changePercent < 0 ? '🟢' : '⚪';
      telegramMsg += `${emoji} ${s.configName || s.name}: ${s.price} (${s.changePercent > 0 ? '+' : ''}${s.changePercent}%)\n`;
    });
  }

  // 黄金
  if (marketData.commodities.length > 0) {
    telegramMsg += `\n💰 *黄金*\n`;
    marketData.commodities.forEach(c => {
      telegramMsg += `${c.configName || c.name}: ${c.price} (${c.changePercent > 0 ? '+' : ''}${c.changePercent}%)\n`;
    });
  }

  // 市场情绪
  telegramMsg += `\n📊 涨停: ${limitStats.limitUp} | 跌停: ${limitStats.limitDown}\n`;

  // AI分析
  telegramMsg += `\n🤖 *AI分析*\n${aiAnalysis}\n`;

  // 重要新闻
  const topNews = allNews.filter(n => n.level !== 'normal').slice(0, 5);
  if (topNews.length > 0) {
    telegramMsg += `\n📰 *重要快讯*\n`;
    topNews.forEach(n => {
      telegramMsg += `• ${n.title || n.content}\n`;
    });
  }

  // Step 6: 推送
  console.log('📤 正在推送...');
  console.log('---消息预览---');
  console.log(telegramMsg);
  console.log('---消息预览结束---');

  await NotificationService.sendTelegram(telegramMsg);

  // Gmail 推送（HTML格式，更美观）
  const emailHtml = buildEmailHtml(marketData, alerts, aiAnalysis, allNews, now);
  await NotificationService.sendGmail(
    `📊 投资日报 ${now.split(' ')[0]} | ${marketData.indices[0]?.name || '市场'} ${marketData.indices[0]?.changePercent > 0 ? '↑' : '↓'}${Math.abs(marketData.indices[0]?.changePercent || 0)}%`,
    emailHtml
  );

  console.log('\n✅ 市场监控完成!');
}

// ==================== 邮件HTML模板 ====================
function buildEmailHtml(marketData, alerts, aiAnalysis, news, time) {
  const { indices, stocks, commodities, limitStats } = marketData;
  
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f5f5f5;">
  <div style="background:#1a1a2e;color:#fff;padding:20px;border-radius:12px 12px 0 0;text-align:center;">
    <h1 style="margin:0;font-size:22px;">📊 投资智能体 V2.0</h1>
    <p style="margin:5px 0 0;opacity:0.8;font-size:13px;">${time} | 东方财富+财联社</p>
  </div>
  
  ${alerts.length > 0 ? `
  <div style="background:#fff3cd;padding:15px;border-left:4px solid #ffc107;">
    <h3 style="margin:0 0 8px;color:#856404;">🚨 预警信号</h3>
    ${alerts.map(a => `<p style="margin:3px 0;color:#856404;">${a.level} ${a.message}</p>`).join('')}
  </div>` : ''}
  
  <div style="background:#fff;padding:20px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
    <h3 style="color:#1a1a2e;border-bottom:2px solid #e94560;padding-bottom:8px;">📈 主要指数</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr style="background:#f8f9fa;"><th style="padding:8px;text-align:left;">名称</th><th style="text-align:right;padding:8px;">最新</th><th style="text-align:right;padding:8px;">涨跌幅</th></tr>
      ${indices.map(i => `<tr>
        <td style="padding:6px 8px;">${i.configName || i.name}</td>
        <td style="text-align:right;padding:6px 8px;">${i.price}</td>
        <td style="text-align:right;padding:6px 8px;color:${i.changePercent > 0 ? '#e94560' : i.changePercent < 0 ? '#0f9b58' : '#666'};font-weight:bold;">
          ${i.changePercent > 0 ? '+' : ''}${i.changePercent}%
        </td>
      </tr>`).join('')}
    </table>

    <h3 style="color:#1a1a2e;border-bottom:2px solid #e94560;padding-bottom:8px;margin-top:20px;">🏦 银行股监控</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr style="background:#f8f9fa;"><th style="padding:8px;text-align:left;">名称</th><th style="text-align:right;padding:8px;">最新</th><th style="text-align:right;padding:8px;">涨跌幅</th><th style="text-align:right;padding:8px;">换手率</th></tr>
      ${stocks.filter(s => s.category === '银行股').map(s => `<tr>
        <td style="padding:6px 8px;">${s.configName || s.name}</td>
        <td style="text-align:right;padding:6px 8px;">${s.price}</td>
        <td style="text-align:right;padding:6px 8px;color:${s.changePercent > 0 ? '#e94560' : s.changePercent < 0 ? '#0f9b58' : '#666'};font-weight:bold;">
          ${s.changePercent > 0 ? '+' : ''}${s.changePercent}%
        </td>
        <td style="text-align:right;padding:6px 8px;">${s.turnover || '-'}%</td>
      </tr>`).join('')}
    </table>

    ${commodities.length > 0 ? `
    <h3 style="color:#1a1a2e;border-bottom:2px solid #ffc107;padding-bottom:8px;margin-top:20px;">💰 黄金</h3>
    ${commodities.map(c => `<p style="font-size:15px;">${c.configName || c.name}: <strong>${c.price}</strong> <span style="color:${c.changePercent > 0 ? '#e94560' : '#0f9b58'};">(${c.changePercent > 0 ? '+' : ''}${c.changePercent}%)</span></p>`).join('')}
    ` : ''}

    <p style="background:#f0f0f0;padding:10px;border-radius:8px;font-size:13px;text-align:center;">
      涨停 <strong style="color:#e94560;">${limitStats.limitUp}</strong> 家 | 跌停 <strong style="color:#0f9b58;">${limitStats.limitDown}</strong> 家
    </p>

    <h3 style="color:#1a1a2e;border-bottom:2px solid #16213e;padding-bottom:8px;margin-top:20px;">🤖 AI分析</h3>
    <div style="background:#f8f9fa;padding:15px;border-radius:8px;font-size:14px;line-height:1.6;white-space:pre-wrap;">${aiAnalysis}</div>

    ${news.filter(n => n.level !== 'normal').length > 0 ? `
    <h3 style="color:#1a1a2e;border-bottom:2px solid #16213e;padding-bottom:8px;margin-top:20px;">📰 重要快讯</h3>
    ${news.filter(n => n.level !== 'normal').slice(0, 8).map(n => `
      <div style="padding:8px 0;border-bottom:1px solid #eee;font-size:13px;">
        <span style="color:${n.level === 'breaking' ? '#e94560' : '#ffc107'};font-weight:bold;">${n.level === 'breaking' ? '🔴' : '🟡'}</span>
        ${n.title || n.content}
        <span style="color:#999;font-size:12px;"> ${n.time || ''}</span>
      </div>
    `).join('')}` : ''}
  </div>
  
  <p style="text-align:center;color:#999;font-size:12px;margin-top:15px;">
    投资智能体 V2.0 | 数据来源：东方财富+财联社 | 仅供参考，不构成投资建议
  </p>
</body>
</html>`;
}

// ==================== GitHub Actions Workflow ====================
function generateWorkflowYaml() {
  return `# .github/workflows/market-monitor-v2.yml
name: '📊 市场监控 V2.0 (东方财富+财联社)'

on:
  schedule:
    # 交易日每30分钟运行 (UTC时间，北京时间=UTC+8)
    # 9:00-15:30 北京时间 = 1:00-7:30 UTC
    - cron: '0,30 1-7 * * 1-5'
    # 盘前概览 8:30 北京时间 = 0:30 UTC
    - cron: '30 0 * * 1-5'
    # 收盘总结 16:00 北京时间 = 8:00 UTC
    - cron: '0 8 * * 1-5'
  workflow_dispatch:

jobs:
  monitor:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install nodemailer 2>/dev/null || true

      - name: Run Market Monitor V2
        env:
          TELEGRAM_BOT_TOKEN: \${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: \${{ secrets.TELEGRAM_CHAT_ID }}
          GMAIL_USER: \${{ secrets.GMAIL_USER }}
          GMAIL_APP_PASSWORD: \${{ secrets.GMAIL_APP_PASSWORD }}
          ANTHROPIC_API_KEY: \${{ secrets.ANTHROPIC_API_KEY }}
          JUHE_NEWS_KEY: \${{ secrets.JUHE_NEWS_KEY }}
        run: node market-monitor-v2.js
`;
}

// 如果直接运行则输出workflow配置
if (process.argv.includes('--gen-workflow')) {
  console.log(generateWorkflowYaml());
  process.exit(0);
}

// 运行主程序
main().catch(e => {
  console.error('❌ 监控系统异常:', e);
  process.exit(1);
});
