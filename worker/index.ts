import { connect } from 'cloudflare:sockets';

// Cloudflare ProxyIP 专用数据源 (兜底用)
// 包含 ymyuuu/IPDB (高质量聚合) 和 391040525/ProxyIP (专用反代)
const PROXY_SOURCES = [
  {
    name: 'ymyuuu/IPDB (Best Proxy)',
    url: 'https://raw.githubusercontent.com/ymyuuu/IPDB/main/bestproxy.txt',
    type: 'mixed'
  },
  {
    name: '391040525/ProxyIP (Active)',
    url: 'https://raw.githubusercontent.com/391040525/ProxyIP/main/active.txt', 
    type: 'text'
  }
];

// 辅助函数: 延迟
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// 辅助函数: 严格超时控制
const withTimeout = (promise, ms) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
  ]);
};

/**
 * 尝试 Base64 解码
 */
function tryDecode(content) {
  try {
    if (!content.includes('\n') && content.length > 50) {
      return atob(content);
    }
    return atob(content);
  } catch (e) {
    return content;
  }
}

/**
 * 判断是否为公网 IP (过滤内网和保留 IP)
 */
function isValidPublicIp(ip) {
  if (!ip) return false;
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = ip.match(ipv4Regex);
  if (!match) return false;

  const part0 = parseInt(match[1], 10);
  const part1 = parseInt(match[2], 10);

  if (part0 === 10) return false;
  if (part0 === 172 && part1 >= 16 && part1 <= 31) return false;
  if (part0 === 192 && part1 === 168) return false;
  if (part0 === 127) return false;
  if (part0 === 0) return false;
  if (part0 >= 224) return false;
  if (part0 === 215) return false;
  
  return true;
}

/**
 * 判断是否为家宽 ISP (Residential)
 */
function isResidentialISP(ispName) {
  if (!ispName) return false;
  const lower = ispName.toLowerCase();
  
  const residentialKeywords = [
    'cable', 'dsl', 'fios', 'broadband', 'telecom', 'mobile', 'wireless', 
    'verizon', 'comcast', 'at&t', 'vodafone', 'orange', 't-mobile', 'sprint',
    'charter', 'spectrum', 'rogers', 'bell', 'shaw', 'telus', 'kddi', 'ntt',
    'softbank', 'kt corp', 'sk broadband', 'chunghwa', 'hinet', 'vietel', 
    'residental', 'dynamic', 'residential'
  ];

  const datacenterKeywords = [
    'cloud', 'data', 'center', 'hosting', 'server', 'vps', 'dedicated',
    'amazon', 'aws', 'google', 'microsoft', 'azure', 'alibaba', 'tencent',
    'digitalocean', 'linode', 'vultr', 'ovh', 'hetzner', 'choopa', 'm247',
    'oracle', 'fly.io', 'cloudflare', 'akamai', 'cdn77'
  ];

  if (datacenterKeywords.some(k => lower.includes(k))) return false;
  if (residentialKeywords.some(k => lower.includes(k))) return true;

  return false;
}

/**
 * 获取 IP 的真实地理位置信息
 */
async function fetchIpGeo(ip) {
  try {
    // 使用 lang=zh-CN 获取中文结果
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,regionName,city,isp,org,as&lang=zh-CN`);
    if (!response.ok) return null;
    const data = await response.json();
    if (data.status !== 'success') return null;
    return data;
  } catch (e) {
    return null;
  }
}

/**
 * 核心验证: 验证是否为有效的 Cloudflare ProxyIP
 */
async function validateProxyIP(ip, port = 443) {
  const start = Date.now();
  let socket = null;
  let writer = null;
  let reader = null;

  try {
    await withTimeout(async function() {
      socket = connect({ hostname: ip, port: port });
      writer = socket.writable.getWriter();
      return writer.ready;
    }(), 2000);

    const request = new TextEncoder().encode(
      `GET / HTTP/1.1\r\nHost: speed.cloudflare.com\r\nConnection: close\r\nUser-Agent: PureProxy/1.0\r\n\r\n`
    );
    await writer.write(request);

    reader = socket.readable.getReader();
    let responseText = '';
    const decoder = new TextDecoder();
    
    await withTimeout(async function() {
      const { value, done } = await reader.read();
      if (value) {
        responseText = decoder.decode(value, { stream: false });
      }
    }(), 2500);

    const isCloudflare = responseText.toLowerCase().includes('server: cloudflare');
    
    if (isCloudflare) {
      return Date.now() - start;
    }
    
    return null;

  } catch (error) {
    return null; 
  } finally {
    if (reader) try { reader.releaseLock(); } catch(e) {}
    if (writer) try { writer.releaseLock(); } catch(e) {}
    if (socket) try { socket.close(); } catch(e) {}
  }
}

/**
 * 从 FOFA 获取高质量 IP
 */
async function fetchFromFOFA(email, key) {
  // 语法: server=="cloudflare" && port="443" && country="US" && protocol="https"
  // 解释: 搜索美国地区、开放443端口、使用HTTPS协议的 Cloudflare 服务器
  const query = 'server=="cloudflare" && port="443" && country="US" && protocol="https"';
  const qbase64 = btoa(query);
  
  // size=40: 免费版通常有条数限制，设置较小的值以节省积分并保证成功率
  const url = `https://fofa.info/api/v1/search/all?email=${email}&key=${key}&qbase64=${qbase64}&size=40&fields=ip,port`;
  
  console.log(`[FOFA] 正在请求 FOFA API (US Only)...`);
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[FOFA] 请求失败: ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    if (data.error) {
      console.warn(`[FOFA] API 错误: ${data.message || 'Unknown error'}`);
      return [];
    }
    
    // data.results 是一个二维数组 [[ip, port], [ip, port]]
    console.log(`[FOFA] 成功获取 ${data.results.length} 个美国节点`);
    return data.results.map(item => `${item[0]}:${item[1]}`);
  } catch (e) {
    console.error(`[FOFA] 异常:`, e);
    return [];
  }
}

