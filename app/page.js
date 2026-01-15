"use client";

import { useState, useEffect, useRef } from "react";
import Papa from "papaparse";
import { Search, Settings, Upload, MapPin, User, Star, Filter, Sparkles, Loader2 } from "lucide-react";
import { DEFAULT_DATA } from "./lib/data";

export default function Home() {
  // --- 状态管理 ---
  const [allData, setAllData] = useState([]);
  const [query, setQuery] = useState("");
  const [analyzedIntent, setAnalyzedIntent] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  
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

  // --- 初始化与数据预处理 ---
  
  // 核心优化：为了应对 4000+ 数据，我们在加载时生成一个"索引字符串"
  // 这样搜索时不需要遍历每个字段，只需要搜这个长字符串
  const processData = (rawData) => {
    return rawData.map(item => ({
      ...item,
      // 预处理：将所有可能被搜索的字段合并成一个全小写的字符串，大幅提升搜索效率
      _searchStr: `${item["事项名称"]}|${item["事项简称"]}|${item["事项标签"]}|${item["事项分类"]}|${item["自然人主题"]}|${item["法人主题"]}`.toLowerCase()
    }));
  };

  useEffect(() => {
    const savedConfig = localStorage.getItem("gov_search_config");
    if (savedConfig) setConfig(JSON.parse(savedConfig));
    
    // 初始化默认数据
    setAllData(processData(DEFAULT_DATA));
    setSearchResults(DEFAULT_DATA.slice(0, 20));
  }, []);

  const saveConfig = (newConfig) => {
    setConfig(newConfig);
    localStorage.setItem("gov_search_config", JSON.stringify(newConfig));
    setShowSettings(false);
  };

  // --- 智能加权评分算法 ---
  // params: item(当前数据), cleanQuery(用户搜的词), synonyms(AI给的同义词)
  const calculateScore = (item, cleanQuery, synonyms = []) => {
    let score = 0;
    const searchStr = item._searchStr; // 使用预处理的索引字段
    
    // 1. 原始查询词匹配 (权重最高：100分)
    // 解决 "生孩子" 必须包含 "生" 字的问题，但我们要避免 "食品生产" 这种误伤
    // 策略：如果完全包含用户输入的词，给高分
    if (searchStr.includes(cleanQuery)) {
      score += 100;
      // 额外奖励：如果是事项名称开头匹配，再加 30 分 (比如搜"身份证"，"身份证换领"优于"临时身份证")
      if (item["事项名称"].toLowerCase().startsWith(cleanQuery)) score += 30;
    }

    // 2. AI 同义词/扩展词匹配 (权重中等：40分)
    // 解决 "生孩子" 搜出 "生育"、"新生儿"
    let matchedSynonymsCount = 0;
    synonyms.forEach(word => {
      const w = word.toLowerCase();
      if (searchStr.includes(w)) {
        score += 40;
        matchedSynonymsCount++;
      }
    });

    // 3. 字符覆盖率奖励 (解决 "身份证到期" vs "身份证损坏")
    // 计算 cleanQuery 里的字，有多少在 searchStr 里出现过
    let charMatchCount = 0;
    for (let char of cleanQuery) {
      if (searchStr.includes(char)) charMatchCount++;
    }
    const coverage = charMatchCount / (cleanQuery.length || 1);
    // 只有覆盖率超过 50% 才给分，避免搜"生孩子"匹配到只有"生"字的"生产许可"
    if (coverage > 0.5) {
      score += coverage * 50; 
    } else {
      // 惩罚机制：如果覆盖率很低（比如只命中一个字），且没有命中任何同义词，扣分
      if (matchedSynonymsCount === 0) score -= 100;
    }

    return score;
  };

  const handleSearch = async () => {
    if (!query.trim()) {
      setSearchResults(allData.slice(0, 50));
      return;
    }

    setIsSearching(true);
    let currentSynonyms = [];
    
    // 清理用户输入，去除"我要"、"怎么办"等无意义词
    const cleanQuery = query.toLowerCase().replace(/[我要想办理怎么查询了]/g, "");

    // 1. AI 实时分析 (获取同义词)
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
          // 获取 AI 生成的同义词
          currentSynonyms = data.synonyms || [];
          
          // 自动切换上下文
          if (data.location) setUserLocation(data.location);
          if (data.target_user && data.target_user !== "不确定") setUserRole(data.target_user);
        }
      } catch (error) {
        console.error("AI Analysis failed:", error);
      }
    }

    // 2. 并行计算分数 (4000条数据在前端计算通常只需要几毫秒)
    const scoredData = allData.map(item => {
      let score = calculateScore(item, cleanQuery, currentSynonyms);
      
      // 阈值过滤：负分直接淘汰
      if (score <= 0) return { item, score: -1 };

      // 3. 上下文加权 (角色 & 地点)
      if (userRole !== "全部") {
        if (item["服务对象"] === userRole) score += 20;
        else score -= 20;
      }

      if (userLocation !== "全省") {
        if (item["所属市州单位"].includes(userLocation)) score += 20;
        else if (item["所属市州单位"] === "全省通用") score += 5;
        else score -= 50;
      }

      // 4. 业务加权
      if (item["是否高频事项"] === "是") score += 10;
      if (config.enableSatisfactionSort && item["满意度"]) score += parseFloat(item["满意度"]);
      if (item["搜索量"]) score += Math.log(parseInt(item["搜索量"]) || 1) * 2;

      return { item, score };
    });

    // 排序并截取前 100 条 (提升渲染性能)
    const sorted = scoredData
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
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
          // 导入时同样进行预处理
          const processed = processData(results.data);
          setAllData(processed);
          alert(`成功导入 ${results.data.length} 条数据`);
          setSearchResults(processed.slice(0, 50));
        }
      }
    });
  };

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col items-center py-10 px-4">
      {/* 顶部栏 */}
      <div className="w-full max-w-3xl flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">智慧政务服务搜索</h1>
          <p className="text-slate-500 text-sm mt-1">LLM 动态语义扩展 · 免维护字典</p>
        </div>
        <div className="flex gap-2">
           <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv" className="hidden" />
          <button onClick={() => fileInputRef.current.click()} className="flex items-center gap-1 px-3 py-2 bg-white border rounded hover:bg-slate-50 text-sm text-slate-600">
            <Upload size={16} /> 导入CSV
          </button>
          <button onClick={() => setShowSettings(true)} className="flex items-center gap-1 px-3 py-2 bg-white border rounded hover:bg-slate-50 text-sm text-slate-600">
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
            className="w-full pl-12 pr-24 py-3 bg-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-lg"
            placeholder="请输入您的需求，如：生孩子、开饭馆..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button 
            onClick={handleSearch}
            disabled={isSearching}
            className="absolute right-2 bg-blue-600 text-white px-4 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {isSearching ? <Loader2 className="animate-spin" size={16}/> : "搜索"}
          </button>
        </div>

        {/* 动态扩展展示 */}
        {analyzedIntent && (analyzedIntent.synonyms?.length > 0) && (
          <div className="mb-4 text-xs bg-indigo-50 text-indigo-800 p-2 rounded border border-indigo-100 flex flex-wrap gap-2 items-center">
            <Sparkles size={14} className="text-indigo-600"/>
            <span className="font-bold">已为您扩展搜索:</span>
            {analyzedIntent.synonyms.map((k, i) => (
              <span key={i} className="bg-white px-1.5 py-0.5 rounded border border-indigo-200 shadow-sm">{k}</span>
            ))}
          </div>
        )}

        {/* 筛选器 */}
        <div className="flex flex-wrap gap-4 pt-4 border-t border-slate-100">
          <div className="flex items-center gap-2">
            <User size={16} className="text-slate-400" />
            <select value={userRole} onChange={(e) => setUserRole(e.target.value)} className="text-sm border-none bg-transparent focus:ring-0 text-slate-700 font-medium cursor-pointer">
              <option value="全部">全部角色</option>
              <option value="自然人">个人办事</option>
              <option value="法人">企业办事</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <MapPin size={16} className="text-slate-400" />
            <select value={userLocation} onChange={(e) => setUserLocation(e.target.value)} className="text-sm border-none bg-transparent focus:ring-0 text-slate-700 font-medium cursor-pointer">
              <option value="全省">全省范围</option>
              <option value="长沙">长沙市</option>
              {/* 这里可以保留之前的城市列表 */}
            </select>
          </div>
          <div className="ml-auto flex items-center gap-2 text-sm text-slate-500">
             <Filter size={14} /> <span>{config.enableSatisfactionSort ? "满意度优先" : "智能排序"}</span>
          </div>
        </div>
      </div>

      {/* 结果列表 */}
      <div className="w-full max-w-3xl space-y-3">
        {searchResults.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            {isSearching ? "AI 正在分析您的语义..." : "暂无匹配事项，请尝试其他描述"}
          </div>
        ) : (
          searchResults.map((item, index) => (
            <div key={index} className="bg-white rounded-lg p-4 border border-slate-100 hover:shadow-md transition-shadow flex justify-between items-start group">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-lg font-semibold text-blue-900 group-hover:text-blue-700">{item["事项名称"]}</h3>
                  {item["是否高频事项"] === "是" && <span className="bg-orange-100 text-orange-700 text-xs px-1.5 py-0.5 rounded">高频</span>}
                </div>
                <div className="text-sm text-slate-500 mb-2">编码：{item["事项编码"] || "--"}</div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="bg-slate-50 px-2 py-1 rounded text-slate-600">{item["服务对象"]}</span>
                  <span className="bg-slate-50 px-2 py-1 rounded text-slate-600">{item["所属市州单位"]}</span>
                  {config.enableSatisfactionSort && item["满意度"] && <span className="text-green-600 flex items-center gap-0.5"><Star size={10} fill="currentColor"/> {item["满意度"]}</span>}
                </div>
              </div>
              <button className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 whitespace-nowrap ml-4">在线办理</button>
            </div>
          ))
        )}
      </div>

      {/* 设置弹窗 (保持逻辑不变) */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4">配置设置</h2>
            <div className="space-y-4">
              <input type="password" placeholder="API Key" className="w-full border rounded p-2" value={config.apiKey} onChange={e => setConfig({...config, apiKey: e.target.value})} />
              <input type="text" placeholder="Model (e.g. llama3-70b-8192)" className="w-full border rounded p-2" value={config.model} onChange={e => setConfig({...config, model: e.target.value})} />
              <div className="flex justify-between items-center">
                 <span>启用满意度排序</span>
                 <button onClick={() => setConfig({...config, enableSatisfactionSort: !config.enableSatisfactionSort})} className={`w-11 h-6 rounded-full ${config.enableSatisfactionSort ? 'bg-blue-600' : 'bg-gray-300'}`}><span className={`block w-4 h-4 bg-white rounded-full ml-1 transition-transform ${config.enableSatisfactionSort ? 'translate-x-5' : ''}`} /></button>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setShowSettings(false)} className="px-4 py-2 border rounded">取消</button>
              <button onClick={() => saveConfig(config)} className="px-4 py-2 bg-blue-600 text-white rounded">保存</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
