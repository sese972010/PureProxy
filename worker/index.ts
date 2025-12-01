import { connect } from 'cloudflare:sockets';

// 模拟数据源（与前端 constants 保持一致，但这里是后端使用）
const PROXY_SOURCES = [
  'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt',
  'https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt',
];

// 简单的国家模拟
const MOCK_COUNTRIES = [
  { code: 'US', name: '美国' }, { code: 'DE', name: '德国' }, { code: 'CN', name: '中国' },
  { code: 'JP', name: '日本' }, { code: 'SG', name: '新加坡' }, { code: 'GB', name: '英国' }
];

const MOCK_ISPS = ['DigitalOcean', 'AWS', 'Google Cloud', 'Hetzner', 'Comcast', 'China Telecom'];

/**
 * 验证单个代理 IP 的连通性 (TCP Handshake)
 * @param {string} ip 
 * @param {number} port 
 * @returns {Promise<number|null>} 延迟毫秒数或 null
 */
async function checkProxyConnection(ip, port) {
  const start = Date.now();
  try {
    // 使用 Cloudflare Sockets API 进行 TCP 连接尝试
    const socket = connect({ hostname: ip, port: port });
    const writer = socket.writable.getWriter();
    await writer.ready; // 等待连接建立
    
    // 连接成功，计算耗时
    const latency = Date.now() - start;
    
    // 关闭连接
    await writer.close();
    socket.close();
    
    return latency;
  } catch (error) {
    // 连接失败
    return null;
  }
}

/**
 * 处理 Cron 定时任务：抓取、验证、入库
 */
async function handleScheduled(event, env, ctx) {
  console.log("开始执行定时抓取任务...");
  
  let validCount = 0;
  
  for (const source of PROXY_SOURCES) {
    try {
      const response = await fetch(source);
      if (!response.ok) continue;
      
      const text = await response.text();
      const lines = text.split('\n');
      
      // 随机选取一部分进行验证（避免一次性验证太多导致超时，Workers 免费版 CPU 时间有限）
      const sampleLines = lines.filter(l => l.includes(':')).sort(() => Math.random() - 0.5).slice(0, 30);

      const protocol = source.includes('socks5') ? 'SOCKS5' : 'HTTP';

      for (const line of sampleLines) {
        const [ip, portStr] = line.trim().split(':');
        const port = parseInt(portStr);
        if (!ip || isNaN(port)) continue;

        // 1. TCP 连通性检测
        const latency = await checkProxyConnection(ip, port);

        if (latency !== null) {
          // 2. 模拟/生成元数据
          const countryData = MOCK_COUNTRIES[Math.floor(Math.random() * MOCK_COUNTRIES.length)];
          const isp = MOCK_ISPS[Math.floor(Math.random() * MOCK_ISPS.length)];
          const purityScore = Math.floor(Math.random() * (100 - 40) + 40);
          const cfProb = purityScore > 80 ? Math.floor(Math.random() * 20 + 70) : Math.floor(Math.random() * 50);
          
          const id = crypto.randomUUID();
          
          // 3. 存入 D1 数据库
          // 注意：env.DB 是我们在 Settings -> Bindings 中绑定的变量名
          await env.DB.prepare(`
            INSERT INTO proxies (id, ip, port, protocol, country, country_code, isp, anonymity, latency, purity_score, cf_pass_prob, last_checked, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(ip, port) DO UPDATE SET
              latency = excluded.latency,
              last_checked = excluded.last_checked,
              purity_score = excluded.purity_score
          `).bind(
            id, ip, port, protocol, 
            countryData.name, countryData.code, isp, 
            '高匿', latency, purityScore, cfProb, 
            Date.now(), Date.now()
          ).run();
          
          validCount++;
        }
      }
    } catch (e) {
      console.error(`处理源 ${source} 失败`, e);
    }
  }
  
  console.log(`任务完成，新增/更新了 ${validCount} 个有效代理。`);
}

/**
 * 处理 HTTP API 请求
 */
async function handleRequest(request, env) {
  const url = new URL(request.url);
  
  // 设置 CORS 头
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (url.pathname === '/api/proxies') {
    try {
      // 从 D1 读取最近更新的代理
      const { results } = await env.DB.prepare(
        "SELECT * FROM proxies ORDER BY last_checked DESC LIMIT 100"
      ).all();
      
      // 转换数据格式以匹配前端
      const formatted = results.map((row) => ({
        id: row.id,
        ip: row.ip,
        port: row.port,
        protocol: row.protocol,
        country: row.country,
        countryCode: row.country_code,
        isp: row.isp,
        anonymity: row.anonymity,
        latency: row.latency,
        purityScore: row.purity_score,
        cloudflarePassProbability: row.cf_pass_prob,
        riskLevel: row.purity_score > 80 ? '低' : (row.purity_score > 50 ? '中' : '高'),
        lastChecked: row.last_checked
      }));

      return new Response(JSON.stringify(formatted), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Database error', details: String(e) }), { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  return new Response("Not Found", { status: 404, headers: corsHeaders });
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(event, env, ctx));
  }
};