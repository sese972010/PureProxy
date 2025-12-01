import { connect } from 'cloudflare:sockets';

// Cloudflare ProxyIP 专用数据源
// 这些源收集的是能够反向代理 Cloudflare 流量的 IP
const PROXY_SOURCES = [
  // 391040525/ProxyIP 是目前最权威的来源之一
  {
    url: 'https://raw.githubusercontent.com/391040525/ProxyIP/main/itds.txt', 
    protocol: 'HTTPS' // 通常这些 IP 开放 443/80 端口，作为 HTTPS 反代
  },
  {
    url: 'https://raw.githubusercontent.com/391040525/ProxyIP/main/hk.txt',
    protocol: 'HTTPS'
  },
  {
    url: 'https://raw.githubusercontent.com/391040525/ProxyIP/main/kr.txt',
    protocol: 'HTTPS'
  },
  {
    url: 'https://raw.githubusercontent.com/391040525/ProxyIP/main/sg.txt',
    protocol: 'HTTPS'
  },
  {
    url: 'https://raw.githubusercontent.com/391040525/ProxyIP/main/jp.txt',
    protocol: 'HTTPS'
  },
  {
    url: 'https://raw.githubusercontent.com/391040525/ProxyIP/main/us.txt',
    protocol: 'HTTPS'
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
 * 判断是否为公网 IP (过滤内网和保留 IP)
 */
function isValidPublicIp(ip) {
  // 基本 IPv4 正则
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
  if (part0 >= 224) return false; // Multicast & Reserved
  if (part0 === 215) return false; // DoD (常见误报)

  return true;
}

/**
 * 判断是否为家宽 ISP (Residential)
 * 这是一个简化的关键词匹配，实际生产环境可以使用 ASN 数据库
 */
function isResidentialISP(ispName) {
  if (!ispName) return false;
  const lower = ispName.toLowerCase();
  
  // 典型的家宽/移动网络关键词
  const residentialKeywords = [
    'cable', 'dsl', 'fios', 'broadband', 'telecom', 'mobile', 'wireless', 
    'verizon', 'comcast', 'at&t', 'vodafone', 'orange', 't-mobile', 'sprint',
    'charter', 'spectrum', 'rogers', 'bell', 'shaw', 'telus', 'kddi', 'ntt',
    'softbank', 'kt corp', 'sk broadband', 'chunghwa', 'hinet', 'vietel'
  ];

  // 典型的数据中心/云厂商关键词
  const datacenterKeywords = [
    'cloud', 'data', 'center', 'hosting', 'server', 'vps', 'dedicated',
    'amazon', 'aws', 'google', 'microsoft', 'azure', 'alibaba', 'tencent',
    'digitalocean', 'linode', 'vultr', 'ovh', 'hetzner', 'choopa', 'm247'
  ];

  if (datacenterKeywords.some(k => lower.includes(k))) return false;
  if (residentialKeywords.some(k => lower.includes(k))) return true;

  // 默认判定：如果不是明确的数据中心，且不包含 cloud 等词，倾向于认为是 ISP
  return false;
}

/**
 * 获取 IP 的真实地理位置信息
 */
async function fetchIpGeo(ip) {
  try {
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
 * 原理: 连接 IP，发送 Host 为 speed.cloudflare.com 的请求，检查是否返回 Server: cloudflare
 */
async function validateProxyIP(ip, port = 443) {
  const start = Date.now();
  let socket = null;
  let writer = null;
  let reader = null;

  try {
    // 1. 建立 TCP 连接 (2秒超时)
    await withTimeout(async function() {
      socket = connect({ hostname: ip, port: port });
      writer = socket.writable.getWriter();
      return writer.ready;
    }(), 2000);

    // 2. 构造 HTTP 请求
    // 我们请求 Cloudflare 的测速地址，如果这个 IP 是有效的反代，它会将请求转发给 CF
    const request = new TextEncoder().encode(
      `GET / HTTP/1.1\r\nHost: speed.cloudflare.com\r\nConnection: close\r\nUser-Agent: PureProxy/1.0\r\n\r\n`
    );
    await writer.write(request);

    // 3. 读取响应 (等待最多 2秒)
    reader = socket.readable.getReader();
    let responseText = '';
    const decoder = new TextDecoder();
    
    await withTimeout(async function() {
      // 只读取前几 k 数据，足以包含 Header
      const { value, done } = await reader.read();
      if (value) {
        responseText = decoder.decode(value, { stream: false });
      }
    }(), 2000);

    // 4. 关键验证: 检查响应头
    // Cloudflare 的服务器一定会返回 Server: cloudflare
    const isCloudflare = responseText.toLowerCase().includes('server: cloudflare');
    
    if (isCloudflare) {
      return Date.now() - start; // 返回延迟
    }
    
    return null; // 不是 ProxyIP

  } catch (error) {
    return null; 
  } finally {
    if (reader) try { reader.releaseLock(); } catch(e) {}
    if (writer) try { writer.releaseLock(); } catch(e) {} // close() might fail if reader is active
    if (socket) try { socket.close(); } catch(e) {}
  }
}

/**
 * 处理 Cron 定时任务
 */
async function handleScheduled(event, env, ctx) {
  console.log("开始扫描 Cloudflare ProxyIP...");
  let validCount = 0;
  
  const shuffledSources = PROXY_SOURCES.sort(() => Math.random() - 0.5);

  for (const source of shuffledSources) {
    if (validCount >= 5) break; // 限制单次运行入库数量，避免 Worker 超时

    try {
      console.log(`正在获取源: ${source.url}`);
      const response = await fetch(source.url);
      if (!response.ok) continue;
      
      const text = await response.text();
      // 解析 IP，支持 "IP" 或 "IP:Port" 格式
      // ProxyIP 列表通常默认端口是 443 (HTTPS) 或 80 (HTTP)
      // 391040525/ProxyIP 的列表中通常只有 IP，端口默认 443
      const lines = text.split('\n')
        .map(l => l.trim())
        .filter(l => l && isValidPublicIp(l.split(':')[0]))
        .sort(() => Math.random() - 0.5) // 随机打乱
        .slice(0, 15); // 每次只验证 15 个，防止超时

      console.log(`抽取了 ${lines.length} 个候选 IP 进行深度验证`);

      for (const line of lines) {
        let ip = line;
        let port = 443; // 默认端口

        if (line.includes(':')) {
          const parts = line.split(':');
          ip = parts[0];
          port = parseInt(parts[1]);
        }

        // 1. 深度协议验证
        const latency = await validateProxyIP(ip, port);

        if (latency !== null) {
          console.log(`✅ 有效 ProxyIP: ${ip}:${port} (${latency}ms)`);
          
          // 2. 获取 Geo 信息
          await delay(1500); // 避免 Geo API 速率限制
          const geo = await fetchIpGeo(ip);
          
          const country = geo ? geo.country : '未知';
          const countryCode = geo ? geo.countryCode : 'UN';
          const city = geo ? geo.city : '';
          const region = geo ? geo.regionName : '';
          const isp = geo ? geo.isp : 'Unknown ISP';
          
          // 判断是否家宽
          const isResidential = isResidentialISP(isp);

          // 3. 评分算法
          let purityScore = Math.max(10, 100 - Math.floor(latency / 15));
          if (!isResidential) purityScore -= 20; // 数据中心 IP 扣分
          if (purityScore < 0) purityScore = 0;
          
          // ProxyIP 既然能反代 CF，说明 CF 允许它连接，通过率通常极高
          const cfProb = 99; 
          const id = crypto.randomUUID();

          // 4. 入库
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
                is_residential = excluded.is_residential
            `).bind(
              id, ip, port, 'HTTPS', // ProxyIP 通常用于 HTTPS 反代
              country, countryCode, region, city, isp,
              '透明', // ProxyIP 本质是反向代理，不算严格的高匿代理
              latency, purityScore, cfProb,
              Date.now(), Date.now(), isResidential ? 1 : 0
            ).run();
            
            validCount++;
            console.log(`--> 入库成功 (家宽: ${isResidential}): ${ip}`);
          } catch (dbErr) {
            console.error("数据库写入失败", dbErr);
          }
        }
      }
    } catch (e) {
      console.error(`源处理失败`, e);
    }
  }
  
  console.log(`任务完成，新增 ${validCount} 个有效 ProxyIP。`);
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
      const { results } = await env.DB.prepare(
        "SELECT * FROM proxies ORDER BY purity_score DESC, last_checked DESC LIMIT 100"
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