const https = require('https');
const nodemailer_disabled = true; // We'll use raw SMTP instead

// ===== 配置 =====
const CONFIG = {
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  gmailUser: process.env.GMAIL_USER,
  gmailPass: process.env.GMAIL_APP_PASSWORD,
};

// ===== 监控关键词 =====
const MONITOR_TOPICS = [
  '中国科技公司IPO上市 最新消息 2026',
  'AI芯片 中国 重大新闻 最新',
  '智谱AI MiniMax 摩尔线程 最新动态 2026',
  '中国银行股 异动 暴涨 最新',
  '中国经济政策 最新 重要 2026',
  '美股 重大变化 金融危机 风险 2026',
  '黄金价格 走势 最新'
];

// ===== Claude API 调用（带联网搜索）=====
function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
      tools: [{
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 8
      }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 120000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(parsed.error.message));
            return;
          }
          const text = parsed.content
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('\n');
          resolve(text);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('超时')); });
    req.write(postData);
    req.end();
  });
}

// ===== Telegram 推送 =====
function sendTelegram(message) {
  return new Promise((resolve, reject) => {
    if (!CONFIG.telegramToken || !CONFIG.telegramChatId) {
      console.log('Telegram未配置，跳过');
      resolve();
      return;
    }

    const postData = JSON.stringify({
      chat_id: CONFIG.telegramChatId,
      text: message,
      parse_mode: 'HTML'
    });

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${CONFIG.telegramToken}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log('Telegram推送成功');
        resolve();
      });
    });

    req.on('error', (err) => {
      console.log('Telegram推送失败:', err.message);
      resolve(); // 不要因为推送失败而中断
    });

    req.write(postData);
    req.end();
  });
}

