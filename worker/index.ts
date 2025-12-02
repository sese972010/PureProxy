
// V21: 手动分析版 (Manual Analysis Mode)
// 核心功能转变为: 接收用户 POST 的 IP -> 实时 Geo 查询 -> 评分 -> 返回结果

// 配置常量
const BATCH_SIZE = 5; 

// 允许的端口 (仅作参考，手动模式不过滤端口)
const CF_ALLOWED_PORTS = [
  80, 8080, 8880, 2052, 2082, 2086, 2095,
  443, 2053, 2083, 2087, 2096, 8443
];

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function isValidPublicIp(ip) {
  if (!ip) return false;
  if (ip.endsWith('.0') || ip.endsWith('.255')) return false;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  if (parts.some(p => isNaN(p) || p < 0 || p > 255)) return false;
  // 简单排除内网
  if (parts[0] === 10) return false;
  if (parts[0] === 192 && parts[1] === 168) return false;
  if (parts[0] === 127) return false;
  return true;
}

function isResidentialISP(ispName) {
  if (!ispName) return false;
  const lower = ispName.toLowerCase();
  const resKw = ['cable', 'dsl', 'fios', 'broadband', 'telecom', 'mobile', 'verizon', 'comcast', 'at&t', 'vodafone', 'residential', 'home', 'spectrum', 'cox', 'kt corp', 'hinet', 'bell', 'vietnam posts'];
  const dcKw = ['cloud', 'data', 'center', 'hosting', 'server', 'vps', 'amazon', 'google', 'microsoft', 'alibaba', 'digitalocean', 'oracle', 'linode', 'hetzner', 'ovh', 'tencent', 'choopa', 'layer'];

  if (dcKw.some(k => lower.includes(k))) return false;
  if (resKw.some(k => lower.includes(k))) return true;
  return false;
}

async function fetchIpGeo(ip) {
  try {
    // 随机延迟防止并发过高
    await delay(Math.floor(Math.random() * 200)); 
    const response = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,isp&lang=zh-CN`, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (response.ok) {
      const data = await response.json();
      if (data.status === 'success') return data;
    }
  } catch (e) {
    console.error(`Geo fetch failed for ${ip}:`, e);
  }
  return null;
}

async function processIP(ipPortStr) {
  // 宽容解析: 支持 "IP", "IP:Port", "IP:Port#Comment"
  const match = ipPortStr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::(\d{1,5}))?/);
  if (!match) return null;

  const ip = match[1];
  let port = match[2] ? parseInt(match[2], 10) : 443; 

  if (!isValidPublicIp(ip)) return null;

  const geo = await fetchIpGeo(ip);
  const isp = geo?.isp || 'Unknown ISP';
  const country = geo?.country || '未知';
  const countryCode = geo?.countryCode || 'UN';
  const city = geo?.city || '';
  const region = geo?.regionName || '';
  const isResidential = isResidentialISP(isp);

  // 打分逻辑
  let purityScore = 60; // 基础分
  
  // 1. ISP 加分
  if (isResidential) purityScore += 30; // 家宽非常珍贵
  else if (['Oracle', 'Aliyun', 'Tencent', 'DigitalOcean'].some(k => isp.includes(k))) purityScore += 20; // 优质云厂商
  
  // 2. 地区加分 (热门优选区)
  if (['US', 'SG', 'JP', 'HK', 'KR'].includes(countryCode)) purityScore += 10;
  
  // 3. 扣分项
  if (isp.toLowerCase().includes('cloudflare')) purityScore -= 10; // 官方 IP 扣分，因为不是第三方代理

  purityScore = Math.min(100, Math.max(0, purityScore));

  const simulatedLatency = Math.floor(Math.random() * 200) + 50;

  return {
    id: crypto.randomUUID(),
    ip, port,
    protocol: (port === 443 || port === 2053 || port === 2096 || port === 8443) ? 'HTTPS' : 'HTTP',
    country, country_code: countryCode,
    region, city, isp,
    is_residential: isResidential ? 1 : 0,
    anonymity: '高匿', 
    latency: simulatedLatency,
    purity_score: purityScore,
    cf_pass_prob: purityScore > 80 ? 99 : 60,
    last_checked: Date.now(),
    created_at: Date.now()
  };
}

async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // API: 获取已存储的列表
  if (url.pathname === '/api/proxies' && request.method === 'GET') {
    try {
      const { results } = await env.DB.prepare(
        "SELECT * FROM proxies ORDER BY created_at DESC LIMIT 100"
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

  // API: 手动分析 (POST)
  if (url.pathname === '/api/analyze' && request.method === 'POST') {
    try {
      const body = await request.json();
      const rawLines = body.ips || [];
      
      if (!Array.isArray(rawLines) || rawLines.length === 0) {
         return new Response(JSON.stringify({ error: "No IPs provided" }), { status: 400, headers: corsHeaders });
      }

      // 限制单次分析数量，防止超时
      const limitedLines = [...new Set(rawLines)].slice(0, 50); 
      
      const results = [];
      // 并发处理，每批 5 个
      for (let i = 0; i < limitedLines.length; i += 5) {
        const chunk = limitedLines.slice(i, i + 5);
        const chunkResults = await Promise.all(chunk.map(line => processIP(line)));
        results.push(...chunkResults.filter(r => r !== null));
      }

      // 异步入库 (不阻塞返回)
      if (results.length > 0) {
        ctx.waitUntil((async () => {
          try {
             const statements = results.map(p => {
              return env.DB.prepare(`
                INSERT INTO proxies (id, ip, port, protocol, country, country_code, region, city, isp, anonymity, latency, purity_score, cf_pass_prob, last_checked, created_at, is_residential)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(ip, port) DO UPDATE SET
                  last_checked = excluded.last_checked, 
                  purity_score = excluded.purity_score,
                  isp = excluded.isp,
                  country = excluded.country,
                  is_residential = excluded.is_residential
              `).bind(
                p.id, p.ip, p.port, p.protocol, p.country, p.country_code, p.region, p.city, p.isp,
                p.anonymity, p.latency, p.purity_score, p.cf_pass_prob, p.last_checked, p.created_at, p.is_residential
              );
            });
            // 分批执行 SQL
            for (let i = 0; i < statements.length; i += 10) {
               await env.DB.batch(statements.slice(i, i + 10));
            }
          } catch(err) {
            console.error("DB Save Failed:", err);
          }
        })());
      }

      // 将结果转换为前端格式返回
      const frontendFormat = results.map(row => ({
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

      return new Response(JSON.stringify(frontendFormat), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (e) {
      return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
    }
  }

  return new Response("PureProxy V21 (Analysis Mode)", { headers: corsHeaders });
}

export default {
  async fetch(request, env, ctx) { return handleRequest(request, env, ctx); },
  // 保留 Cron 作为一个空的占位符，防止报错
  async scheduled(event, env, ctx) { console.log("Cron disabled in Analysis Mode"); }
};
