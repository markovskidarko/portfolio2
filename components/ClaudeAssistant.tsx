"use client";

import React, { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { AggregatedData } from "@/lib/types";
import { buildPortfolioContext } from "@/lib/claude-context";
import { X, Send, Bot, ChevronDown, ChevronUp, Sparkles } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ClaudeAssistantProps {
  data: AggregatedData | null;
  selectedAccountIds?: Set<string>;
  className?: string;
}

const QUICK_PROMPTS = [
  { label: "Portfolio audit", prompt: "Give me a full audit of my portfolio — health, risks, concentration issues, and top recommendations." },
  { label: "Compare accounts", prompt: "Compare my accounts against each other. Which is performing best on a risk-adjusted basis and why?" },
  { label: "Rebalancing", prompt: "Based on my current allocations, what rebalancing would you suggest to improve diversification?" },
  { label: "Top risks", prompt: "What are the top 3 risks in my current portfolio? Be specific about positions and percentages." },
  { label: "Best performers", prompt: "Which positions are performing best and worst? Should I add to winners or cut losers?" },
  { label: "Weekly digest", prompt: "Generate a concise weekly portfolio digest: performance summary, key movers, income received, and what to watch." },
  { label: "Fee analysis", prompt: "Analyze my fees and income. Are my commissions and withholding taxes reasonable? How is my dividend yield?" },
  { label: "Stock deep dive", prompt: "Pick my largest holding and give me a deep dive: thesis, risks, valuation, and whether I should hold/add/trim." },
];

export default function ClaudeAssistant({ data, selectedAccountIds, className }: ClaudeAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showQuickPrompts, setShowQuickPrompts] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const portfolioContext = data ? buildPortfolioContext(data) : "No portfolio data loaded.";

  const sendMessage = async (content: string) => {
    if (!content.trim() || loading) return;

    const userMessage: Message = { role: "user", content: content.trim() };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    setShowQuickPrompts(false);

    try {
      const response = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          portfolioContext,
          stream: true,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${err.error || "Failed to reach Claude"}` },
        ]);
        return;
      }

      // Stream the response
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value).split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                assistantText += parsed.delta.text;
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: "assistant", content: assistantText };
                  return updated;
                });
              }
            } catch {}
          }
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Unknown error"}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setShowQuickPrompts(true);
  };

  return (
    <div className={cn("fixed bottom-6 right-6 z-50", className)}>
      {/* Chat Panel */}
      {isOpen && (
        <div className="mb-3 w-[480px] max-h-[75vh] flex flex-col bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card/80 backdrop-blur-sm flex-shrink-0">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm text-foreground">Claude Portfolio Analyst</span>
              {data && (
                <span className="text-xs text-muted-foreground">
                  · {data.accounts.length} account{data.accounts.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <button
                  onClick={clearChat}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Clear
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {messages.length === 0 && (
              <div className="text-center py-4">
                <Bot className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
                <p className="text-sm text-muted-foreground">
                  Ask me anything about your portfolio
                </p>
                {!data && (
                  <p className="text-xs text-destructive mt-2">No portfolio data loaded</p>
                )}
              </div>
            )}

            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={cn(
                  "flex",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  )}
                >
                  {msg.content || (loading && idx === messages.length - 1 ? (
                    <span className="flex gap-1 items-center text-muted-foreground">
                      <span className="animate-bounce delay-0">·</span>
                      <span className="animate-bounce delay-100">·</span>
                      <span className="animate-bounce delay-200">·</span>
                    </span>
                  ) : "")}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Prompts */}
          {showQuickPrompts && messages.length === 0 && (
            <div className="px-4 pb-3 flex-shrink-0">
              <div className="flex items-center gap-1 mb-2">
                <Sparkles className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Quick analysis</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_PROMPTS.map((qp) => (
                  <button
                    key={qp.label}
                    onClick={() => sendMessage(qp.prompt)}
                    disabled={loading || !data}
                    className="text-xs px-2.5 py-1 rounded-full border border-border bg-background hover:bg-muted hover:border-primary/40 transition-colors disabled:opacity-40"
                  >
                    {qp.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="px-4 py-3 border-t border-border flex-shrink-0 bg-card/50">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(input);
                  }
                }}
                placeholder={data ? "Ask about your portfolio..." : "No portfolio data"}
                disabled={loading || !data}
                className="flex-1 text-sm bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-primary/50 disabled:opacity-50 text-foreground placeholder:text-muted-foreground"
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={loading || !input.trim() || !data}
                className="p-2 rounded-lg bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          "flex items-center gap-2 px-4 py-3 rounded-full shadow-lg transition-all font-medium text-sm",
          "bg-primary text-primary-foreground hover:bg-primary/90",
          isOpen && "bg-primary/80"
        )}
      >
        <Bot className="h-4 w-4" />
        <span>Ask Claude</span>
        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
        {messages.length > 0 && !isOpen && (
          <span className="ml-1 bg-white/20 text-xs rounded-full px-1.5 py-0.5">
            {messages.filter((m) => m.role === "assistant").length}
          </span>
        )}
      </button>
    </div>
  );
}
