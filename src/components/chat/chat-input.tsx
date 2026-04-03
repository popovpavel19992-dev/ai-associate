"use client";

import { useState, useCallback, useRef } from "react";
import { Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MAX_CHARS = 10_000;

interface ChatInputProps {
  onSend: (content: string) => void;
  isLoading: boolean;
  disabled?: boolean;
}

export function ChatInput({ onSend, isLoading, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || isLoading || disabled) return;
    onSend(trimmed);
    setValue("");
    textareaRef.current?.focus();
  }, [value, isLoading, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const charCount = value.length;
  const isOverLimit = charCount > MAX_CHARS;

  return (
    <div className="border-t bg-background p-3">
      <div className="flex gap-2">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this case..."
          disabled={isLoading || disabled}
          className="min-h-10 max-h-32 resize-none"
          rows={1}
        />
        <Button
          size="icon"
          onClick={handleSend}
          disabled={!value.trim() || isLoading || disabled || isOverLimit}
        >
          {isLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
        </Button>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>Shift+Enter for new line</span>
        <span className={isOverLimit ? "text-destructive" : ""}>
          {charCount.toLocaleString()}/{MAX_CHARS.toLocaleString()}
        </span>
      </div>
    </div>
  );
}
