import { ProxyIP, ProxyProtocol, AnonymityLevel, RiskLevel } from '../types';
import { MOCK_COUNTRIES, MOCK_ISPS } from '../constants';

// Helper to generate random integer
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1) + min);
const randomItem = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const generateId = () => Math.random().toString(36).substr(2, 9);

// 后端 API 地址
const API_BASE_URL = process.env.REACT_APP_API_URL || ''; 

/**
 * 获取代理列表
 */
export const fetchProxies = async (): Promise<ProxyIP[]> => {
  // 如果配置了 API URL，优先请求后端
  if (API_BASE_URL || window.location.hostname.includes('workers.dev')) {
    try {
      const url = API_BASE_URL ? `${API_BASE_URL}/api/proxies` : '/api/proxies';
      console.log(`[ProxyService] 正在请求后端 Cloudflare ProxyIP 数据: ${url}`);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      console.log(`[ProxyService] 后端响应数据类型:`, Array.isArray(data) ? 'Array' : typeof data);

      if (Array.isArray(data) && data.length > 0) {
        console.log(`[ProxyService] 成功从后端获取 ${data.length} 个 ProxyIP (真实数据)`);
        return data.map((item: any) => ({
          ...item,
          lastChecked: new Date(item.lastChecked)
        }));
      } else {
        console.warn("[ProxyService] 后端返回了空数组，可能 Worker 尚未抓取到有效 IP。建议去 Cloudflare 触发 Cron Test。");
      }
    } catch (error) {
      console.warn("[ProxyService] 请求后端 API 失败，将切换到模拟模式。", error);
      console.warn("请检查: 1. Worker 是否部署成功 2. D1 数据库是否已初始化 3. REACT_APP_API_URL 环境变量是否正确");
    }
  } else {
    console.log("[ProxyService] 未配置 API_URL，使用纯前端模拟模式。");
  }

  // Fallback: 生成 50 条模拟数据
  console.log("[ProxyService] 生成 50 条模拟数据用于演示");
  return generateMockProxies(50);
};

// 生成模拟数据
const generateMockProxies = (count: number): ProxyIP[] => {
  const proxies: ProxyIP[] = [];
  for (let i = 0; i < count; i++) {
    const countryData = randomItem(MOCK_COUNTRIES);
    const purityScore = randomInt(40, 95);
    const isResidential = Math.random() > 0.7; // 30% 几率是家宽
    
    proxies.push({
      id: generateId(),
      ip: `${randomInt(1, 255)}.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(0, 255)}`,
      port: randomItem([443, 80, 8080, 2053]),
      protocol: ProxyProtocol.HTTPS,
      country: countryData.name,
      countryCode: countryData.code,
      region: '模拟省份',
      city: '模拟城市',
      anonymity: AnonymityLevel.TRANSPARENT, // ProxyIP 本质是反代
      latency: randomInt(20, 800),
      uptime: 90,
      purityScore: purityScore,
      cloudflarePassProbability: 99, // ProxyIP 通常都能过 CF
      riskLevel: purityScore > 80 ? RiskLevel.LOW : RiskLevel.MEDIUM,
      isp: randomItem(MOCK_ISPS),
      isResidential: isResidential,
      lastChecked: new Date()
    });
  }
  return proxies;
};

export const checkProxyLiveStatus = async (ip: string, port: number): Promise<boolean> => {
  await new Promise(resolve => setTimeout(resolve, 1500));
  return Math.random() > 0.5; 
};