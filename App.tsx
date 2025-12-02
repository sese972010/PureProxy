
import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, 
  RefreshCw, 
  Filter, 
  Globe, 
  Shield, 
  Wifi, 
  Info,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Home,
  Building2,
  MapPin,
  Network,
  Zap,
  Server
} from 'lucide-react';
import { fetchProxies } from './services/proxyService';
import { ProxyIP, FilterState, ProxyProtocol, AnonymityLevel, ProxyType } from './types';
import PurityBadge from './components/PurityBadge';
import DetailModal from './components/DetailModal';

// 排序配置类型
type SortKey = 'country' | 'latency' | 'purityScore';
interface SortConfig {
  key: SortKey;
  direction: 'asc' | 'desc';
}

function App() {
  const [activeTab, setActiveTab] = useState<ProxyType>(ProxyType.PROXY);
  const [proxies, setProxies] = useState<ProxyIP[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedProxy, setSelectedProxy] = useState<ProxyIP | null>(null);
  
  // Sorting State
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'purityScore', direction: 'desc' });

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<FilterState>({
    country: undefined,
  });

  const loadData = async () => {
    setLoading(true);
    try {
      // Load data based on active tab
      const data = await fetchProxies(activeTab);
      if (data) {
        setProxies(data);
      }
    } catch (error) {
      console.error("无法获取代理列表", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [activeTab]); // Reload when tab changes

  // 动态提取现有数据中的所有国家列表
  const uniqueCountries = useMemo(() => {
    const countryMap = new Map<string, string>();
    proxies.forEach(p => {
      if (p.countryCode && p.country) {
        if (!countryMap.has(p.countryCode)) {
          countryMap.set(p.countryCode, p.country);
        }
      }
    });
    return Array.from(countryMap.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [proxies]);

  // Handle Sort Request
  const requestSort = (key: SortKey) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  // Get Sort Icon
  const getSortIcon = (key: SortKey) => {
    if (sortConfig.key !== key) return <ArrowUpDown size={14} className="ml-1 opacity-40" />;
    return sortConfig.direction === 'asc' 
      ? <ArrowUp size={14} className="ml-1 text-emerald-400" /> 
      : <ArrowDown size={14} className="ml-1 text-emerald-400" />;
  };

  const filteredAndSortedProxies = useMemo(() => {
    // 1. Filter
    let result = proxies.filter(p => {
      const matchesSearch = 
        p.ip.includes(searchTerm) || 
        p.country.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.isp.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.speedInfo && p.speedInfo.toLowerCase().includes(searchTerm.toLowerCase()));
      
      const matchesCountry = filters.country ? p.countryCode === filters.country : true;
      
      return matchesSearch && matchesCountry;
    });

    // 2. Sort
    result.sort((a, b) => {
      let aValue = a[sortConfig.key];
      let bValue = b[sortConfig.key];
      if (aValue === undefined) return 1;
      if (bValue === undefined) return -1;
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [proxies, searchTerm, filters, sortConfig]);

  return (
    <div className="min-h-screen bg-[#0f172a] text-gray-200 font-sans selection:bg-emerald-500/30">
      
      {/* Top Navigation */}
      <nav className="border-b border-gray-800 bg-[#0f172a]/80 backdrop-blur sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-cyan-600 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-900/20">
              <Shield className="text-white w-5 h-5" />
            </div>
            <span className="font-bold text-xl tracking-tight text-white">PureProxy<span className="text-emerald-500">.scan</span></span>
          </div>
          
          {/* Tabs */}
          <div className="flex bg-gray-900 p-1 rounded-lg border border-gray-700">
             <button
                onClick={() => setActiveTab(ProxyType.PROXY)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                  activeTab === ProxyType.PROXY 
                    ? 'bg-emerald-600 text-white shadow-lg' 
                    : 'text-gray-400 hover:text-white'
                }`}
             >
                ProxyIP (反代)
             </button>
             <button
                onClick={() => setActiveTab(ProxyType.BEST)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                  activeTab === ProxyType.BEST 
                    ? 'bg-blue-600 text-white shadow-lg' 
                    : 'text-gray-400 hover:text-white'
                }`}
             >
                CF 优选 IP (加速)
             </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Header Description */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
            {activeTab === ProxyType.PROXY ? (
              <><Globe className="text-emerald-400" /> 全球 ProxyIP 纯净度分析</>
            ) : (
              <><Zap className="text-blue-400" /> Cloudflare 优选节点 (CDN 加速)</>
            )}
          </h1>
          <p className="text-gray-400 max-w-2xl text-sm">
            {activeTab === ProxyType.PROXY 
              ? "自动过滤 Cloudflare 官方 IP，筛选出 Oracle, Aliyun 等优质第三方反代节点，适合 Workers 回源使用。" 
              : "收录 Cloudflare 官方优质边缘节点，已针对中国大陆三网（移动、联通、电信）进行线路优化，适合自建 CDN 加速。"}
          </p>
        </div>

        {/* Filters & Controls */}
        <div className="bg-gray-800/30 border border-gray-700/30 rounded-xl p-4 flex flex-col xl:flex-row gap-4 mb-6">
          {/* Search Input */}
          <div className="relative flex-1 w-full min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
            <input 
              type="text" 
              placeholder={activeTab === ProxyType.PROXY ? "搜索 ISP / 国家..." : "搜索 移动 / 联通 / 电信..."}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 text-gray-200 text-sm rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent block pl-10 p-2.5 transition-all"
            />
          </div>
          
          <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
            {/* Country Dropdown */}
            <div className="relative w-full sm:w-auto">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
              <select 
                className="w-full sm:w-40 bg-gray-900 border border-gray-700 text-gray-300 text-sm rounded-lg focus:ring-emerald-500 focus:border-emerald-500 block pl-9 p-2.5 appearance-none"
                value={filters.country || ''}
                onChange={(e) => setFilters(prev => ({ ...prev, country: e.target.value || undefined }))}
              >
                <option value="">所有地区</option>
                {uniqueCountries.map(([code, name]) => (
                  <option key={code} value={code}>{name}</option>
                ))}
              </select>
            </div>

            {/* Refresh (Reload DB) */}
            <button 
              onClick={loadData}
              title="重新加载数据库历史记录"
              className="w-full sm:w-auto p-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors flex items-center justify-center"
            >
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left text-gray-400">
              <thead className="text-xs text-gray-500 uppercase bg-gray-900/50 border-b border-gray-700">
                <tr>
                  <th scope="col" className="px-6 py-4 font-medium">IP 地址</th>
                  <th 
                    scope="col" 
                    className="px-6 py-4 font-medium cursor-pointer hover:text-white hover:bg-gray-800 transition-colors"
                    onClick={() => requestSort('country')}
                  >
                    <div className="flex items-center">
                      地理位置 {getSortIcon('country')}
                    </div>
                  </th>
                  <th scope="col" className="px-6 py-4 font-medium">
                    {activeTab === ProxyType.PROXY ? "ISP / 运营商" : "优选线路备注"}
                  </th>
                  <th 
                    scope="col" 
                    className="px-6 py-4 font-medium text-right cursor-pointer hover:text-white hover:bg-gray-800 transition-colors"
                    onClick={() => requestSort('latency')}
                  >
                    <div className="flex items-center justify-end">
                      延迟 {getSortIcon('latency')}
                    </div>
                  </th>
                  <th 
                    scope="col" 
                    className="px-6 py-4 font-medium text-center cursor-pointer hover:text-white hover:bg-gray-800 transition-colors"
                    onClick={() => requestSort('purityScore')}
                  >
                    <div className="flex items-center justify-center">
                      {activeTab === ProxyType.PROXY ? "纯净度" : "推荐分"} {getSortIcon('purityScore')}
                    </div>
                  </th>
                  <th scope="col" className="px-6 py-4 font-medium text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredAndSortedProxies.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                      <Filter className="w-12 h-12 mx-auto mb-3 opacity-20" />
                      {loading ? '正在从数据库加载...' : '数据库暂无数据，请等待后台 Cron 任务执行'}
                    </td>
                  </tr>
                ) : (
                  filteredAndSortedProxies.map((proxy) => (
                    <tr 
                      key={proxy.id} 
                      className="border-b border-gray-700/50 hover:bg-gray-700/30 transition-colors group cursor-pointer"
                      onClick={() => setSelectedProxy(proxy)}
                    >
                      <td className="px-6 py-4">
                        <div className="font-mono text-gray-200">
                          {proxy.ip}
                          <span className="text-gray-500 ml-1">:{proxy.port}</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                           <span className={`w-2 h-2 rounded-full ${proxy.port === 443 ? 'bg-emerald-500' : 'bg-blue-500'}`}></span>
                           {proxy.protocol}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <span className="text-lg" role="img" aria-label={proxy.country}>
                            <Globe size={16} className="text-blue-400" />
                          </span>
                          <div>
                            <div className="text-gray-300">{proxy.countryCode}</div>
                            {proxy.city && <div className="text-xs text-gray-500">{proxy.city}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {activeTab === ProxyType.PROXY ? (
                            <div className="flex flex-col gap-1 items-start">
                              <span className="text-gray-300 font-medium">{proxy.isp}</span>
                              {['Oracle', 'Aliyun', 'Tencent'].some(k => proxy.isp.includes(k)) && (
                                <span className="text-xs text-indigo-400 flex items-center gap-1">
                                  <Server size={10} /> 优质云
                                </span>
                              )}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-1 items-start">
                               {proxy.speedInfo ? (
                                  <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 text-xs">
                                     {proxy.speedInfo}
                                  </span>
                               ) : <span className="text-gray-500">-</span>}
                               <span className="text-xs text-gray-500">{proxy.isp}</span>
                            </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right font-mono text-gray-300">
                        <div className="flex items-center justify-end gap-2">
                          <Wifi size={14} className={proxy.latency < 100 ? 'text-emerald-500' : 'text-amber-500'} />
                          {proxy.latency}ms
                        </div>
                      </td>
                      <td className="px-6 py-4 flex justify-center">
                        <PurityBadge score={proxy.purityScore} level={proxy.riskLevel} />
                      </td>
                      <td className="px-6 py-4 text-center">
                         <button className="text-gray-500 hover:text-white p-1 rounded hover:bg-gray-700 transition-colors">
                           <Info size={18} />
                         </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          
          {/* Footer */}
          <div className="bg-gray-900/50 px-6 py-3 border-t border-gray-700 flex justify-between items-center">
            <span className="text-xs text-gray-500">
              显示前 {filteredAndSortedProxies.length} 个结果 (优化性能)
            </span>
            <div className="text-xs text-gray-600 font-mono">
              V22 双模旗舰版
            </div>
          </div>
        </div>
      </main>

      {/* Detail Modal */}
      {selectedProxy && (
        <DetailModal 
          proxy={selectedProxy} 
          onClose={() => setSelectedProxy(null)} 
        />
      )}
    </div>
  );
}

export default App;
