
import { connect } from 'cloudflare:sockets';

// 配置常量
const BATCH_SIZE = 20; // 并发验证数量 (Cloudflare 限制子请求并发数，建议 20-50)
const SCAN_LIMIT = 200; // 单次 Cron 运行扫描的最大 IP 数 (免费版 30秒限制，200 是安全值)

// Cloudflare 官方 IP 段 (CIDR)
// 用于过滤掉 Cloudflare 自己的 IP，防止 Worker 连接回环错误
const CF_IPV4_CIDRS = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'
];

// 数据源配置 (精简为高质量源)
const PROXY_SOURCES = [
  {
    name: 'vfarid/CF-Scanner (推荐)',
    url: 'https://cdn.jsdelivr.net/gh/vfarid/cf-ip-scanner@master/ipv4.txt'
  },
  {
    name: 'Monosans/All (海量)',
    url: 'https://cdn.jsdelivr.net/gh/monosans/proxy-list@main/proxies/all.txt'
  },
  {
    name: '391040525/Active (备用)',
    url: 'https://cdn.jsdelivr.net/gh/391040525/ProxyIP@main/active.txt'
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

// 辅助函数: IP 转数值
function ipToLong(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

// 辅助函数: 检查 IP 是否在 CIDR 范围内
function isIpInCidr(ip, cidr) {
  const [range, bits] = cidr.split('/');
  const mask = ~((1 << (32 - parseInt(bits, 10))) - 1);
  return (ipToLong(ip) & mask) === (ipToLong(range) & mask);
}

// 核心: 检查是否为 Cloudflare IP
function isCloudflareIP(ip) {
  if (!ip) return false;
  return CF_IPV4_CIDRS.some(cidr => isIpInCidr(ip, cidr));
}

/**
 * 终极暴力提取 IP
 */
function extractIPs(text) {
  if (!text) return [];
  const candidates = new Set();
  const regex = /(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?/g;
  
  try {
    const cleanText = text.replace(/\s/g, '');
    if (cleanText.length > 20 && /^[a-zA-Z0-9+/]+={0,2}$/.test(cleanText)) {
      const decoded = atob(cleanText);
      const matches = decoded.match(regex);
      if (matches) matches.forEach(ip => candidates.add(ip));
    }
  } catch (e) {}

  const matches = text.match(regex);
  if (matches) matches.forEach(ip => candidates.add(ip));
  
  return Array.from(candidates);
}

/**
 * 判断是否为合法公网 IPv4
 */
function isValidPublicIp(ip) {
  if (!ip) return false;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  if (parts.some(p => isNaN(p) || p < 0 || p > 255)) return false;

  const [a, b] = parts;
  // 排除内网和保留地址
  if (a === 10) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 127) return false;
  if (a === 0) return false;
  
  // 关键: 排除 Cloudflare 自己的 IP
  if (isCloudflareIP(ip)) return false;

  return true;
}

/**
 * 判断是否为家宽 ISP
 */
function isResidentialISP(ispName) {
  if (!ispName) return false;
  const lower = ispName.toLowerCase();
  const resKw = ['cable', 'dsl', 'fios', 'broadband', 'telecom', 'mobile', 'verizon', 'comcast', 'at&t', 'vodafone', 'residential', 'home', 'spectrum', 'cox'];
  const dcKw = ['cloud', 'data', 'center', 'hosting', 'server', 'vps', 'amazon', 'google', 'microsoft', 'alibaba', 'digitalocean', 'cloudflare', 'oracle', 'linode'];

  if (dcKw.some(k => lower.includes(k))) return false;
  if (resKw.some(k => lower.includes(k))) return true;
  return false;
}

/**
 * 获取 IP 的真实地理位置信息
 */
async function fetchIpGeo(ip) {
  try {
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,isp&lang=zh-CN`, {
        headers: { 'User-Agent': 'PureProxy/1.0' }
    });
    if (response.ok) {
      const data = await response.json();
      if (data.status === 'success') return data;
    }
  } catch (e) {}
  return null;
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
    // 1. 建立 TCP 连接 (1.5秒超时)
    await withTimeout(async function() {
      socket = connect({ hostname: ip, port: port });
      writer = socket.writable.getWriter();
      return writer.ready;
    }(), 1500);

    // 2. 发送 HTTP 请求探测
    const request = new TextEncoder().encode(
      `GET / HTTP/1.1\r\nHost: speed.cloudflare.com\r\nConnection: close\r\nUser-Agent: PureProxy/ScanBot\r\n\r\n`
    );
    await writer.write(request);

    reader = socket.readable.getReader();
    let responseText = '';
    const decoder = new TextDecoder();
    
    // 3. 读取响应 (2秒超时)
    await withTimeout(async function() {
      const { value } = await reader.read();
      if (value) responseText = decoder.decode(value);
    }(), 2000); 

    // 4. 关键判据
    if (responseText.toLowerCase().includes('server: cloudflare')) {
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
 * 处理单个 IP 的完整流程 (验证 + Geo + 格式化)
 */
async function processIP(line) {
  const parts = line.split(':');
  let ip = parts[0];
  let port = parts.length > 1 ? parseInt(parts[1], 10) : 443;
  if (isNaN(port)) port = 443;

  const latency = await validateProxyIP(ip, port);
  if (latency !== null) {
    // 验证成功后，随机延迟 100-500ms 防止 Geo API 速率限制
    await delay(Math.floor(Math.random() * 400) + 100);
    const geo = await fetchIpGeo(ip);
    
    const country = geo ? geo.country : '未知';
    const countryCode = geo ? geo.countryCode : 'UN';
    const city = geo ? geo.city : '';
    const region = geo ? geo.regionName : '';
    const isp = geo ? geo.isp : 'Unknown ISP';
    const isResidential = isResidentialISP(isp);

    // 计算纯净度
    let purityScore = 60;
    if (latency < 300) purityScore += 10;
    if (isResidential) purityScore += 25;
    if (countryCode === 'US' || countryCode === 'SG' || countryCode === 'JP') purityScore += 15;
    purityScore = Math.min(100, purityScore);

    return {
      id: crypto.randomUUID(),
      ip, port,
      protocol: 'HTTPS',
      country, country_code: countryCode,
      region, city, isp,
      is_residential: isResidential ? 1 : 0,
      anonymity: '透明', // 反代 IP 多数是透明的
      latency,
      purity_score: purityScore,
      cf_pass_prob: 99,
      last_checked: Date.now(),
      created_at: Date.now()
    };
  }
  return null;
}

async function handleScheduled(event, env, ctx) {
  console.log("开始扫描 Cloudflare ProxyIP (并发批处理模式)...");
  let candidates = [];
  
  // 1. 获取源
  const fetchPromises = PROXY_SOURCES.map(async (source) => {
    try {
      const url = `${source.url}?t=${Date.now()}`;
      const response = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0 Safari/537.36' }
      });

      if (response.ok) {
        const text = await response.text();
        const ips = extractIPs(text);
        console.log(`[Source] ${source.name}: 状态 ${response.status} (解析: ${ips.length} 个)`);
        return ips;
      }
    } catch (e) {
      console.error(`[Source] Error ${source.name}:`, e.message);
    }
    return [];
  });

  const results = await Promise.all(fetchPromises);
  results.forEach(ips => candidates.push(...ips));
  candidates = [...new Set(candidates)]; // 简单去重
  
  // 2. 预清洗 (过滤内网和 CF 回环)
  const initialCount = candidates.length;
  candidates = candidates.filter(ipStr => {
    const ip = ipStr.split(':')[0];
    return isValidPublicIp(ip);
  });
  console.log(`IP 清洗: ${initialCount} -> ${candidates.length} (候选池)`);
  
  if (candidates.length === 0) return;

  // 3. 截取处理队列 (最大 200 个，随机打乱)
  const queue = candidates.sort(() => Math.random() - 0.5).slice(0, SCAN_LIMIT);
  console.log(`本次批处理队列: ${queue.length} 个 IP (Batch Size: ${BATCH_SIZE})`);

  // 4. 并发批处理验证
  let validProxies = [];
  
  for (let i = 0; i < queue.length; i += BATCH_SIZE) {
    const chunk = queue.slice(i, i + BATCH_SIZE);
    // 并行执行当前批次
    const results = await Promise.all(chunk.map(ip => processIP(ip)));
    // 收集有效结果
    const valid = results.filter(r => r !== null);
    validProxies.push(...valid);
    
    if (valid.length > 0) {
        console.log(`   批次 ${i/BATCH_SIZE + 1}: 发现 ${valid.length} 个有效`);
    }
  }

  console.log(`扫描结束。共发现 ${validProxies.length} 个有效 ProxyIP。准备写入数据库...`);

  // 5. 批量写入 D1 (使用 batch 减少数据库交互次数)
  if (validProxies.length > 0) {
    try {
      const statements = validProxies.map(p => {
        return env.DB.prepare(`
          INSERT INTO proxies (id, ip, port, protocol, country, country_code, region, city, isp, anonymity, latency, purity_score, cf_pass_prob, last_checked, created_at, is_residential)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(ip, port) DO UPDATE SET
            latency = excluded.latency, 
            last_checked = excluded.last_checked, 
            purity_score = excluded.purity_score, 
            is_residential = excluded.is_residential
        `).bind(
          p.id, p.ip, p.port, p.protocol, p.country, p.country_code, p.region, p.city, p.isp,
          p.anonymity, p.latency, p.purity_score, p.cf_pass_prob, p.last_checked, p.created_at, p.is_residential
        );
      });

      // D1 的 batch 限制通常是 128 条左右，如果非常多，建议再分片
      const dbChunks = [];
      const DB_BATCH_LIMIT = 50; 
      for (let i = 0; i < statements.length; i += DB_BATCH_LIMIT) {
          dbChunks.push(statements.slice(i, i + DB_BATCH_LIMIT));
      }

      for (const chunk of dbChunks) {
          await env.DB.batch(chunk);
      }
      
      console.log("数据库写入成功！");
    } catch (err) {
      console.error('DB Batch Error', err);
    }
  }
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (url.pathname === '/api/proxies') {
    try {
      // 增加 is_residential 排序权重
      const { results } = await env.DB.prepare(
        "SELECT * FROM proxies ORDER BY is_residential DESC, purity_score DESC LIMIT 100"
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

  return new Response("PureProxy Worker API (Batch Mode)", { headers: corsHeaders });
}

export default {
  async fetch(request, env, ctx) { return handleRequest(request, env); },
  async scheduled(event, env, ctx) { ctx.waitUntil(handleScheduled(event, env, ctx)); }
};
