
import { ProxyIP, ProxyProtocol, AnonymityLevel, RiskLevel, ProxyType } from '../types';
import { MOCK_COUNTRIES, MOCK_ISPS } from '../constants';

// Helper to generate random integer
const randomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1) + min);
const randomItem = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const generateId = () => Math.random().toString(36).substr(2, 9);

// 后端 API 地址
const API_BASE_URL = process.env.REACT_APP_API_URL || ''; 

/**
 * 获取代理列表 (从数据库)
 * @param type 'proxy' | 'best'
 */
export const fetchProxies = async (type: ProxyType = ProxyType.PROXY): Promise<ProxyIP[]> => {
  if (API_BASE_URL || window.location.hostname.includes('workers.dev')) {
    try {
      const url = API_BASE_URL 
        ? `${API_BASE_URL}/api/proxies?type=${type}` 
        : `/api/proxies?type=${type}`;
        
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
  // 如果没有后端，返回空或模拟数据
  return []; 
};

/**
 * 手动分析 IP 列表 (V22 已弃用手动大量输入，但保留函数签名以防报错)
 */
export const analyzeCustomIPs = async (ips: string[]): Promise<ProxyIP[]> => {
    return [];
};