/**
 * 处理 Cron 定时任务
 */
async function handleScheduled(event, env, ctx) {
  console.log("开始扫描 Cloudflare ProxyIP...");
  let validCount = 0;
  let candidates = [];
  
  // 1. 优先尝试 FOFA
  if (env.FOFA_EMAIL && env.FOFA_KEY) {
    const fofaIps = await fetchFromFOFA(env.FOFA_EMAIL, env.FOFA_KEY);
    candidates = [...candidates, ...fofaIps];
  } else {
    console.log("[FOFA] 未配置 API Key，跳过 FOFA 搜索");
  }

  // 2. 如果 FOFA 没数据 (或没配置)，使用公共兜底源
  if (candidates.length < 5) {
    console.log("[Source] FOFA 数据不足，切换到公共聚合源...");
    
    // 随机选一个公共源防止超时
    const source = PROXY_SOURCES.sort(() => Math.random() - 0.5)[0];
    try {
      console.log(`[Source] 正在获取: ${source.name}`);
      const response = await fetch(source.url);
      
      if (response.ok) {
        let text = await response.text();
        if (!text.includes(' ') && !text.includes('\n')) text = tryDecode(text);
        
        const lines = text.split(/[\r\n]+/)
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#'))
          .map(l => {
             let clean = l.replace(/^[a-z]+:\/\//, ''); 
             const match = clean.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})[:\s](\d+)/);
             if (match) return `${match[1]}:${match[2]}`;
             const ipMatch = clean.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
             if (ipMatch) return `${ipMatch[1]}:443`;
             return null;
          })
          .filter(l => l !== null)
          .filter(l => isValidPublicIp(l.split(':')[0]));
          
        // 随机取 20 个补充
        candidates = [...candidates, ...lines.sort(() => Math.random() - 0.5).slice(0, 20)];
      }
    } catch (e) {
      console.error(`[Source] 公共源获取失败`, e);
    }
  }

  console.log(`本次扫描队列: ${candidates.length} 个 IP`);
  if (candidates.length === 0) return;

  // 3. 验证与打分
  for (const line of candidates) {
    if (validCount >= 5) break; // 每次 Cron 最多入库 5 个精品，细水长流

    const parts = line.split(':');
    const ip = parts[0];
    const port = parseInt(parts[1]);

    // 验证
    const latency = await validateProxyIP(ip, port);

    if (latency !== null) {
      console.log(`✅ [Valid] ${ip}:${port} (${latency}ms)`);
      
      // 获取 Geo 信息
      await delay(1500); // 礼貌请求 Geo API
      const geo = await fetchIpGeo(ip);
      
      const country = geo ? geo.country : '未知';
      const countryCode = geo ? geo.countryCode : 'UN';
      const city = geo ? geo.city : '';
      const region = geo ? geo.regionName : '';
      const isp = geo ? geo.isp : 'Unknown ISP';
      const isResidential = isResidentialISP(isp);

      // 打分逻辑 (针对用户偏好调整)
      let purityScore = Math.max(10, 100 - Math.floor(latency / 15));
      
      // 策略：家宽优先
      if (isResidential) {
        purityScore += 20; // 家宽大幅加分
        if (purityScore > 100) purityScore = 100;
        console.log(`   🏠 发现家宽 IP! (+20分)`);
      } else {
        purityScore -= 5; // 数据中心略微降分
      }

      // 如果非美国 IP (可能是从公共源混进来的)，略微降分，但保留
      if (countryCode !== 'US' && countryCode !== 'UN') {
        purityScore -= 10;
      }
      
      const id = crypto.randomUUID();

      try {
        await env.DB.prepare(`
          INSERT INTO proxies (
            id, ip, port, protocol, 
            country, country_code, region, city, isp, 
            anonymity, latency, purity_score, cf_pass_prob, 
            last_checked, created_at, is_residential
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(ip, port) DO UPDATE SET
            latency = excluded.latency,
            last_checked = excluded.last_checked,
            purity_score = excluded.purity_score,
            is_residential = excluded.is_residential,
            city = excluded.city,
            region = excluded.region
        `).bind(
          id, ip, port, 'HTTPS',
          country, countryCode, region, city, isp,
          '透明', 
          latency, purityScore, 99,
          Date.now(), Date.now(), isResidential ? 1 : 0
        ).run();
        
        validCount++;
      } catch (dbErr) {
        console.error("写入数据库错误", dbErr);
      }
    }
  }
  
  console.log(`任务结束，入库 ${validCount} 个`);
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
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
      // 优先显示：家宽 (is_residential desc) -> 高分 (purity_score desc)
      const { results } = await env.DB.prepare(
        "SELECT * FROM proxies ORDER BY is_residential DESC, purity_score DESC, last_checked DESC LIMIT 100"
      ).all();
      
      const formatted = results.map((row) => ({
        id: row.id,
        ip: row.ip,
        port: row.port,
        protocol: row.protocol,
        country: row.country,
        countryCode: row.country_code,
        region: row.region,
        city: row.city,
        isp: row.isp,
        isResidential: row.is_residential === 1,
        anonymity: row.anonymity,
        latency: row.latency,
        purityScore: row.purity_score,
        cloudflarePassProbability: row.cf_pass_prob,
        riskLevel: row.purity_score > 80 ? '低' : '中',
        lastChecked: row.last_checked
      }));

      return new Response(JSON.stringify(formatted), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
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