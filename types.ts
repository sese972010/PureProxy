import { Type } from '@google/genai';

export enum ProxyProtocol {
  HTTP = 'HTTP',
  HTTPS = 'HTTPS',
  SOCKS4 = 'SOCKS4',
  SOCKS5 = 'SOCKS5',
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
  country: string;
  countryCode: string; // ISO 3166-1 alpha-2
  region?: string; // New: State/Province
  city?: string;   // New: City
  anonymity: AnonymityLevel;
  latency: number; // in ms
  uptime?: number; // percentage (optional now)
  purityScore: number; // 0-100
  cloudflarePassProbability: number; // 0-100
  riskLevel: RiskLevel;
  isp: string;
  isResidential?: boolean; // New: Is Residential ISP
  lastChecked: number | Date; // Allow number (timestamp from DB) or Date object
}

export interface FilterState {
  country?: string;
  protocol?: ProxyProtocol;
  anonymity?: AnonymityLevel;
  maxLatency?: number;
  minPurity?: number;
  cfCompatible?: boolean;
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

// Gemini Schema for structured output
export const AnalysisSchema = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING, description: "IP ISP 和地理位置背景的简要摘要。" },
    riskAssessment: { type: Type.STRING, description: "关于该 IP 为何有风险或为何纯净的详细评估。" },
    usageRecommendation: { type: Type.STRING, description: "推荐的使用场景（例如：数据抓取、一般浏览、避免使用）。" }
  },
  required: ["summary", "riskAssessment", "usageRecommendation"]
};