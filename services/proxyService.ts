
import { ProxyIP, ProxyProtocol, AnonymityLevel, RiskLevel } from '../types';
import { MOCK_COUNTRIES, MOCK_ISPS } from '../constants';

// Helper to generate random integer
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1) + min);
const randomItem = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const generateId = () => Math.random().toString(36).substr(2, 9);

// 后端 API 地址
const API_BASE_URL = process.env.REACT_APP_API_URL || ''; 

/**
 * 获取代理列表 (从数据库)
 */
export const fetchProxies = async (): Promise<ProxyIP[]> => {
  if (API_BASE_URL || window.location.hostname.includes('workers.dev')) {
    try {
      const url = API_BASE_URL ? `${API_BASE_URL}/api/proxies` : '/api/proxies';
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      const data = await response.json();
      if (Array.isArray(data)) {
        return data.map((item: any) => ({
          ...item,
          lastChecked: new Date(item.lastChecked)
        }));
      }
    } catch (error) {
      console.warn("fetchProxies failed, switching to mock", error);
    }
  }
  return []; // 初始返回空，等待用户输入
};

/**
 * 手动分析 IP 列表
 */
export const analyzeCustomIPs = async (ips: string[]): Promise<ProxyIP[]> => {
  // 如果没有配置后端，直接使用模拟数据返回（演示用）
  if (!API_BASE_URL && !window.location.hostname.includes('workers.dev')) {
    console.warn("No Backend configured. Using mock analysis.");
    return Promise.resolve(generateMockProxies(ips.length));
  }

  const url = API_BASE_URL ? `${API_BASE_URL}/api/analyze` : '/api/analyze';
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ips })
    });

    if (!response.ok) {
      throw new Error(`Analysis failed: ${response.status}`);
    }

    const data = await response.json();
    return data.map((item: any) => ({
      ...item,
      lastChecked: new Date(item.lastChecked)
    }));

  } catch (error) {
    console.error("Analyze API error:", error);
    throw error;
  }
};

// 生成模拟数据 (Fallback)
const generateMockProxies = (count: number): ProxyIP[] => {
  const proxies: ProxyIP[] = [];
  for (let i = 0; i < count; i++) {
    const countryData = randomItem(MOCK_COUNTRIES);
    const purityScore = randomInt(40, 95);
    const isResidential = Math.random() > 0.7; 
    
    proxies.push({
      id: generateId(),
      ip: `${randomInt(1, 255)}.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(0, 255)}`,
      port: randomItem([443, 80, 8080, 2053]),
      protocol: ProxyProtocol.HTTPS,
      country: countryData.name,
      countryCode: countryData.code,
      region: '模拟省份',
      city: '模拟城市',
      anonymity: AnonymityLevel.ELITE,
      latency: randomInt(20, 800),
      uptime: 90,
      purityScore: purityScore,
      cloudflarePassProbability: purityScore > 80 ? 99 : 50,
      riskLevel: purityScore > 80 ? RiskLevel.LOW : RiskLevel.MEDIUM,
      isp: randomItem(MOCK_ISPS),
      isResidential: isResidential,
      lastChecked: new Date()
    });
  }
  return proxies;
};
