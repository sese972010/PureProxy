import { connect } from 'cloudflare:sockets';

// 核心数据源 (使用 jsDelivr CDN 加速，解决 GitHub Raw 访问不稳定的问题)
const PROXY_SOURCES = [
  {
    name: '391040525/ProxyIP (Active - 推荐)',
    // 原地址: raw.githubusercontent.com/391040525/ProxyIP/main/active.txt
    url: 'https://cdn.jsdelivr.net/gh/391040525/ProxyIP@main/active.txt' 
  },
  {
    name: 'ymyuuu/IPDB (Best Proxy)',
    // 原地址: raw.githubusercontent.com/ymyuuu/IPDB/main/bestproxy.txt
    url: 'https://cdn.jsdelivr.net/gh/ymyuuu/IPDB@main/bestproxy.txt'
  },
  {
    name: 'vfarid/cf-ip-scanner',
    // 原地址: raw.githubusercontent.com/vfarid/cf-ip-scanner/master/ipv4.txt
    url: 'https://cdn.jsdelivr.net/gh/vfarid/cf-ip-scanner@master/ipv4.txt'
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
 * 暴力提取 IP:Port
 * 无论内容是 Base64、JSON 还是普通文本，只要有 IP:Port 格式就能提出来
 */
function extractIPs(text) {
  if (!text) return [];
  const candidates = new Set();
  
  // 1. 尝试 Base64 解码
  try {
    // 移除可能存在的空白字符，提高解码成功率
    const cleanText = text.replace(/\s/g, '');
    if (cleanText.length > 20) {
      const decoded = atob(cleanText);
      // 正则提取解码后内容中的 IP
      const decodedMatches = decoded.match(/\b(?:\d{1,3}\.){3}\d{1,3}:\d+\b/g);
      if (decodedMatches) {
        decodedMatches.forEach(ip => candidates.add(ip));
      }
    }
  } catch (e) {
    // 解码失败忽略
  }

  // 2. 原文暴力匹配 (应对纯文本列表)
  const regex = /\b(?:\d{1,3}\.){3}\d{1,3}:\d+\b/g;
  const matches = text.match(regex);
  if (matches) {
    matches.forEach(ip => candidates.add(ip));
  }
  
  return Array.from(candidates);
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
  if (part0 === 215) return false; // DoD
  
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
    'residental', 'dynamic', 'residential', 'home', 'consumer', 'ipoe'
  ];

  const datacenterKeywords = [
    'cloud', 'data', 'center', 'hosting', 'server', 'vps', 'dedicated',
    'amazon', 'aws', 'google', 'microsoft', 'azure', 'alibaba', 'tencent',
    'digitalocean', 'linode', 'vultr', 'ovh', 'hetzner', 'choopa', 'm247',
    'oracle', 'fly.io', 'cloudflare', 'akamai', 'cdn77', 'host', 'colocation'
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
    // 增加 User-Agent 防止 API 拦截
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,regionName,city,isp,org,as&lang=zh-CN`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
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
    }(), 1500); // 连接超时

    // 发送 Cloudflare 探测包
    const request = new TextEncoder().encode(
      `GET / HTTP/1.1\r\nHost: speed.cloudflare.com\r\nConnection: close\r\nUser-Agent: PureProxy/1.0\r\n\r\n`
    );
    await writer.write(request);

    reader = socket.readable.getReader();
    let responseText = '';
    const decoder = new TextDecoder();
    
    // 读取响应
    await withTimeout(async function() {
      const { value, done } = await reader.read();
      if (value) {
        responseText = decoder.decode(value, { stream: false });
      }
    }(), 2500); 

    // 检查是否包含 Cloudflare 特征头
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

async function handleScheduled(event, env, ctx) {
  console.log("开始扫描 Cloudflare ProxyIP...");
  let candidates = [];
  
  // 1. 从公共源获取 (使用 jsDelivr CDN)
  const fetchPromises = PROXY_SOURCES.map(async (source) => {
    try {
      // 强制添加时间戳参数，防止 CDN 缓存
      const urlWithCacheBust = `${source.url}?t=${Date.now()}`;
      console.log(`[Source] 正在获取: ${source.name}`);
      
      const response = await fetch(urlWithCacheBust, {
          headers: {
              // 模拟真实浏览器，防止 GitHub/CDN 拦截
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          }
      });

      if (response.ok) {
        const text = await response.text();
        console.log(`[Source] ${source.name} 状态码: ${response.status}, 内容长度: ${text.length}`);
        
        if (text.length < 50) {
             console.warn(`[Source] 内容过短，可能获取失败: ${text}`);
        }

        const ips = extractIPs(text); 
        console.log(`   └─ 暴力解析出 ${ips.length} 个 IP`);
        return ips;
      } else {
        console.warn(`[Source] ${source.name} 失败，状态码: ${response.status}`);
      }
    } catch (e) {
      console.error(`[Source] 错误 ${source.name}:`, e);
    }
    return [];
  });

  const results = await Promise.all(fetchPromises);
  results.forEach(ips => candidates.push(...ips));

  // 去重
  candidates = [...new Set(candidates)];
  
  if (candidates.length === 0) {
    console.log("❌ 未获取到任何 IP，请检查网络或源状态");
    return;
  }
  
  // 随机抽取 50 个进行验证
  const batch = candidates.sort(() => Math.random() - 0.5).slice(0, 50);
  console.log(`本次扫描队列: ${batch.length} 个 IP (从 ${candidates.length} 个中随机抽取)`);

  let validCount = 0;

  for (const line of batch) {
    if (validCount >= 8) break; 

    const [ip, portStr] = line.split(':');
    const port = parseInt(portStr);

    if (!isValidPublicIp(ip)) continue;

    console.log(`正在验证: ${ip}:${port}...`);
    const latency = await validateProxyIP(ip, port);

    if (latency !== null) {
      console.log(`✅ [Valid] ${ip}:${port} (${latency}ms)`);
      
      await delay(1000); 
      const geo = await fetchIpGeo(ip);
      
      const country = geo ? geo.country : '未知';
      const countryCode = geo ? geo.countryCode : 'UN';
      const city = geo ? geo.city : '';
      const region = geo ? geo.regionName : '';
      const isp = geo ? geo.isp : 'Unknown ISP';
      const isResidential = isResidentialISP(isp);

      let purityScore = 60;
      if (latency < 300) purityScore += 15;
      if (isResidential) purityScore += 20;
      if (countryCode === 'US') purityScore += 15;
      
      purityScore = Math.min(100, Math.max(10, purityScore));

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
            is_residential = excluded.is_residential
        `).bind(
          id, ip, port, 'HTTPS',
          country, countryCode, region, city, isp,
          '透明', latency, purityScore, 99,
          Date.now(), Date.now(), isResidential ? 1 : 0
        ).run();
        
        validCount++;
      } catch (dbErr) {
        console.error("入库失败", dbErr);
      }
    }
  }
  
  console.log(`任务结束，成功入库 ${validCount} 个优质 ProxyIP`);
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
        "SELECT * FROM proxies ORDER BY purity_score DESC, is_residential DESC LIMIT 100"
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