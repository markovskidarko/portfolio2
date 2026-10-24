export const dynamic = 'force-dynamic'
import { NextResponse } from "next/server";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are a professional portfolio analyst assistant for a private investor using Interactive Brokers (IBKR). 
You have been given real portfolio data including holdings, performance metrics, equity curve history, income, and fees.

Your role:
- Analyze portfolio health, risks, and opportunities with precision
- Compare performance across multiple accounts when data is provided
- Give concrete, actionable insights — not generic advice
- Be direct and quantitative: reference specific numbers from the data
- Flag concentration risks, underperformers, and diversification gaps
- For rebalancing suggestions, always reference the current allocation percentages
- When asked about a specific stock, use your knowledge to give deeper context
- For weekly digest requests, structure your response with clear sections

Always remind the user at the end that your analysis is based on the snapshot data provided and not financial advice.`;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { messages, portfolioContext, stream = true } = body;

    if (!portfolioContext) {
      return NextResponse.json({ error: "No portfolio context provided" }, { status: 400 });
    }

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: "Messages array required" }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not set in .env.local" },
        { status: 500 }
      );
    }

    // Inject portfolio context into the first user message
    const messagesWithContext = messages.map((msg: { role: string; content: string }, idx: number) => {
      if (idx === 0 && msg.role === "user") {
        return {
          ...msg,
          content: `Here is my current portfolio data:\n\n${portfolioContext}\n\n---\n\nMy question: ${msg.content}`,
        };
      }
      return msg;
    });

    const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        stream,
        system: SYSTEM_PROMPT,
        messages: messagesWithContext,
      }),
    });

    if (!claudeResponse.ok) {
      const err = await claudeResponse.json();
      return NextResponse.json(
        { error: err.error?.message || `Claude API error ${claudeResponse.status}` },
        { status: claudeResponse.status }
      );
    }

    if (stream) {
      // Stream the response directly to the client
      return new Response(claudeResponse.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    } else {
      const data = await claudeResponse.json();
      const text = data.content?.map((b: { text?: string }) => b.text || "").join("") || "";
      return NextResponse.json({ response: text });
    }
  } catch (error) {
    console.error("[Claude API Route] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

