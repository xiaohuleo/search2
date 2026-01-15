"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Papa from "papaparse";
import { Search, Settings, Upload, MapPin, User, ChevronDown, Check, Star, Filter } from "lucide-react";
import { DEFAULT_DATA } from "./lib/data";

export default function Home() {
  // --- 状态管理 ---
  
  // 数据源
  const [allData, setAllData] = useState([]);
  
  // 搜索相关
  const [query, setQuery] = useState("");
  const [analyzedIntent, setAnalyzedIntent] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);

  // 用户手动上下文 (当无法自动获取时)
  const [userRole, setUserRole] = useState("全部"); // 全部, 自然人, 法人
  const [userLocation, setUserLocation] = useState("全省");
  
  // 设置 & 配置
  const [showSettings, setShowSettings] = useState(false);
  const [config, setConfig] = useState({
    apiUrl: "https://api.groq.com/openai/v1/chat/completions",
    apiKey: "",
    model: "llama3-70b-8192",
    enableSatisfactionSort: false, // 满意度排序开关
  });

  // 引用隐藏的文件输入框
  const fileInputRef = useRef(null);

  // --- 初始化 ---

  useEffect(() => {
    // 1. 加载本地存储的配置
    const savedConfig = localStorage.getItem("gov_search_config");
    if (savedConfig) {
      setConfig(JSON.parse(savedConfig));
    }
    // 2. 加载默认数据
    setAllData(DEFAULT_DATA);
    setSearchResults(DEFAULT_DATA.slice(0, 20)); // 默认显示前20条
  }, []);

  // 保存配置
  const saveConfig = (newConfig) => {
    setConfig(newConfig);
    localStorage.setItem("gov_search_config", JSON.stringify(newConfig));
    setShowSettings(false);
  };

  // --- 核心功能：搜索与排序算法 ---

  const handleSearch = async () => {
    if (!query.trim()) {
      setSearchResults(allData.slice(0, 50));
      return;
    }

    setIsSearching(true);
    let currentIntent = null;

    // 1. AI 意图识别 (如果配置了 API)
    if (config.apiKey) {
      setIsAiAnalyzing(true);
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
          // 如果AI识别出了明确的城市或角色，自动更新上下文（模拟智能识别）
          if (data.location && data.location !== "null") setUserLocation(data.location);
          if (data.target_user && data.target_user !== "不确定") setUserRole(data.target_user);
        }
      } catch (error) {
        console.error("AI Analysis failed:", error);
      } finally {
        setIsAiAnalyzing(false);
      }
    }

    // 2. 过滤与加权排序
    const keywords = currentIntent?.keywords?.length > 0 ? currentIntent.keywords : [query];
    
    // 预处理搜索词
    const searchTerms = keywords.map(k => k.toLowerCase());

    const scoredData = allData.map(item => {
      let score = 0;
      let matched = false;

      // A. 关键词匹配 (权重最高)
      const itemName = item["事项名称"]?.toLowerCase() || "";
      const itemCode = item["事项编码"]?.toLowerCase() || "";
      const itemTags = item["事项标签"]?.toLowerCase() || "";
      
      // 只要匹配到一个关键词
      if (searchTerms.some(term => itemName.includes(term) || itemCode.includes(term))) {
        score += 100;
        matched = true;
      } else if (searchTerms.some(term => itemTags.includes(term))) {
        score += 50;
        matched = true;
      }

      if (!matched) return { item, score: -1 }; // 不匹配直接过滤

      // B. 角色维度匹配 (权重: 20)
      if (userRole !== "全部") {
        if (item["服务对象"] === userRole) {
          score += 20;
        } else {
          score -= 20; // 惩罚不匹配的角色
        }
      }

      // C. 地理位置维度匹配 (权重: 15)
      // 如果用户选了特定城市，优先展示该城市或全省通用的
      if (userLocation !== "全省") {
        if (item["所属市州单位"].includes(userLocation)) {
          score += 15;
        } else if (item["所属市州单位"] === "全省通用") {
          score += 5; // 通用的稍微加点分
        } else {
          score -= 10; // 其他城市的减分
        }
      }

      // D. 用户搜索量/高频事项 (权重: 10)
      if (item["是否高频事项"] === "是") score += 10;
      if (item["搜索量"]) {
        score += Math.log(parseInt(item["搜索量"]) || 1); // 对数加分，避免数字过大
      }

      // E. 满意度 (权重: 可配置)
      if (config.enableSatisfactionSort && item["满意度"]) {
        score += parseFloat(item["满意度"]) * 2; // 10分制 * 2
      }

      return { item, score };
    });

    // 过滤掉不匹配的 (-1)，然后按分数降序
    const sorted = scoredData
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.item);

    setSearchResults(sorted);
    setIsSearching(false);
  };

  // --- CSV 导入功能 ---

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.data && results.data.length > 0) {
          setAllData(results.data);
          alert(`成功导入 ${results.data.length} 条服务事项数据`);
          setSearchResults(results.data.slice(0, 50));
        }
      },
      error: (error) => {
        alert("CSV 解析失败: " + error.message);
      }
    });
  };

  // --- 界面渲染 ---

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col items-center py-10 px-4">
      {/* 1. 顶部栏：标题与设置 */}
      <div className="w-full max-w-3xl flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">智慧政务服务搜索</h1>
          <p className="text-slate-500 text-sm mt-1">精准意图识别 · 多维度智能排序</p>
        </div>
        <div className="flex gap-2">
           {/* 隐藏的文件上传 */}
           <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            accept=".csv" 
            className="hidden" 
          />
          <button 
            onClick={() => fileInputRef.current.click()}
            className="flex items-center gap-1 px-3 py-2 bg-white border rounded hover:bg-slate-50 text-sm text-slate-600"
          >
            <Upload size={16} /> 导入CSV
          </button>
          <button 
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1 px-3 py-2 bg-white border rounded hover:bg-slate-50 text-sm text-slate-600"
          >
            <Settings size={16} /> 设置
          </button>
        </div>
      </div>

      {/* 2. 搜索区域 */}
      <div className="w-full max-w-3xl bg-white rounded-xl shadow-lg p-6 mb-6">
        {/* 输入框 */}
        <div className="relative flex items-center mb-4">
          <Search className="absolute left-4 text-slate-400" size={20} />
          <input
            type="text"
            className="w-full pl-12 pr-24 py-3 bg-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-lg"
            placeholder="请输入您要办理的业务，如：我要开餐饮店..."
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

        {/* 智能辅助信息展示 (AI分析结果) */}
        {analyzedIntent && (
          <div className="mb-4 text-xs bg-blue-50 text-blue-800 p-2 rounded border border-blue-100 flex flex-wrap gap-2 items-center">
            <span className="font-bold">✨ AI 意图识别:</span>
            {analyzedIntent.keywords?.map((k, i) => (
              <span key={i} className="bg-white px-1.5 py-0.5 rounded border border-blue-200">关键词: {k}</span>
            ))}
            {analyzedIntent.target_user && <span className="bg-white px-1.5 py-0.5 rounded border border-blue-200">对象: {analyzedIntent.target_user}</span>}
            {analyzedIntent.location && <span className="bg-white px-1.5 py-0.5 rounded border border-blue-200">地区: {analyzedIntent.location}</span>}
          </div>
        )}

        {/* 上下文手动选择器 (模拟用户画像无法获取时的手动降级方案) */}
        <div className="flex flex-wrap gap-4 pt-4 border-t border-slate-100">
          <div className="flex items-center gap-2">
            <User size={16} className="text-slate-400" />
            <select 
              value={userRole} 
              onChange={(e) => setUserRole(e.target.value)}
              className="text-sm border-none bg-transparent focus:ring-0 text-slate-700 font-medium cursor-pointer"
            >
              <option value="全部">全部角色</option>
              <option value="自然人">个人办事 (自然人)</option>
              <option value="法人">企业办事 (法人)</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <MapPin size={16} className="text-slate-400" />
            <select 
              value={userLocation}
              onChange={(e) => setUserLocation(e.target.value)}
              className="text-sm border-none bg-transparent focus:ring-0 text-slate-700 font-medium cursor-pointer"
            >
              <option value="全省">全省范围</option>
              <option value="长沙">长沙市</option>
              <option value="株洲">株洲市</option>
              <option value="湘潭">湘潭市</option>
              <option value="衡阳">衡阳市</option>
              <option value="邵阳">邵阳市</option>
              <option value="岳阳">岳阳市</option>
              <option value="怀化">怀化市</option>
              {/* 其他城市省略，Demo演示即可 */}
            </select>
          </div>

          <div className="ml-auto flex items-center gap-2 text-sm text-slate-500">
             <Filter size={14} />
             <span>排序策略：{config.enableSatisfactionSort ? "综合 + 满意度" : "综合推荐"}</span>
          </div>
        </div>
      </div>

      {/* 3. 结果列表 */}
      <div className="w-full max-w-3xl space-y-3">
        {searchResults.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            暂无匹配的政务服务事项
          </div>
        ) : (
          searchResults.map((item, index) => (
            <div key={index} className="bg-white rounded-lg p-4 border border-slate-100 hover:shadow-md transition-shadow flex justify-between items-start group">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  {/* API约束：只显示名称、编码、服务对象、单位 */}
                  <h3 className="text-lg font-semibold text-blue-900 group-hover:text-blue-700">
                    {item["事项名称"]}
                  </h3>
                  {item["是否高频事项"] === "是" && (
                    <span className="bg-orange-100 text-orange-700 text-xs px-1.5 py-0.5 rounded">高频</span>
                  )}
                </div>
                <div className="text-sm text-slate-500 mb-2">
                  编码：{item["事项编码"] || "N/A"}
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1 text-slate-600 bg-slate-50 px-2 py-1 rounded">
                    <User size={12} /> {item["服务对象"] || "通用"}
                  </span>
                  <span className="flex items-center gap-1 text-slate-600 bg-slate-50 px-2 py-1 rounded">
                    <MapPin size={12} /> {item["所属市州单位"] || "全省"}
                  </span>
                  {/* 虽然API约束不直接返回满意度，但前端Demo若开启排序开关，可直观展示分数以验证排序效果 */}
                  {config.enableSatisfactionSort && item["满意度"] && (
                    <span className="flex items-center gap-1 text-green-600 px-2 py-1">
                      <Star size={12} fill="currentColor" /> {item["满意度"]}分
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

      {/* 4. 设置弹窗 */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4">配置设置</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">大模型 API 地址</label>
                <input 
                  type="text" 
                  className="w-full border rounded p-2 text-sm"
                  value={config.apiUrl}
                  onChange={e => setConfig({...config, apiUrl: e.target.value})}
                  placeholder="https://api.groq.com/openai/v1/chat/completions"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">API Key</label>
                <input 
                  type="password" 
                  className="w-full border rounded p-2 text-sm"
                  value={config.apiKey}
                  onChange={e => setConfig({...config, apiKey: e.target.value})}
                  placeholder="sk-..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">模型名称</label>
                <input 
                  type="text" 
                  className="w-full border rounded p-2 text-sm"
                  value={config.model}
                  onChange={e => setConfig({...config, model: e.target.value})}
                  placeholder="llama3-70b-8192"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-sm font-medium text-slate-700">启用满意度排序权重</span>
                <button 
                  onClick={() => setConfig({...config, enableSatisfactionSort: !config.enableSatisfactionSort})}
                  className={`w-11 h-6 flex items-center rounded-full transition-colors ${config.enableSatisfactionSort ? 'bg-blue-600' : 'bg-gray-300'}`}
                >
                  <span className={`bg-white w-4 h-4 rounded-full shadow transform transition-transform ml-1 ${config.enableSatisfactionSort ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button 
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded"
              >
                取消
              </button>
              <button 
                onClick={() => saveConfig(config)}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                保存配置
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
