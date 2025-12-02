
import { Type } from '@google/genai';

export enum ProxyProtocol {
  HTTP = 'HTTP',
  HTTPS = 'HTTPS',
  SOCKS4 = 'SOCKS4',
  SOCKS5 = 'SOCKS5',
}

export enum ProxyType {
  PROXY = 'proxy', // 第三方反代 (ProxyIP)
  BEST = 'best',   // Cloudflare 优选 (BestIP)
}

export enum AnonymityLevel {
  TRANSPARENT = '透明',
  ANONYMOUS = '匿名',
  ELITE = '高匿',
}

export enum RiskLevel {
  LOW = '低',
  MEDIUM = '中',
  HIGH = '高',
}

export interface ProxyIP {
  id: string;
  ip: string;
  port: number;
  protocol: ProxyProtocol;
  type: ProxyType; // New: Distinguish between ProxyIP and BestIP
  country: string;
  countryCode: string; 
  region?: string; 
  city?: string;   
  anonymity: AnonymityLevel;
  latency: number; 
  speedInfo?: string; // New: Speed test info (e.g., "CMCC")
  purityScore: number; 
  cloudflarePassProbability: number; 
  riskLevel: RiskLevel;
  isp: string;
  isResidential?: boolean; 
  lastChecked: number | Date;
}

export interface FilterState {
  country?: string;
  protocol?: ProxyProtocol;
  anonymity?: AnonymityLevel;
  maxLatency?: number;
  minPurity?: number;
  cfCompatible?: boolean;
  isResidential?: boolean;
}

export interface AIAnalysisResult {
  summary: string;
  riskAssessment: string;
  usageRecommendation: string;
}

export type AIProvider = 'google' | 'openai' | 'deepseek' | 'anthropic';

export interface AIModelConfig {
  id: string;
  name: string;
  provider: AIProvider;
}

export const AnalysisSchema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING, description: "IP ISP 和地理位置背景的简要摘要。" },
    riskAssessment: { type: Type.STRING, description: "关于该 IP 为何有风险或为何纯净的详细评估。" },
    usageRecommendation: { type: Type.STRING, description: "推荐的使用场景（例如：数据抓取、一般浏览、避免使用）。" }
  },
  required: ["summary", "riskAssessment", "usageRecommendation"]
};
