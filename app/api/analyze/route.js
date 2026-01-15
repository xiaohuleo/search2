import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    const body = await request.json();
    const { query, config } = body;

    if (!config?.apiKey) {
      return NextResponse.json(
        { error: "请先在设置中配置 API Key" },
        { status: 401 }
      );
    }

    const apiUrl = config.apiUrl || "https://api.groq.com/openai/v1/chat/completions";
    const model = config.model || "llama3-70b-8192";

    // 优化后的 Prompt：强调提取“动作”和“限定词”
    const systemPrompt = `
    你是一个政务搜索意图分析专家。
    任务：分析用户的搜索词，提取核心关键词用于数据库匹配。
    
    分析规则：
    1. 提取实体词（如：身份证、公积金）。
    2. 提取限定词/状态词（如：到期、丢失、损坏、变更）。这是区分事项的关键，必须提取。
    3. 提取动作词（如：换领、补办、提取）。
    4. 去除无意义的助词（如：了、吗、我要、想）。
    
    返回格式必须是纯 JSON：
    {
      "keywords": ["核心词1", "核心词2", "核心词3"], 
      "target_user": "法人" 或 "自然人" 或 "不确定",
      "location": "城市名" 或 null
    }

    示例：
    用户输入："身份证到期了"
    返回：{"keywords": ["身份证", "到期", "换领"], "target_user": "自然人", "location": null}
    （注意：即使通过联想，也要补全“换领”这个动作）
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
          { role: "user", content: `用户搜索内容：${query}` },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" }
      }),
    });

    if (!response.ok) {
      return NextResponse.json({ keywords: [query], target_user: "不确定" });
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    let parsedContent;
    try {
      parsedContent = JSON.parse(content);
    } catch (e) {
      const match = content.match(/\{[\s\S]*\}/);
      parsedContent = match ? JSON.parse(match[0]) : { keywords: [query], target_user: "不确定" };
    }

    return NextResponse.json(parsedContent);

  } catch (error) {
    console.error("API Error", error);
    // 出错时返回兜底数据，保证前端不崩
    return NextResponse.json({ keywords: [query], target_user: "不确定" });
  }
}
