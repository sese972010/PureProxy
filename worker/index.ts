import { connect } from 'cloudflare:sockets';

// Cloudflare ProxyIP 专用数据源 (兜底用)
// 包含 ymyuuu/IPDB (高质量聚合) 和 391040525/ProxyIP (专用反代)
const PROXY_SOURCES = [
  {
    name: 'ymyuuu/IPDB (Best Proxy)',
    url: 'https://raw.githubusercontent.com/ymyuuu/IPDB/main/bestproxy.txt',
    type: 'base64' // 通常是 Base64 订阅格式
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
 * 尝试 Base64 解码 (增强版)
 */
function tryDecode(content) {
  try {
    const cleaned = content.trim().replace(/\s/g, '');
    // 如果不包含空格且长度较长，或者是典型的 Base64 字符，尝试解码
    if (/^[A-Za-z0-9+/=]+$/.test(cleaned) && cleaned.length % 4 === 0) {
      return atob(cleaned);
    }
    return content;
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
    'residental', 'dynamic', 'residential', 'home', 'consumer'
  ];

  const datacenterKeywords = [
    'cloud', 'data', 'center', 'hosting', 'server', 'vps', 'dedicated',
    'amazon', 'aws', 'google', 'microsoft', 'azure', 'alibaba', 'tencent',
    'digitalocean', 'linode', 'vultr', 'ovh', 'hetzner', 'choopa', 'm247',
    'oracle', 'fly.io', 'cloudflare', 'akamai', 'cdn77', 'host'
  ];

  // 优先排除已知数据中心
  if (datacenterKeywords.some(k => lower.includes(k))) return false;
  // 匹配家宽关键词
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
    }(), 1500); // 连接超时 1.5s

    // 发送伪造的 Cloudflare 请求
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
    }(), 2000); // 读取超时 2s

    // 只要响应头包含 Server: cloudflare，就是有效的反代 IP
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
  // 优化语法: 锁定 Cloudflare + 美国。去掉了 protocol="https" 以兼容部分免费账号。
  // 注意: country="US" 有时也需要积分，如果报错 820000，请改为 server=="cloudflare" && port="443"
  const query = 'server=="cloudflare" && port="443" && country="US"';
  const qbase64 = btoa(query);
  
  // size=45: 免费版通常前 100 条免费，取 45 条够用
  const url = `https://fofa.info/api/v1/search/all?email=${email}&key=${key}&qbase64=${qbase64}&size=45&fields=ip,port`;
  
  console.log(`[FOFA] 正在请求 FOFA API (US Only)...`);
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.error) {
      // 关键修复: 读取 errmsg 而不是 message
      console.warn(`[FOFA] API 错误: ${data.errmsg || JSON.stringify(data)}`);
      return [];
    }
    
    console.log(`[FOFA] 成功获取 ${data.results.length} 个美国节点`);
    return data.results.map(item => `${item[0]}:${item[1]}`);
  } catch (e) {
    console.error(`[FOFA] 网络异常:`, e);
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
  
  // 1. 优先尝试 FOFA (如果配置了)
  if (env.FOFA_EMAIL && env.FOFA_KEY) {
    const fofaIps = await fetchFromFOFA(env.FOFA_EMAIL, env.FOFA_KEY);
    candidates = [...candidates, ...fofaIps];
  } else {
    console.log("[FOFA] 未配置 API Key，跳过");
  }

  // 2. 只有当 FOFA 返回数据太少 (<10) 时，才去公共源补充
  // 这样可以节省公共源解析资源，同时保证"纯净度"优先使用 FOFA
  if (candidates.length < 10) {
    console.log(`[Source] FOFA 数据不足 (${candidates.length})，切换到公共聚合源补充...`);
    
    for (const source of PROXY_SOURCES) {
      if (candidates.length >= 50) break; // 够了就不抓了

      try {
        console.log(`[Source] 正在获取: ${source.name}`);
        const response = await fetch(source.url);
        
        if (response.ok) {
          let text = await response.text();
          // 尝试解码
          text = tryDecode(text);
          
          // 优化正则: 支持 ip:port 格式，忽略前后杂质
          const lines = text.split(/[\r\n]+/)
            .map(l => {
               // 提取 IP:Port
               const match = l.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})[:\s](\d+)/);
               if (match) return `${match[1]}:${match[2]}`;
               return null;
            })
            .filter(l => l !== null)
            .filter(l => isValidPublicIp(l.split(':')[0]));
          
          if (lines.length > 0) {
            console.log(`   └─ 解析出 ${lines.length} 个 IP`);
            // 随机打乱取 30 个，防止每次都验前面几个
            candidates = [...candidates, ...lines.sort(() => Math.random() - 0.5).slice(0, 30)];
          }
        }
      } catch (e) {
        console.error(`[Source] 获取失败: ${source.name}`, e);
      }
    }
  }

  // 去重
  candidates = [...new Set(candidates)];
  console.log(`本次扫描队列: ${candidates.length} 个 IP (去重后)`);
  
  if (candidates.length === 0) return;

  // 3. 验证与打分
  for (const line of candidates) {
    // 每次任务最多入库 8 个，防止超时 (Cloudflare 免费版 CPU 时间限制)
    if (validCount >= 8) break; 

    const parts = line.split(':');
    const ip = parts[0];
    const port = parseInt(parts[1]);

    // 验证
    const latency = await validateProxyIP(ip, port);

    if (latency !== null) {
      console.log(`✅ [Valid] ${ip}:${port} (${latency}ms)`);
      
      // 获取 Geo 信息
      await delay(1200); // 礼貌请求 Geo API
      const geo = await fetchIpGeo(ip);
      
      const country = geo ? geo.country : '未知';
      const countryCode = geo ? geo.countryCode : 'UN';
      const city = geo ? geo.city : '';
      const region = geo ? geo.regionName : '';
      const isp = geo ? geo.isp : 'Unknown ISP';
      const isResidential = isResidentialISP(isp);

      // --- 打分逻辑 (Score Strategy) ---
      // 基础分 60
      let purityScore = 60;
      
      // 1. 延迟越低分越高
      if (latency < 200) purityScore += 20;
      else if (latency < 500) purityScore += 10;
      
      // 2. 家宽大幅加分 (用户指定优先)
      if (isResidential) {
        purityScore += 20; 
        console.log(`   🏠 发现家宽 IP!`);
      }
      
      // 3. 美国 IP 加分 (用户指定定向)
      if (countryCode === 'US') {
        purityScore += 10;
        console.log(`   🇺🇸 美国节点`);
      } else {
        // 非美国 IP 略微减分，因为我们要定向 US
        purityScore -= 5;
      }
      
      // 封顶 100
      purityScore = Math.min(100, Math.max(0, purityScore));

      // 4. 入库
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
            region = excluded.region,
            country = excluded.country,
            country_code = excluded.country_code,
            isp = excluded.isp
        `).bind(
          id, ip, port, 'HTTPS',
          country, countryCode, region, city, isp,
          '透明', // ProxyIP 是反代，不算高匿
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
      // 排序逻辑: 
      // 1. 家宽优先 (is_residential desc)
      // 2. 纯净度高优先 (purity_score desc)
      // 3. 最新检测优先
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