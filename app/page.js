"use client";

import { useState, useEffect, useRef } from "react";
import Papa from "papaparse";
import { Search, Settings, Upload, MapPin, User, Star, Filter, Sparkles, Loader2, TrendingUp, Eye } from "lucide-react";
import { DEFAULT_DATA } from "./lib/data";

export default function Home() {
  // --- 状态管理 ---
  const [allData, setAllData] = useState([]);
  const [query, setQuery] = useState("");
  const [analyzedIntent, setAnalyzedIntent] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false); // 搜索加载状态
  
  // 用户上下文
  const [userRole, setUserRole] = useState("全部");
  const [userLocation, setUserLocation] = useState("全省");
  
  // 配置
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState({
    apiUrl: "https://api.groq.com/openai/v1/chat/completions",
    apiKey: "",
    model: "llama3-70b-8192",
    enableSatisfactionSort: false,
  });

  const fileInputRef = useRef(null);

  // --- 数据预处理 ---
  const processData = (rawData) => {
    return rawData.map(item => {
      // 1. 处理搜索索引字符串
      const searchStr = `${item["事项名称"]}|${item["事项简称"]}|${item["事项标签"]}|${item["事项分类"]}`.toLowerCase();
      
      // 2. 核心：解析访问量 (处理 "1,234" 这种带逗号的格式，如果没有则默认为 0)
      let visits = 0;
      if (item["访问量"]) {
        visits = parseInt(String(item["访问量"]).replace(/,/g, ""), 10) || 0;
      } else if (item["搜索量"]) {
        // 兼容旧数据
        visits = parseInt(String(item["搜索量"]).replace(/,/g, ""), 10) || 0;
      }

      return {
        ...item,
        _searchStr: searchStr,
        _visits: visits // 存储为数字类型以便排序
      };
    });
  };

  useEffect(() => {
    const savedConfig = localStorage.getItem("gov_search_config");
    if (savedConfig) setConfig(JSON.parse(savedConfig));
    setAllData(processData(DEFAULT_DATA));
    setSearchResults(processData(DEFAULT_DATA).slice(0, 20)); // 默认按热度或原序展示
  }, []);

  const saveConfig = (newConfig) => {
    setConfig(newConfig);
    localStorage.setItem("gov_search_config", JSON.stringify(newConfig));
    setShowSettings(false);
  };

  // --- 智能加权评分算法 (V3: 意图 + 语义 + 热度对数加权) ---
  const calculateScore = (item, cleanQuery, synonyms = []) => {
    let score = 0;
    const searchStr = item._searchStr;
    const itemName = item["事项名称"].toLowerCase();
    
    // 1. 意图相关性 (基准分 0 - 100+)
    let isRelevant = false;

    // A. 原始查询词精准匹配 (权重最高)
    if (searchStr.includes(cleanQuery)) {
      score += 100;
      isRelevant = true;
      // 头部匹配奖励 (例如搜"身份证"，"身份证..." > "临时身份证...")
      if (itemName.startsWith(cleanQuery)) score += 30;
      // 完全相等奖励
      if (itemName === cleanQuery) score += 50;
    }

    // B. AI 同义词匹配 (权重次高)
    if (synonyms.length > 0) {
      synonyms.forEach(word => {
        const w = word.toLowerCase();
        if (searchStr.includes(w)) {
          score += 60; // 提高同义词权重，确保"生孩子"能搜到"生育"且排名前列
          isRelevant = true;
        }
      });
    }

    // C. 字符覆盖率 (兜底匹配)
    let charMatchCount = 0;
    for (let char of cleanQuery) {
      if (searchStr.includes(char)) charMatchCount++;
    }
    const coverage = charMatchCount / (cleanQuery.length || 1);
    if (coverage > 0.6) {
      score += coverage * 40;
      isRelevant = true; // 只要覆盖率够高，也算相关
    }

    // *重要*：如果不相关 (Text Score 为 0)，直接返回 -1，不让热度把无关项顶上来
    if (!isRelevant) return -1;

    // 2. 热度/访问量加权 (Log对数平滑处理)
    // 目的：让热门服务在"相关"的前提下排前面，但不要淹没长尾精准服务
    // 算法：log10(访问量 + 1) * 系数
    // 100 访问量 -> 2 * 8 = 16分
    // 10,000 访问量 -> 4 * 8 = 32分
    // 1,000,000 访问量 -> 6 * 8 = 48分
    // 这样百万级热度仅比百级热度多 30多分，不会超过"精准匹配(100分)"的权重
    if (item._visits > 0) {
      score += Math.log10(item._visits + 1) * 8;
    }

    // 3. 高频标识加权 (csv中的"是否高频事项")
    if (item["是否高频事项"] === "是") score += 10;

    return score;
  };

  const handleSearch = async () => {
    if (!query.trim()) {
      // 空搜时，按访问量降序展示，作为"热门服务"推荐
      const sortedByVisits = [...allData].sort((a, b) => b._visits - a._visits).slice(0, 50);
      setSearchResults(sortedByVisits);
      return;
    }

    setIsSearching(true);
    // 清空结果，让骨架屏显示出来
    setSearchResults([]); 

    let currentSynonyms = [];
    const cleanQuery = query.toLowerCase().replace(/[我要想办理怎么查询了]/g, "");

    // 1. AI 实时分析
    if (config.apiKey) {
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
          if (data.location) setUserLocation(data.location);
          if (data.target_user && data.target_user !== "不确定") setUserRole(data.target_user);
        }
      } catch (error) {
        console.error("AI Error:", error);
      }
    }

    // 2. 计算分数
    const scoredData = allData.map(item => {
      let score = calculateScore(item, cleanQuery, currentSynonyms);
      
      if (score <= 0) return { item, score: -1 };

      // 上下文加权
      if (userRole !== "全部") {
        if (item["服务对象"] === userRole) score += 20;
        else score -= 20;
      }
      if (userLocation !== "全省") {
        if (item["所属市州单位"].includes(userLocation)) score += 20;
        else if (item["所属市州单位"] === "全省通用") score += 5;
        else score -= 50;
      }
      // 满意度加权
      if (config.enableSatisfactionSort && item["满意度"]) {
        score += parseFloat(item["满意度"]) * 2;
      }

      return { item, score };
    });

    // 排序
    const sorted = scoredData
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score) // 分数高在前
      .map(x => x.item)
      .slice(0, 100);

    setSearchResults(sorted);
    setIsSearching(false);
  };

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
          alert(`导入成功！共 ${results.data.length} 条数据，包含访问量信息。`);
          // 默认展示热度最高的
          setSearchResults(processed.sort((a, b) => b._visits - a._visits).slice(0, 50));
        }
      }
    });
  };

  // 格式化数字 (12345 -> 1.2万)
  const formatNumber = (num) => {
    if (num > 10000) return (num / 10000).toFixed(1) + "万";
    return num;
  };

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col items-center py-10 px-4 font-sans">
      {/* 顶部栏 */}
      <div className="w-full max-w-3xl flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">智慧政务服务搜索</h1>
          <p className="text-slate-500 text-sm mt-1">语义识别 · 热度加权 · 意图排序</p>
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

      {/* 搜索框 */}
      <div className="w-full max-w-3xl bg-white rounded-xl shadow-lg p-6 mb-6">
        <div className="relative flex items-center mb-4">
          <Search className="absolute left-4 text-slate-400" size={20} />
          <input
            type="text"
            className="w-full pl-12 pr-24 py-3 bg-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-lg placeholder:text-slate-300"
            placeholder="请输入您的需求，例如：生孩子、身份证到期..."
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

        {/* AI 扩展提示 */}
        {analyzedIntent && analyzedIntent.synonyms?.length > 0 && !isSearching && (
          <div className="mb-4 text-xs bg-indigo-50 text-indigo-800 p-3 rounded-lg border border-indigo-100 flex flex-wrap gap-2 items-center animate-in fade-in slide-in-from-top-2">
            <Sparkles size={14} className="text-indigo-600"/>
            <span className="font-bold">智能扩展:</span>
            {analyzedIntent.synonyms.map((k, i) => (
              <span key={i} className="bg-white px-2 py-0.5 rounded border border-indigo-200 shadow-sm">{k}</span>
            ))}
          </div>
        )}

        {/* 筛选器 */}
        <div className="flex flex-wrap gap-4 pt-4 border-t border-slate-100">
          <div className="flex items-center gap-2">
            <User size={16} className="text-slate-400" />
            <select value={userRole} onChange={(e) => setUserRole(e.target.value)} className="text-sm border-none bg-transparent focus:ring-0 text-slate-700 font-medium cursor-pointer hover:text-blue-600">
              <option value="全部">全部角色</option>
              <option value="自然人">个人办事</option>
              <option value="法人">企业办事</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <MapPin size={16} className="text-slate-400" />
            <select value={userLocation} onChange={(e) => setUserLocation(e.target.value)} className="text-sm border-none bg-transparent focus:ring-0 text-slate-700 font-medium cursor-pointer hover:text-blue-600">
              <option value="全省">全省范围</option>
              <option value="长沙">长沙市</option>
              <option value="株洲">株洲市</option>
              <option value="怀化">怀化市</option>
            </select>
          </div>
          <div className="ml-auto flex items-center gap-2 text-sm text-slate-500">
             <Filter size={14} /> <span>{config.enableSatisfactionSort ? "热度+满意度排序" : "智能意图排序"}</span>
          </div>
        </div>
      </div>

      {/* 结果列表区 */}
      <div className="w-full max-w-3xl space-y-3">
        {isSearching ? (
          // --- 骨架屏加载动画 (优化体验) ---
          <div className="space-y-4 animate-pulse">
             <div className="flex items-center gap-2 text-blue-600 mb-2 px-1">
                <Sparkles size={16} className="animate-spin" />
                <span className="text-sm font-medium">AI 正在分析意图并检索库中4000+事项...</span>
             </div>
             {[1, 2, 3].map((i) => (
               <div key={i} className="bg-white rounded-lg p-4 h-32 border border-slate-100 shadow-sm flex flex-col justify-between">
                 <div className="h-6 bg-slate-100 rounded w-1/3"></div>
                 <div className="h-4 bg-slate-50 rounded w-1/4"></div>
                 <div className="flex gap-3 mt-2">
                   <div className="h-6 bg-slate-100 rounded w-16"></div>
                   <div className="h-6 bg-slate-100 rounded w-16"></div>
                 </div>
               </div>
             ))}
          </div>
        ) : searchResults.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <div className="inline-block p-4 bg-slate-100 rounded-full mb-3">
              <Search size={32} className="text-slate-300" />
            </div>
            <p>暂无匹配事项，请尝试更换关键词</p>
          </div>
        ) : (
          searchResults.map((item, index) => (
            <div key={index} className="bg-white rounded-lg p-5 border border-slate-100 shadow-sm hover:shadow-md hover:border-blue-200 transition-all flex justify-between items-start group relative overflow-hidden">
              {/* 热度背景条效果 */}
              {item["是否高频事项"] === "是" && (
                <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-orange-100 to-transparent -mr-8 -mt-8 rounded-bl-3xl opacity-50 pointer-events-none"></div>
              )}
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <h3 className="text-lg font-bold text-slate-800 group-hover:text-blue-600 transition-colors truncate pr-2">
                    {item["事项名称"]}
                  </h3>
                  {item["是否高频事项"] === "是" && (
                    <span className="flex items-center gap-0.5 bg-orange-50 text-orange-600 text-[10px] font-bold px-1.5 py-0.5 rounded border border-orange-100">
                      <TrendingUp size={10} /> 高频
                    </span>
                  )}
                </div>
                
                <div className="text-xs text-slate-400 mb-3 font-mono">
                  编码：{item["事项编码"] || "--"}
                </div>
                
                <div className="flex items-center gap-3 text-xs text-slate-600 flex-wrap">
                  <span className="bg-slate-50 px-2 py-1 rounded border border-slate-100">{item["服务对象"]}</span>
                  <span className="bg-slate-50 px-2 py-1 rounded border border-slate-100">{item["所属市州单位"]}</span>
                  
                  {/* 显示访问量 */}
                  {item._visits > 0 && (
                    <span className="flex items-center gap-1 text-slate-500 px-1">
                      <Eye size={12} /> {formatNumber(item._visits)}次访问
                    </span>
                  )}
                  
                  {config.enableSatisfactionSort && item["满意度"] && (
                    <span className="flex items-center gap-0.5 text-emerald-600 font-medium px-1">
                      <Star size={12} fill="currentColor"/> {item["满意度"]}分
                    </span>
                  )}
                </div>
              </div>
              
              <button className="px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 active:scale-95 transition-all shadow-blue-100 shadow-lg ml-4 whitespace-nowrap">
                在线办理
              </button>
            </div>
          ))
        )}
      </div>

      {/* 设置弹窗 */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4 text-slate-800">配置设置</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">大模型 API Key</label>
                <input type="password" placeholder="sk-..." className="w-full border rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={config.apiKey} onChange={e => setConfig({...config, apiKey: e.target.value})} />
              </div>
              <div>
                 <label className="block text-xs font-medium text-slate-500 mb-1">模型名称</label>
                 <input type="text" placeholder="llama3-70b-8192" className="w-full border rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={config.model} onChange={e => setConfig({...config, model: e.target.value})} />
              </div>
              <div className="flex justify-between items-center pt-2">
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
