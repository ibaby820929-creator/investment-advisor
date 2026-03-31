const https = require('https');

// ===== 配置 =====
const CONFIG = {
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  gmailUser: process.env.GMAIL_USER,
  gmailPass: process.env.GMAIL_APP_PASSWORD,
  githubToken: process.env.GITHUB_TOKEN, // Auto-provided by GitHub Actions
};

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
  return new Promise((resolve) => {
    if (!CONFIG.telegramToken || !CONFIG.telegramChatId) { resolve(); return; }

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
      res.on('end', () => { console.log('Telegram推送成功'); resolve(); });
    });
    req.on('error', () => { console.log('Telegram推送失败'); resolve(); });
    req.write(postData);
    req.end();
  });
}

// ===== 邮件推送 =====
function sendEmailSMTP(subject, body) {
  return new Promise((resolve) => {
    if (!CONFIG.gmailUser || !CONFIG.gmailPass) { resolve(); return; }
    try {
      const tls = require('tls');
      const socket = tls.connect(465, 'smtp.gmail.com', () => {
        let step = 0;
        socket.on('data', (data) => {
          const response = data.toString();
          switch(step) {
            case 0: socket.write('EHLO localhost\r\n'); step=1; break;
            case 1: if(response.includes('250 ')){socket.write('AUTH LOGIN\r\n');step=2;} break;
            case 2: socket.write(Buffer.from(CONFIG.gmailUser).toString('base64')+'\r\n');step=3; break;
            case 3: socket.write(Buffer.from(CONFIG.gmailPass).toString('base64')+'\r\n');step=4; break;
            case 4: if(response.includes('235')){socket.write(`MAIL FROM:<${CONFIG.gmailUser}>\r\n`);step=5;}else{socket.end();resolve();} break;
            case 5: socket.write(`RCPT TO:<${CONFIG.gmailUser}>\r\n`);step=6; break;
            case 6: socket.write('DATA\r\n');step=7; break;
            case 7:
              const email = `From: Investment Monitor <${CONFIG.gmailUser}>\r\nTo: ${CONFIG.gmailUser}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}\r\n.\r\n`;
              socket.write(email);step=8; break;
            case 8: socket.write('QUIT\r\n');console.log('邮件发送成功');socket.end();resolve(); break;
          }
        });
      });
      socket.on('error', () => { console.log('SMTP失败'); resolve(); });
      socket.setTimeout(30000, () => { socket.destroy(); resolve(); });
    } catch(e) { resolve(); }
  });
}

