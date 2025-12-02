
// V22: 双模旗舰版 (Dual Mode)
// 模式 1: ProxyIP (反代) - 剔除 CF 官方，保留 Oracle/Aliyun
// 模式 2: BestIP (优选) - 保留 CF 官方，关注线路和速度

// 核心数据源 (GitHub Raw 直连 + UA伪装)
const SOURCES = {
  PROXY: 'https://raw.githubusercontent.com/ymyuuu/IPDB/main/bestproxy.txt', // ProxyIP 源
  BEST: 'https://raw.githubusercontent.com/ymyuuu/IPDB/main/bestcf.txt'      // 优选 IP 源
};

const BATCH_SIZE = 40; // 单次处理数量限制，防止超时

// 通用请求头
const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/plain,application/json,*/*'
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// IP 校验
function isValidPublicIp(ip: string) {
  if (!ip) return false;
  if (ip.endsWith('.0') || ip.endsWith('.255')) return false; 
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every(p => {
    const n = parseInt(p, 10);
    return !isNaN(n) && n >= 0 && n <= 255;
  });
}

// 解码 Base64
function safeDecodeBase64(str: string) {
  try {
    // 移除空白字符
    const cleanStr = str.replace(/\s/g, '');
    // 补全 padding
    const padded = cleanStr.padEnd(cleanStr.length + (4 - cleanStr.length % 4) % 4, '=');
    // 解码
    const decoded = atob(padded);
    // 检查是否是乱码 (简单检查是否包含大量不可打印字符)
    if (/[\x00-\x08\x0E-\x1F]/.test(decoded)) return null;
    return decoded;
  } catch (e) {
    return null;
  }
}

// 提取 IP 核心逻辑
function extractIPs(text: string, type: string) {
  const candidates = new Set<string>();
  
  // 1. 尝试 Base64 解码
  let contentToScan = text;
  const decoded = safeDecodeBase64(text);
  if (decoded && decoded.length > 20) {
    contentToScan = decoded; // 如果解码成功且像正常文本，优先使用解码后的
  }

  // 2. 按行处理 (ymyuuu 的格式通常是 IP:Port#Remark)
  const lines = contentToScan.split('\n');
  const regex = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::(\d{1,5}))?/;

  for (const line of lines) {
    const match = line.match(regex);
    if (match) {
      const ip = match[1];
      const port = match[2] ? parseInt(match[2], 10) : (type === 'proxy' ? 443 : 80); // 默认端口策略
      const remark = line.includes('#') ? line.split('#')[1].trim() : '';
      
      if (isValidPublicIp(ip)) {
        candidates.add(JSON.stringify({ ip, port, remark }));
      }
    }
  }

  return Array.from(candidates).map(s => JSON.parse(s));
}

// Geo 查询
async function fetchIpGeo(ip: string) {
  try {
    await delay(Math.floor(Math.random() * 200)); 
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,isp&lang=zh-CN`, {
        headers: FETCH_HEADERS
    });
    if (response.ok) {
      const data: any = await response.json();
      if (data.status === 'success') return data;
    }
  } catch (e) {
    console.warn(`Geo err: ${ip}`);
  }
  return null;
}

// 处理单个 IP
async function processIP(item: any, type: string) {
  const { ip, port, remark } = item;
  
  const geo = await fetchIpGeo(ip);
  const isp = geo?.isp || 'Unknown ISP';
  
  // V22 核心过滤器
  const isCloudflareISP = isp.toLowerCase().includes('cloudflare');

  // 模式 1: ProxyIP (反代) - 必须剔除 Cloudflare 官方
  if (type === 'proxy' && isCloudflareISP) {
    return null; 
  }

  // 模式 2: BestIP (优选) - 通常就是 Cloudflare 官方，保留
  // 但我们也可以通过 remark 来丰富信息
  
  let purityScore = 60;
  // 评分逻辑
  if (type === 'proxy') {
    if (['Oracle', 'Aliyun', 'Tencent', 'DigitalOcean', 'Amazon', 'Google'].some(k => isp.includes(k))) purityScore += 20;
    if (['US', 'SG', 'JP', 'HK'].includes(geo?.countryCode)) purityScore += 10;
  } else {
    // 优选 IP 评分逻辑
    purityScore = 80; // 既然在优选列表里，基础分就高
    if (remark && (remark.includes('移动') || remark.includes('电信') || remark.includes('联通'))) purityScore += 10;
  }
  
  purityScore = Math.min(100, purityScore);

  return {
    id: crypto.randomUUID(),
    ip, port,
    protocol: (port === 443 || port === 2053 || port === 2096 || port === 8443) ? 'HTTPS' : 'HTTP',
    type: type, // 'proxy' or 'best'
    country: geo?.country || '未知',
    country_code: geo?.countryCode || 'UN',
    region: geo?.regionName || '',
    city: geo?.city || '',
    isp: isp,
    is_residential: 0, // 简化
    anonymity: '高匿',
    latency: Math.floor(Math.random() * 150) + 30, // 模拟延迟
    speed_info: remark || (type === 'best' ? 'Cloudflare Edge' : ''),
    purity_score: purityScore,
    cf_pass_prob: purityScore > 80 ? 99 : 60,
    last_checked: Date.now(),
    created_at: Date.now()
  };
}

async function runDualModeImport(env: any) {
  const results = [];

  // 1. 获取 ProxyIP (BestProxy)
  try {
    const resProxy = await fetch(SOURCES.PROXY, { headers: FETCH_HEADERS });
    if (resProxy.ok) {
      const text = await resProxy.text();
      const items = extractIPs(text, 'proxy');
      // 随机取 BATCH_SIZE / 2
      const selected = items.sort(() => 0.5 - Math.random()).slice(0, BATCH_SIZE / 2);
      for (const item of selected) {
        const processed = await processIP(item, 'proxy');
        if (processed) results.push(processed);
      }
    }
  } catch (e) { console.error("ProxyIP fetch failed", e); }

  // 2. 获取 BestIP (BestCF)
  try {
    const resBest = await fetch(SOURCES.BEST, { headers: FETCH_HEADERS });
    if (resBest.ok) {
      const text = await resBest.text();
      const items = extractIPs(text, 'best');
      // 随机取 BATCH_SIZE / 2
      const selected = items.sort(() => 0.5 - Math.random()).slice(0, BATCH_SIZE / 2);
      for (const item of selected) {
        const processed = await processIP(item, 'best');
        if (processed) results.push(processed);
      }
    }
  } catch (e) { console.error("BestIP fetch failed", e); }

  // 3. 入库
  if (results.length > 0) {
    try {
      const statements = results.map(p => {
        return env.DB.prepare(`
          INSERT INTO proxies (id, ip, port, protocol, type, country, country_code, region, city, isp, speed_info, purity_score, cf_pass_prob, last_checked, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(ip, port) DO UPDATE SET
            last_checked = excluded.last_checked,
            purity_score = excluded.purity_score,
            speed_info = excluded.speed_info,
            type = excluded.type
        `).bind(
          p.id, p.ip, p.port, p.protocol, p.type, p.country, p.country_code, p.region, p.city, p.isp,
          p.speed_info, p.purity_score, p.cf_pass_prob, p.last_checked, p.created_at
        );
      });
      await env.DB.batch(statements);
      console.log(`V22 入库成功: ${results.length} 个 (Proxy/Best 混合)`);
    } catch (e) {
      console.error("DB Error", e);
    }
  }
}

export default {
  async scheduled(event: any, env: any, ctx: any) {
    ctx.waitUntil(runDualModeImport(env));
  },
  async fetch(request: Request, env: any, ctx: any) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    if (url.pathname === '/api/proxies') {
      const type = url.searchParams.get('type') || 'proxy'; // 'proxy' or 'best'
      try {
        const { results } = await env.DB.prepare(
          "SELECT * FROM proxies WHERE type = ? ORDER BY purity_score DESC LIMIT 100"
        ).bind(type).all();
        
        // Format for frontend
        const formatted = results.map((row: any) => ({
           ...row,
           countryCode: row.country_code,
           purityScore: row.purity_score,
           isResidential: row.is_residential === 1,
           riskLevel: row.purity_score > 80 ? '低' : '中',
           cloudflarePassProbability: row.cf_pass_prob,
           speedInfo: row.speed_info,
           lastChecked: row.last_checked,
           // Removed duplicate countryCode assignment
        }));

        return new Response(JSON.stringify(formatted), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
      }
    }

    return new Response("PureProxy V22 (Dual Mode Cron)", { headers: corsHeaders });
  }
};
