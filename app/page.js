"use client";

import { useState, useEffect, useRef } from "react";
import Papa from "papaparse";
import { Search, Settings, Upload, MapPin, User, Star, Filter, Sparkles, Loader2, TrendingUp, Eye, Smartphone, Zap } from "lucide-react";
import { DEFAULT_DATA } from "./lib/data";

// 湖南省行政区划常量
const LOCATION_OPTIONS = [
  "湖南省本级",
  "长沙市", "株洲市", "湘潭市", "衡阳市", "邵阳市", "岳阳市", "常德市", 
  "张家界市", "益阳市", "郴州市", "永州市", "怀化市", "娄底市", "湘西土家族苗族自治州"
];

// 发布渠道常量
const CHANNEL_OPTIONS = [
  "Android", "IOS", "HarmonyOS", "微信小程序", "支付宝小程序"
];

export default function Home() {
  // --- 状态管理 ---
  const [allData, setAllData] = useState([]);
  const [query, setQuery] = useState("");
  const [analyzedIntent, setAnalyzedIntent] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  
  // 筛选上下文
  const [userRole, setUserRole] = useState("全部");
  const [userLocation, setUserLocation] = useState("全部地区");
  const [selectedChannel, setSelectedChannel] = useState("全部渠道");
  
  // 配置
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState({
    apiUrl: "https://api.groq.com/openai/v1/chat/completions", // 默认 Groq
    apiKey: "",
    model: "llama3-70b-8192",
    enableSatisfactionSort: false,
  });

  const fileInputRef = useRef(null);

  // --- 数据预处理 ---
  const processData = (rawData) => {
    return rawData.map(item => {
      const searchStr = `${item["事项名称"]}|${item["事项简称"]}|${item["事项标签"]}|${item["事项分类"]}`.toLowerCase();
      let visits = 0;
      if (item["访问量"]) {
        visits = parseInt(String(item["访问量"]).replace(/,/g, ""), 10) || 0;
      } else if (item["搜索量"]) {
        visits = parseInt(String(item["搜索量"]).replace(/,/g, ""), 10) || 0;
      }
      return { ...item, _searchStr: searchStr, _visits: visits };
    });
  };

  useEffect(() => {
    const savedConfig = localStorage.getItem("gov_search_config");
    if (savedConfig) setConfig(JSON.parse(savedConfig));
    setAllData(processData(DEFAULT_DATA));
    setSearchResults(processData(DEFAULT_DATA).slice(0, 20));
  }, []);

  const saveConfig = (newConfig) => {
    setConfig(newConfig);
    localStorage.setItem("gov_search_config", JSON.stringify(newConfig));
    setShowSettings(false);
  };

  // --- 快速切换模型预设 ---
  const applyPreset = (type) => {
    let newConfig = { ...config };
    if (type === 'groq') {
      newConfig.apiUrl = "https://api.groq.com/openai/v1/chat/completions";
      newConfig.model = "llama3-70b-8192";
    } else if (type === 'deepseek') {
      newConfig.apiUrl = "https://api.deepseek.com/chat/completions";
      newConfig.model = "deepseek-chat";
    } else if (type === 'kimi') {
      newConfig.apiUrl = "https://api.moonshot.cn/v1/chat/completions";
      newConfig.model = "moonshot-v1-8k";
    }
    setConfig(newConfig);
  };

  // --- 智能评分与过滤算法 ---
  const calculateScore = (item, cleanQuery, synonyms = []) => {
    // 1. 硬性过滤（渠道）
    if (selectedChannel !== "全部渠道") {
      const itemChannels = item["发布渠道"] || "";
      if (!itemChannels.toLowerCase().includes(selectedChannel.toLowerCase())) return -1; 
    }

    let score = 0;
    const searchStr = item._searchStr;
    const itemName = item["事项名称"].toLowerCase();
    let isRelevant = false;

    // 2. 意图相关性评分
    if (searchStr.includes(cleanQuery)) {
      score += 100;
      isRelevant = true;
      if (itemName.startsWith(cleanQuery)) score += 30;
      if (itemName === cleanQuery) score += 50;
    }

    if (synonyms.length > 0) {
      synonyms.forEach(word => {
        const w = word.toLowerCase();
        if (searchStr.includes(w)) {
          score += 60;
          isRelevant = true;
        }
      });
    }

    let charMatchCount = 0;
    for (let char of cleanQuery) {
      if (searchStr.includes(char)) charMatchCount++;
    }
    const coverage = charMatchCount / (cleanQuery.length || 1);
    if (coverage > 0.6) {
      score += coverage * 40;
      isRelevant = true;
    }

    if (!isRelevant) return -1;

    // 3. 热度加权
    if (item._visits > 0) score += Math.log10(item._visits + 1) * 8;
    // 4. 高频标识加权
    if (item["是否高频事项"] === "是") score += 10;

    return score;
  };

  const handleSearch = async () => {
    const cleanQuery = query.trim().toLowerCase().replace(/[我要想办理怎么查询了]/g, "");
    
    setIsSearching(true);
    setSearchResults([]); 

    let currentSynonyms = [];

    // 1. AI 分析
    if (query.trim() && config.apiKey) {
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, config }),
        });
        const data = await res.json();
        if (data && !data.error) {
          setAnalyzedIntent(data);
          currentSynonyms = data.synonyms || [];
          // 智能上下文填入
          if (data.location && userLocation === "全部地区") {
             const matchCity = LOCATION_OPTIONS.find(c => c.includes(data.location));
             if (matchCity) setUserLocation(matchCity);
          }
          if (data.target_user && data.target_user !== "不确定" && userRole === "全部") {
             setUserRole(data.target_user);
          }
        }
      } catch (error) {
        console.error("AI Error:", error);
      }
    }

    // 2. 计算分数
    const scoredData = allData.map(item => {
      if (!query.trim()) {
        if (selectedChannel !== "全部渠道") {
           const itemChannels = item["发布渠道"] || "";
           if (!itemChannels.toLowerCase().includes(selectedChannel.toLowerCase())) return { item, score: -1 };
        }
        let baseScore = 100;
        if (item._visits > 0) baseScore += Math.log10(item._visits + 1) * 8;
        return { item, score: baseScore };
      }

      let score = calculateScore(item, cleanQuery, currentSynonyms);
      if (score <= 0) return { item, score: -1 };

      if (userRole !== "全部") {
        if (item["服务对象"] === userRole) score += 20;
        else score -= 20;
      }
      if (userLocation !== "全部地区") {
        if (item["所属市州单位"].includes(userLocation)) score += 20;
        else if (item["所属市州单位"].includes("全省") || item["所属市州单位"].includes("省本级")) score += 5;
        else score -= 50;
      }
      if (config.enableSatisfactionSort && item["满意度"]) {
        score += parseFloat(item["满意度"]) * 2;
      }

      return { item, score };
    });

    const sorted = scoredData
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.item)
      .slice(0, 100);

    setSearchResults(sorted);
    setIsSearching(false);
  };

  useEffect(() => {
    if (!isSearching) handleSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRole, userLocation, selectedChannel, config.enableSatisfactionSort]); 

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.data && results.data.length > 0) {
          const processed = processData(results.data);
          setAllData(processed);
          alert(`导入成功！共 ${results.data.length} 条数据。`);
          setSearchResults(processed.sort((a, b) => b._visits - a._visits).slice(0, 50));
        }
      }
    });
  };

  const formatNumber = (num) => {
    if (num > 10000) return (num / 10000).toFixed(1) + "万";
    return num;
  };

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col items-center py-10 px-4 font-sans">
      {/* 顶部栏 */}
      <div className="w-full max-w-4xl flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">智慧政务服务搜索</h1>
          <p className="text-slate-500 text-sm mt-1">支持 Groq / DeepSeek / Kimi 等多模型接入</p>
        </div>
        <div className="flex gap-2">
           <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv" className="hidden" />
          <button onClick={() => fileInputRef.current.click()} className="flex items-center gap-1 px-3 py-2 bg-white border rounded hover:bg-slate-50 text-sm text-slate-600 transition-colors">
            <Upload size={16} /> 导入数据
          </button>
          <button onClick={() => setShowSettings(true)} className="flex items-center gap-1 px-3 py-2 bg-white border rounded hover:bg-slate-50 text-sm text-slate-600 transition-colors">
            <Settings size={16} /> 设置
          </button>
        </div>
      </div>

      {/* 搜索与筛选区域 */}
      <div className="w-full max-w-4xl bg-white rounded-xl shadow-lg p-6 mb-6">
        <div className="relative flex items-center mb-4">
          <Search className="absolute left-4 text-slate-400" size={20} />
          <input
            type="text"
            className="w-full pl-12 pr-24 py-3 bg-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-lg placeholder:text-slate-300"
            placeholder="请输入您的需求，例如：公积金提取、生孩子..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button 
            onClick={handleSearch}
            disabled={isSearching}
            className="absolute right-2 bg-blue-600 text-white px-5 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-70 transition-colors flex items-center gap-2 font-medium"
          >
            {isSearching ? <Loader2 className="animate-spin" size={18}/> : "搜索"}
          </button>
        </div>

        {analyzedIntent && analyzedIntent.synonyms?.length > 0 && !isSearching && query && (
          <div className="mb-4 text-xs bg-indigo-50 text-indigo-800 p-3 rounded-lg border border-indigo-100 flex flex-wrap gap-2 items-center animate-in fade-in slide-in-from-top-2">
            <Sparkles size={14} className="text-indigo-600"/>
            <span className="font-bold">智能扩展:</span>
            {analyzedIntent.synonyms.map((k, i) => (
              <span key={i} className="bg-white px-2 py-0.5 rounded border border-indigo-200 shadow-sm">{k}</span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4 border-t border-slate-100">
          <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-lg border border-slate-100">
            <User size={16} className="text-slate-400 shrink-0" />
            <select value={userRole} onChange={(e) => setUserRole(e.target.value)} className="w-full text-sm border-none bg-transparent focus:ring-0 text-slate-700 font-medium cursor-pointer hover:text-blue-600 outline-none">
              <option value="全部">全部角色</option>
              <option value="自然人">个人办事</option>
              <option value="法人">企业办事</option>
            </select>
          </div>
          <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-lg border border-slate-100">
            <MapPin size={16} className="text-slate-400 shrink-0" />
            <select value={userLocation} onChange={(e) => setUserLocation(e.target.value)} className="w-full text-sm border-none bg-transparent focus:ring-0 text-slate-700 font-medium cursor-pointer hover:text-blue-600 outline-none">
              <option value="全部地区">全部地区</option>
              {LOCATION_OPTIONS.map(loc => (<option key={loc} value={loc}>{loc}</option>))}
            </select>
          </div>
          <div className="flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-lg border border-slate-100">
            <Smartphone size={16} className="text-slate-400 shrink-0" />
            <select value={selectedChannel} onChange={(e) => setSelectedChannel(e.target.value)} className="w-full text-sm border-none bg-transparent focus:ring-0 text-slate-700 font-medium cursor-pointer hover:text-blue-600 outline-none">
              <option value="全部渠道">全部渠道</option>
              {CHANNEL_OPTIONS.map(ch => (<option key={ch} value={ch}>{ch}</option>))}
            </select>
          </div>
          <div className="flex items-center justify-end gap-2 text-sm text-slate-500 md:col-span-1">
             <Filter size={14} /> <span>{config.enableSatisfactionSort ? "热度+满意度" : "智能综合"}</span>
          </div>
        </div>
      </div>

      {/* 结果列表区 */}
      <div className="w-full max-w-4xl space-y-3">
        {isSearching ? (
          <div className="space-y-4 animate-pulse">
             <div className="flex items-center gap-2 text-blue-600 mb-2 px-1">
                <Sparkles size={16} className="animate-spin" />
                <span className="text-sm font-medium">AI 正在分析并检索...</span>
             </div>
             {[1, 2].map((i) => <div key={i} className="bg-white rounded-lg p-4 h-24 border border-slate-100 shadow-sm"></div>)}
          </div>
        ) : searchResults.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <div className="inline-block p-4 bg-slate-100 rounded-full mb-3"><Search size={32} className="text-slate-300" /></div>
            <p>暂无匹配事项 (可能被过滤器排除)</p>
          </div>
        ) : (
          searchResults.map((item, index) => (
            <div key={index} className="bg-white rounded-lg p-5 border border-slate-100 shadow-sm hover:shadow-md hover:border-blue-200 transition-all flex justify-between items-start group relative overflow-hidden">
              {item["是否高频事项"] === "是" && (
                <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-orange-100 to-transparent -mr-8 -mt-8 rounded-bl-3xl opacity-50 pointer-events-none"></div>
              )}
              <div className="flex-1 min-w-0 pr-4">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <h3 className="text-lg font-bold text-slate-800 group-hover:text-blue-600 transition-colors truncate">
                    {item["事项名称"]}
                  </h3>
                  {item["是否高频事项"] === "是" && (
                    <span className="flex items-center gap-0.5 bg-orange-50 text-orange-600 text-[10px] font-bold px-1.5 py-0.5 rounded border border-orange-100"><TrendingUp size={10} /> 高频</span>
                  )}
                </div>
                <div className="text-xs text-slate-400 mb-3 font-mono">编码：{item["事项编码"] || "--"}</div>
                <div className="flex items-center gap-3 text-xs text-slate-600 flex-wrap">
                  <span className="bg-slate-50 px-2 py-1 rounded border border-slate-100">{item["服务对象"]}</span>
                  <span className="bg-slate-50 px-2 py-1 rounded border border-slate-100">{item["所属市州单位"]}</span>
                  <span className="bg-slate-50 px-2 py-1 rounded border border-slate-100 truncate max-w-[200px]" title={item["发布渠道"]}>
                    <Smartphone size={10} className="inline mr-1"/>
                    {item["发布渠道"]?.length > 15 ? item["发布渠道"].substring(0,15)+"..." : item["发布渠道"]}
                  </span>
                  {item._visits > 0 && <span className="flex items-center gap-1 text-slate-500 px-1"><Eye size={12} /> {formatNumber(item._visits)}</span>}
                  {config.enableSatisfactionSort && item["满意度"] && <span className="flex items-center gap-0.5 text-emerald-600 font-medium px-1"><Star size={12} fill="currentColor"/> {item["满意度"]}</span>}
                </div>
              </div>
              <button className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 active:scale-95 transition-all shadow-blue-100 shadow-lg whitespace-nowrap self-center">在线办理</button>
            </div>
          ))
        )}
      </div>

      {/* 设置弹窗 (包含新功能) */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 overflow-y-auto max-h-[90vh]">
            <h2 className="text-xl font-bold mb-4 text-slate-800">API 与模型配置</h2>
            
            {/* 快速预设按钮 */}
            <div className="mb-5">
              <label className="block text-xs font-medium text-slate-500 mb-2">快速预设 (点击应用)</label>
              <div className="flex gap-2">
                <button onClick={() => applyPreset('groq')} className="flex-1 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-50 hover:border-blue-400 transition-colors flex items-center justify-center gap-1">
                   <Zap size={12} className="text-orange-500"/> Groq
                </button>
                <button onClick={() => applyPreset('deepseek')} className="flex-1 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-50 hover:border-blue-400 transition-colors flex items-center justify-center gap-1">
                   <Zap size={12} className="text-blue-500"/> DeepSeek
                </button>
                <button onClick={() => applyPreset('kimi')} className="flex-1 py-1.5 text-xs border border-slate-200 rounded hover:bg-slate-50 hover:border-blue-400 transition-colors flex items-center justify-center gap-1">
                   <Zap size={12} className="text-purple-500"/> Kimi
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {/* 新增：API URL 配置 */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">接口地址 (Base URL)</label>
                <input 
                  type="text" 
                  placeholder="https://api.deepseek.com/chat/completions" 
                  className="w-full border rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-slate-50" 
                  value={config.apiUrl} 
                  onChange={e => setConfig({...config, apiUrl: e.target.value})} 
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">API Key</label>
                <input 
                  type="password" 
                  placeholder="sk-..." 
                  className="w-full border rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                  value={config.apiKey} 
                  onChange={e => setConfig({...config, apiKey: e.target.value})} 
                />
              </div>

              <div>
                 <label className="block text-xs font-medium text-slate-500 mb-1">模型名称 (Model ID)</label>
                 <input 
                   type="text" 
                   placeholder="deepseek-chat" 
                   className="w-full border rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                   value={config.model} 
                   onChange={e => setConfig({...config, model: e.target.value})} 
                 />
              </div>

              <div className="flex justify-between items-center pt-2 border-t border-slate-100 mt-2">
                 <span className="text-sm font-medium text-slate-700">启用满意度辅助排序</span>
                 <button onClick={() => setConfig({...config, enableSatisfactionSort: !config.enableSatisfactionSort})} className={`w-11 h-6 rounded-full transition-colors ${config.enableSatisfactionSort ? 'bg-blue-600' : 'bg-slate-200'}`}>
                    <span className={`block w-4 h-4 bg-white rounded-full ml-1 transition-transform ${config.enableSatisfactionSort ? 'translate-x-5' : ''}`} />
                 </button>
              </div>
            </div>
            
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setShowSettings(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">取消</button>
              <button onClick={() => saveConfig(config)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium shadow-lg shadow-blue-200">保存配置</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