// ===== 邮件推送（使用Gmail SMTP）=====
function sendEmail(subject, htmlBody) {
  return new Promise((resolve, reject) => {
    if (!CONFIG.gmailUser || !CONFIG.gmailPass) {
      console.log('Gmail未配置，跳过');
      resolve();
      return;
    }

    // 使用 Google Gmail API via HTTPS
    const auth = Buffer.from(`${CONFIG.gmailUser}:${CONFIG.gmailPass}`).toString('base64');
    
    const emailContent = [
      `From: 投资监控 <${CONFIG.gmailUser}>`,
      `To: ${CONFIG.gmailUser}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      '',
      htmlBody
    ].join('\r\n');

    const raw = Buffer.from(emailContent).toString('base64url');

    const postData = JSON.stringify({ raw });

    const options = {
      hostname: 'gmail.googleapis.com',
      port: 443,
      path: '/gmail/v1/users/me/messages/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 30000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('邮件发送成功');
        } else {
          console.log('邮件发送失败，状态码:', res.statusCode, '使用备用方案...');
          // 备用：通过简单的fetch发送
        }
        resolve();
      });
    });

    req.on('error', (err) => {
      console.log('邮件发送失败:', err.message);
      resolve();
    });

    req.write(postData);
    req.end();
  });
}

// ===== 备用邮件方案：通过SMTP发送 =====
function sendEmailSMTP(subject, body) {
  return new Promise((resolve) => {
    if (!CONFIG.gmailUser || !CONFIG.gmailPass) {
      resolve();
      return;
    }

    try {
      // 使用 Node.js 内置的 net/tls 模块发送邮件
      const tls = require('tls');
      
      const socket = tls.connect(465, 'smtp.gmail.com', () => {
        let step = 0;
        
        socket.on('data', (data) => {
          const response = data.toString();
          
          switch(step) {
            case 0: // 等待服务器欢迎
              socket.write(`EHLO localhost\r\n`);
              step = 1;
              break;
            case 1: // EHLO响应
              if (response.includes('250 ')) {
                socket.write(`AUTH LOGIN\r\n`);
                step = 2;
              }
              break;
            case 2: // AUTH响应
              socket.write(Buffer.from(CONFIG.gmailUser).toString('base64') + '\r\n');
              step = 3;
              break;
            case 3: // 用户名响应
              socket.write(Buffer.from(CONFIG.gmailPass).toString('base64') + '\r\n');
              step = 4;
              break;
            case 4: // 密码响应
              if (response.includes('235')) {
                socket.write(`MAIL FROM:<${CONFIG.gmailUser}>\r\n`);
                step = 5;
              } else {
                console.log('邮件认证失败');
                socket.end();
                resolve();
              }
              break;
            case 5:
              socket.write(`RCPT TO:<${CONFIG.gmailUser}>\r\n`);
              step = 6;
              break;
            case 6:
              socket.write('DATA\r\n');
              step = 7;
              break;
            case 7:
              const email = [
                `From: Investment Monitor <${CONFIG.gmailUser}>`,
                `To: ${CONFIG.gmailUser}`,
                `Subject: ${subject}`,
                'Content-Type: text/plain; charset=UTF-8',
                '',
                body,
                '',
                '.',
                ''
              ].join('\r\n');
              socket.write(email);
              step = 8;
              break;
            case 8:
              socket.write('QUIT\r\n');
              console.log('邮件发送成功(SMTP)');
              socket.end();
              resolve();
              break;
          }
        });
      });

      socket.on('error', (err) => {
        console.log('SMTP连接失败:', err.message);
        resolve();
      });

      socket.setTimeout(30000, () => {
        socket.destroy();
        resolve();
      });

    } catch (e) {
      console.log('邮件发送异常:', e.message);
      resolve();
    }
  });
}

// ===== 主监控逻辑 =====
async function runMonitor() {
  console.log('========================================');
  console.log('  投资市场监控 - 开始运行');
  console.log('  时间:', new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }));
  console.log('========================================\n');

  if (!CONFIG.anthropicKey) {
    console.error('错误：未设置 ANTHROPIC_API_KEY');
    process.exit(1);
  }

  try {
    // 第一步：让AI搜索所有监控领域的最新消息
    const searchPrompt = `你是一个投资市场监控助手。请搜索以下领域的最新重大新闻（最近24小时内的），找出可能影响投资决策的重要信息：

监控领域：
1. 中国科技公司IPO动态（新股申报、过会、招股、上市）
2. AI和芯片行业重大新闻
3. 智谱AI、MiniMax、摩尔线程等重点公司的最新动态
4. 中国银行股异常波动（暴涨或暴跌）
5. 中国重要经济政策（两会、央行、证监会等）
6. 美股和全球市场重大变化
7. 黄金价格重大波动

请搜索后，按以下格式输出：

如果有重大新闻（可能影响投资决策的），输出：
ALERT_LEVEL: HIGH
然后列出每条重大新闻，包括：标题、来源、简要内容、对投资的潜在影响

如果只是普通新闻（不太影响投资决策），输出：
ALERT_LEVEL: LOW
然后简要列出主要新闻标题

如果没有什么特别的新闻，输出：
ALERT_LEVEL: NONE

注意：
- "重大"的标准是：可能直接影响你监控的这些赛道的投资决策
- 比如：某家关注的公司宣布上市、政策重大调整、市场暴跌暴涨、行业格局变化等
- 普通的公司日常运营新闻不算重大
- 请用中文回答`;

    console.log('正在搜索最新市场动态...\n');
    const result = await callClaude(searchPrompt);
    
    console.log('AI分析结果：\n');
    console.log(result);
    console.log('\n');

    // 判断是否需要推送
    const isHigh = result.includes('ALERT_LEVEL: HIGH') || result.includes('ALERT_LEVEL:HIGH');
    const isLow = result.includes('ALERT_LEVEL: LOW') || result.includes('ALERT_LEVEL:LOW');

    if (isHigh) {
      console.log('🚨 发现重大新闻！正在推送...\n');

      // 清理输出文本（去掉ALERT_LEVEL标记）
      const cleanResult = result
        .replace(/ALERT_LEVEL:\s*HIGH\s*/g, '')
        .trim();

      const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

      // Telegram推送
      const telegramMsg = `🚨 <b>投资监控 - 重大新闻</b>\n📅 ${now}\n\n${cleanResult.substring(0, 3500)}`;
      await sendTelegram(telegramMsg);

      // 邮件推送
      const emailSubject = `[投资监控] 重大新闻提醒 - ${now}`;
      await sendEmailSMTP(emailSubject, cleanResult);

      console.log('\n推送完成！');
    } else if (isLow) {
      console.log('📋 有一些普通新闻，不触发推送。');
      
      // 每天早上8点发一次日报（通过检查当前小时）
      const hour = new Date(new Date().toLocaleString('en', { timeZone: 'Asia/Shanghai' })).getHours();
      if (hour >= 8 && hour < 9) {
        const cleanResult = result.replace(/ALERT_LEVEL:\s*LOW\s*/g, '').trim();
        const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        
        const telegramMsg = `📋 <b>投资监控 - 每日简报</b>\n📅 ${now}\n\n${cleanResult.substring(0, 3500)}`;
        await sendTelegram(telegramMsg);
        
        const emailSubject = `[投资日报] ${now}`;
        await sendEmailSMTP(emailSubject, cleanResult);
        
        console.log('已发送每日简报。');
      }
    } else {
      console.log('✅ 市场平静，无需推送。');
    }

  } catch (err) {
    console.error('监控运行出错:', err.message);
    
    // 如果是API错误，推送错误通知
    if (CONFIG.telegramToken) {
      await sendTelegram(`⚠️ 投资监控运行出错：${err.message}`);
    }
  }

  console.log('\n========================================');
  console.log('  监控运行结束');
  console.log('========================================');
}

// 执行
runMonitor();
