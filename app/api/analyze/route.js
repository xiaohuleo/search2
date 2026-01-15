// app/api/analyze/route.js
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

    // 构造 Prompt：要求模型只返回 JSON
    const systemPrompt = `
    你是一个政务搜索意图识别专家。请分析用户的搜索内容，提取关键信息。
    请必须且只能返回一个 JSON 对象，不要包含任何 Markdown 格式或解释文字。
    JSON 格式如下：
    {
      "keywords": ["关键词1", "关键词2"],
      "target_user": "法人" 或 "自然人" 或 "不确定",
      "location": "城市名" 或 "全省",
      "intent_category": "用户意图分类(如：查询、办理、投诉等)"
    }
    如果用户没有明确提及城市，location 返回 null。如果用户意图不明确，target_user 返回 "不确定"。
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
        response_format: { type: "json_object" } // 强制 JSON 模式（如果模型支持）
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json({ error: `API Error: ${errText}` }, { status: response.status });
    }

    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // 尝试解析 JSON
    let parsedContent;
    try {
      parsedContent = JSON.parse(content);
    } catch (e) {
      // 如果模型返回了非纯 JSON 字符串，尝试提取 JSON 部分
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        parsedContent = JSON.parse(match[0]);
      } else {
        parsedContent = { keywords: [query], target_user: "不确定" };
      }
    }

    return NextResponse.json(parsedContent);

  } catch (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