// ===== 保存报告到GitHub =====
function saveReportToGithub(report) {
  return new Promise((resolve) => {
    if (!CONFIG.githubToken) { console.log('无GitHub Token，跳过保存'); resolve(); return; }

    const content = Buffer.from(JSON.stringify(report, null, 2)).toString('base64');

    // First, try to get the existing file SHA
    const getOptions = {
      hostname: 'api.github.com',
      port: 443,
      path: '/repos/ibaby820929-creator/investment-advisor/contents/data/latest-report.json',
      method: 'GET',
      headers: {
        'User-Agent': 'investment-monitor',
        'Authorization': `token ${CONFIG.githubToken}`,
        'Accept': 'application/vnd.github.v3+json'
      },
      timeout: 30000
    };

    const getReq = https.request(getOptions, (getRes) => {
      let getData = '';
      getRes.on('data', chunk => getData += chunk);
      getRes.on('end', () => {
        let sha = null;
        try {
          const existing = JSON.parse(getData);
          sha = existing.sha;
        } catch(e) {}

        // Now create or update the file
        const putBody = JSON.stringify({
          message: 'Update market report ' + new Date().toISOString(),
          content: content,
          ...(sha ? { sha } : {})
        });

        const putOptions = {
          hostname: 'api.github.com',
          port: 443,
          path: '/repos/ibaby820929-creator/investment-advisor/contents/data/latest-report.json',
          method: 'PUT',
          headers: {
            'User-Agent': 'investment-monitor',
            'Authorization': `token ${CONFIG.githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(putBody)
          },
          timeout: 30000
        };

        const putReq = https.request(putOptions, (putRes) => {
          let putData = '';
          putRes.on('data', chunk => putData += chunk);
          putRes.on('end', () => {
            if (putRes.statusCode >= 200 && putRes.statusCode < 300) {
              console.log('报告已保存到GitHub');
            } else {
              console.log('保存报告失败:', putRes.statusCode, putData.substring(0, 200));
            }
            resolve();
          });
        });
        putReq.on('error', (err) => { console.log('保存报告出错:', err.message); resolve(); });
        putReq.write(putBody);
        putReq.end();
      });
    });
    getReq.on('error', (err) => { console.log('获取文件SHA出错:', err.message); resolve(); });
    getReq.end();
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
    const searchPrompt = `你是一个专业的投资市场分析师。请搜索以下领域的最新重大新闻（最近24小时内的），找出可能影响投资决策的重要信息：

监控领域：
1. 中国科技公司IPO动态（新股申报、过会、招股、上市）
2. AI和芯片行业重大新闻
3. 智谱AI、MiniMax、摩尔线程等重点公司的最新动态
4. 中国银行股异常波动（暴涨或暴跌）
5. 中国重要经济政策（两会、央行、证监会等）
6. 美股和全球市场重大变化
7. 黄金价格重大波动

请搜索后，严格按以下格式输出：

第一行必须是以下三个之一：
ALERT_LEVEL: HIGH
ALERT_LEVEL: LOW
ALERT_LEVEL: NONE

然后按以下格式输出分析（用中文）：

## 今日市场概况
一段话总结今天市场的整体情况

## 重要新闻
对每条重要新闻：
### 新闻标题
- 内容摘要：简要说明发生了什么
- 投资影响：这对投资者意味着什么
- 操作建议：基于这条新闻应该关注什么

## 关键数据
列出今天关键的市场数据（指数、黄金、汇率等）

## 风险提示
当前需要注意的风险因素

注意"重大"的标准：可能直接影响科技股、银行股、黄金等核心赛道的投资决策。`;

    console.log('正在搜索最新市场动态...\n');
    const result = await callClaude(searchPrompt);
    
    console.log('AI分析结果：\n');
    console.log(result);
    console.log('\n');

    const isHigh = result.includes('ALERT_LEVEL: HIGH') || result.includes('ALERT_LEVEL:HIGH');
    const isLow = result.includes('ALERT_LEVEL: LOW') || result.includes('ALERT_LEVEL:LOW');
    const alertLevel = isHigh ? 'HIGH' : (isLow ? 'LOW' : 'NONE');

    const cleanResult = result
      .replace(/ALERT_LEVEL:\s*(HIGH|LOW|NONE)\s*/g, '')
      .trim();

    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    // Save report to GitHub (always save, regardless of alert level)
    const report = {
      timestamp: new Date().toISOString(),
      timestampCN: now,
      alertLevel: alertLevel,
      content: cleanResult
    };
    await saveReportToGithub(report);

    if (isHigh) {
      console.log('🚨 发现重大新闻！正在推送...\n');

      const telegramMsg = `🚨 <b>投资监控 - 重大新闻</b>\n📅 ${now}\n\n${cleanResult.substring(0, 3500)}`;
      await sendTelegram(telegramMsg);

      const emailSubject = `[投资监控] 重大新闻提醒 - ${now}`;
      await sendEmailSMTP(emailSubject, cleanResult);

      console.log('\n推送完成！');
    } else if (isLow) {
      console.log('📋 有一些普通新闻，不触发推送。');
      
      const hour = new Date(new Date().toLocaleString('en', { timeZone: 'Asia/Shanghai' })).getHours();
      if (hour >= 8 && hour < 9) {
        const telegramMsg = `📋 <b>投资监控 - 每日简报</b>\n📅 ${now}\n\n${cleanResult.substring(0, 3500)}`;
        await sendTelegram(telegramMsg);
        await sendEmailSMTP(`[投资日报] ${now}`, cleanResult);
        console.log('已发送每日简报。');
      }
    } else {
      console.log('✅ 市场平静，无需推送。');
    }

  } catch (err) {
    console.error('监控运行出错:', err.message);
    if (CONFIG.telegramToken) {
      await sendTelegram(`⚠️ 投资监控运行出错：${err.message}`);
    }
  }

  console.log('\n========================================');
  console.log('  监控运行结束');
  console.log('========================================');
}

runMonitor();
