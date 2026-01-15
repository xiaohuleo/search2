"use client";

import { useState, useEffect, useRef } from "react";
import Papa from "papaparse";
import { Search, Settings, Upload, MapPin, User, Star, Filter } from "lucide-react";
import { DEFAULT_DATA } from "./lib/data";

export default function Home() {
  // --- 状态管理 ---
  const [allData, setAllData] = useState([]);
  const [query, setQuery] = useState("");
  const [analyzedIntent, setAnalyzedIntent] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [userRole, setUserRole] = useState("全部"); 
  const [userLocation, setUserLocation] = useState("全省");
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState({
    apiUrl: "https://api.groq.com/openai/v1/chat/completions",
    apiKey: "",
    model: "llama3-70b-8192",
    enableSatisfactionSort: false,
  });
  const fileInputRef = useRef(null);

  // --- 初始化 ---
  useEffect(() => {
    const savedConfig = localStorage.getItem("gov_search_config");
    if (savedConfig) setConfig(JSON.parse(savedConfig));
    setAllData(DEFAULT_DATA);
    setSearchResults(DEFAULT_DATA.slice(0, 20));
  }, []);

  const saveConfig = (newConfig) => {
    setConfig(newConfig);
    localStorage.setItem("gov_search_config", JSON.stringify(newConfig));
    setShowSettings(false);
  };

  // --- 核心算法：文本相似度评分 ---
  // 解决"身份证到期"匹配不到"居民身份证到期换领"排第一的问题
  const calculateTextMatchScore = (itemName, searchInput, aiKeywords = []) => {
    let score = 0;
    const cleanName = itemName.toLowerCase();
    
    // 1. 预处理搜索词：去除无意义字符
    const cleanInput = searchInput.toLowerCase().replace(/[了是的吗我要想办]/g, "");
    if (!cleanInput) return 0;

    // 2. 绝对全匹配奖励 (最高权重)
    // 如果搜索词完整出现在名称中 (例如搜"身份证"，名称里有"身份证")
    if (cleanName.includes(cleanInput)) {
      score += 100;
      // 如果是开头匹配，额外加分 (例如"身份证..."比"居民身份证..."更匹配"身份证"这个词)
      if (cleanName.startsWith(cleanInput)) score += 20;
    }

    // 3. 核心逻辑：分词/字符覆盖率 (解决"身份证到期"问题)
    // 我们把搜索词拆成单字，看名称里包含了多少个字。
    // "身份证到期" (5个字) -> 目标："居民身份证到期换领" (包含全部5个字) -> 覆盖率 100%
    // 干扰项："居民身份证损坏换领" (包含"身份证"3个字，不含"到期") -> 覆盖率 60%
    let matchCount = 0;
    for (let char of cleanInput) {
      if (cleanName.includes(char)) matchCount++;
    }
    const coverageRatio = matchCount / cleanInput.length; 
    score += coverageRatio * 150; // 覆盖率权重极大

    // 4. 连续片段匹配奖励
    // 如果用户输入了"到期"，而名称中也有连续的"到期"，加分。
    // 防止"到"和"期"分开在很远的地方也被算作高分。
    if (cleanInput.length > 1) {
      // 简单的切词逻辑：每2个字一切
      for (let i = 0; i < cleanInput.length - 1; i++) {
        const sub = cleanInput.slice(i, i + 2);
        if (cleanName.includes(sub)) score += 30; // 每匹配一个双字词组加30分
      }
    }

    // 5. AI 关键词增强 (如果API生效)
    // AI可能会分析出 ["身份证", "到期", "换领"]
    if (aiKeywords && aiKeywords.length > 0) {
      aiKeywords.forEach(k => {
        if (cleanName.includes(k.toLowerCase())) score += 40;
      });
    }

    return score;
  };

  const handleSearch = async () => {
    if (!query.trim()) {
      setSearchResults(allData.slice(0, 50));
      return;
    }

    setIsSearching(true);
    let currentIntent = null;

    // 1. AI 分析
    if (config.apiKey) {
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, config }),
        });
        const data = await res.json();
        if (data && !data.error) {
          currentIntent = data;
          setAnalyzedIntent(data);
          if (data.location && data.location !== "null") setUserLocation(data.location);
          if (data.target_user && data.target_user !== "不确定") setUserRole(data.target_user);
        }
      } catch (error) {
        console.error("AI Analysis failed:", error);
      }
    } else {
      setAnalyzedIntent(null);
    }

    // 2. 排序执行
    const keywords = currentIntent?.keywords || [];
    
    const scoredData = allData.map(item => {
      // A. 计算文本相关性分数 (核心)
      let score = calculateTextMatchScore(item["事项名称"], query, keywords);
      
      // 如果文本相关性太低，直接过滤
      if (score < 10) return { item, score: -1 };

      // B. 角色维度加权
      if (userRole !== "全部") {
        if (item["服务对象"] === userRole) score += 30;
        else score -= 30;
      }

      // C. 地理位置维度加权
      if (userLocation !== "全省") {
        if (item["所属市州单位"].includes(userLocation)) score += 20;
        else if (item["所属市州单位"] === "全省通用") score += 5;
        else score -= 50; // 强力惩罚非本市事项
      }

      // D. 业务属性微调
      if (item["是否高频事项"] === "是") score += 5;
      if (config.enableSatisfactionSort && item["满意度"]) {
        score += parseFloat(item["满意度"]); 
      }
      // 搜索量微量加权
      if (item["搜索量"]) {
        score += Math.log(parseInt(item["搜索量"]) || 1) * 2;
      }

      return { item, score };
    });

    // 3. 排序并取结果
    const sorted = scoredData
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.item);

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
          setAllData(results.data);
          alert(`成功导入 ${results.data.length} 条数据`);
          setSearchResults(results.data.slice(0, 50));
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
          <p className="text-slate-500 text-sm mt-1">智能语义分析 · 意图精准识别</p>
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

      {/* 搜索框区域 */}
      <div className="w-full max-w-3xl bg-white rounded-xl shadow-lg p-6 mb-6">
        <div className="relative flex items-center mb-4">
          <Search className="absolute left-4 text-slate-400" size={20} />
          <input
            type="text"
            className="w-full pl-12 pr-24 py-3 bg-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-lg"
            placeholder="请输入您要办理的业务，如：身份证到期了..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button 
            onClick={handleSearch}
            disabled={isSearching}
            className="absolute right-2 bg-blue-600 text-white px-4 py-1.5 rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {isSearching ? "分析中..." : "搜索"}
          </button>
        </div>

        {/* AI 分析结果展示 */}
        {analyzedIntent && (
          <div className="mb-4 text-xs bg-blue-50 text-blue-800 p-2 rounded border border-blue-100 flex flex-wrap gap-2 items-center">
            <span className="font-bold">✨ 意图识别:</span>
            {analyzedIntent.keywords?.map((k, i) => (
              <span key={i} className="bg-white px-1.5 py-0.5 rounded border border-blue-200">{k}</span>
            ))}
            {analyzedIntent.target_user && <span className="bg-white px-1.5 py-0.5 rounded border border-blue-200">对象: {analyzedIntent.target_user}</span>}
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
              <option value="株洲">株洲市</option>
              <option value="湘潭">湘潭市</option>
              <option value="衡阳">衡阳市</option>
              <option value="邵阳">邵阳市</option>
              <option value="岳阳">岳阳市</option>
              <option value="怀化">怀化市</option>
            </select>
          </div>
          <div className="ml-auto flex items-center gap-2 text-sm text-slate-500">
             <Filter size={14} />
             <span>{config.enableSatisfactionSort ? "满意度优先" : "智能排序"}</span>
          </div>
        </div>
      </div>

      {/* 结果列表 */}
      <div className="w-full max-w-3xl space-y-3">
        {searchResults.length === 0 ? (
          <div className="text-center py-10 text-slate-400">暂无匹配事项</div>
        ) : (
          searchResults.map((item, index) => (
            <div key={index} className="bg-white rounded-lg p-4 border border-slate-100 hover:shadow-md transition-shadow flex justify-between items-start group">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-lg font-semibold text-blue-900 group-hover:text-blue-700">
                    {item["事项名称"]}
                  </h3>
                  {item["是否高频事项"] === "是" && (
                    <span className="bg-orange-100 text-orange-700 text-xs px-1.5 py-0.5 rounded">高频</span>
                  )}
                </div>
                <div className="text-sm text-slate-500 mb-2">
                  编码：{item["事项编码"] || "--"}
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1 text-slate-600 bg-slate-50 px-2 py-1 rounded">
                    <User size={12} /> {item["服务对象"] || "通用"}
                  </span>
                  <span className="flex items-center gap-1 text-slate-600 bg-slate-50 px-2 py-1 rounded">
                    <MapPin size={12} /> {item["所属市州单位"] || "全省"}
                  </span>
                  {config.enableSatisfactionSort && item["满意度"] && (
                    <span className="flex items-center gap-1 text-green-600 px-2 py-1">
                      <Star size={12} fill="currentColor" /> {item["满意度"]}
                    </span>
                  )}
                </div>
              </div>
              <button className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors">
                在线办理
              </button>
            </div>
          ))
        )}
      </div>

      {/* 设置弹窗 */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4">配置设置</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">API Key (Groq/OpenAI)</label>
                <input type="password" className="w-full border rounded p-2 text-sm" value={config.apiKey} onChange={e => setConfig({...config, apiKey: e.target.value})} placeholder="sk-..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">模型名称</label>
                <input type="text" className="w-full border rounded p-2 text-sm" value={config.model} onChange={e => setConfig({...config, model: e.target.value})} />
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-sm font-medium text-slate-700">启用满意度排序</span>
                <button onClick={() => setConfig({...config, enableSatisfactionSort: !config.enableSatisfactionSort})} className={`w-11 h-6 flex items-center rounded-full transition-colors ${config.enableSatisfactionSort ? 'bg-blue-600' : 'bg-gray-300'}`}>
                  <span className={`bg-white w-4 h-4 rounded-full shadow transform transition-transform ml-1 ${config.enableSatisfactionSort ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setShowSettings(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded">取消</button>
              <button onClick={() => saveConfig(config)} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">保存</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
