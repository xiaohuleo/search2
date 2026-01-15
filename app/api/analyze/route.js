import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const body = await request.json();
    const { query, config } = body;

    // 如果未配置 API Key，返回空扩展，保证基础搜索可用
    if (!config?.apiKey) {
      return NextResponse.json({ 
        keywords: [query], 
        synonyms: [], 
        target_user: "不确定" 
      });
    }

    const apiUrl = config.apiUrl || "https://api.groq.com/openai/v1/chat/completions";
    const model = config.model || "llama3-70b-8192";

    const systemPrompt = `
    你是一个精通中国政务服务的搜索专家。
    用户的搜索词通常是口语化的（如"生娃"、"开店"、"扯证"）。
    你的任务是：
    1. 提取核心关键词。
    2. **最重要**：生成对应的"官方政务术语"和"同义词"。
    
    示例：
    - 输入："生孩子" -> 扩展词：["生育登记", "出生医学证明", "新生儿", "孕产", "卫健委"]
    - 输入："开饭馆" -> 扩展词：["食品经营许可", "营业执照", "餐饮服务", "个体工商户"]
    - 输入："身份证到期" -> 扩展词：["居民身份证", "有效期满换领", "证件换发"]
    
    请返回纯 JSON 格式：
    {
      "keywords": ["原始关键词1", "原始关键词2"],
      "synonyms": ["官方术语1", "官方术语2", "官方术语3", "官方术语4"],
      "target_user": "法人" 或 "自然人" 或 "不确定",
      "location": "城市名" 或 null
    }
    `;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `用户搜索：${query}` },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" }
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ keywords: [query], synonyms: [] });
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    let parsedContent;
    try {
      parsedContent = JSON.parse(content);
    } catch (e) {
      const match = content.match(/\{[\s\S]*\}/);
      parsedContent = match ? JSON.parse(match[0]) : { keywords: [query], synonyms: [] };
    }

    return NextResponse.json(parsedContent);

  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json({ keywords: [query], synonyms: [] });
  }
}
