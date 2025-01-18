"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  MessageCircle,
  X,
  Maximize2,
  Minimize2,
  Square,
  ArrowDown,
} from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import MarkdownPreview from "@uiw/react-markdown-preview";

export function AIChatbox() {
  const [isOpen, setIsOpen] = useState(false);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [width, setWidth] = useState(500);
  const [startX, setStartX] = useState(0);
  const [startWidth, setStartWidth] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const chatBoxRef = useRef<HTMLDivElement>(null);
  const [chatMessages, setChatMessages] = useState<
    Array<{ role: string; content: string; createdAt?: string; isStreaming?: boolean }>
  >([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({
      behavior: isLoadingMore ? 'auto' : 'smooth'
    });
  };

  const loadMessages = async (cursor?: string | null) => {
    console.log('Loading messages...', { cursor, isLoadingMore, isLoadingHistory });

    try {
      const url = new URL("/api/chat/history", window.location.origin);
      if (cursor) {
        url.searchParams.set("cursor", cursor);
      }
      const response = await fetch(url);
      const data = await response.json();
      console.log('Received messages:', data);

      if (data.messages) {
        if (cursor) {
          const newMessages = [...data.messages];
          newMessages.sort((a, b) =>
            new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
          );
          setChatMessages(prev => [...newMessages, ...prev]);
        } else {
          const sortedMessages = [...data.messages].sort((a, b) =>
            new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
          );
          setChatMessages(sortedMessages);
        }
        setHasMore(data.hasMore);
        setNextCursor(data.nextCursor);
      }
    } catch (error) {
      console.error("Failed to load chat history:", error);
      toast({
        title: "Error",
        description: "Failed to load chat history",
        variant: "destructive",
      });
    } finally {
      setIsLoadingHistory(false);
      setIsLoadingMore(false);
    }
  };

  // Load initial messages when component mounts
  useEffect(() => {
    if (isOpen) {
      console.log('Component opened, loading initial messages');
      setIsLoadingHistory(true);
      loadMessages();
    } else {
      // Reset states when closing
      setChatMessages([]);
      setHasMore(false);
      setNextCursor(null);
    }
  }, [isOpen]);

  // Handle scroll to load more messages and show/hide scroll button
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const scrollContainer = e.currentTarget;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainer;

    // Show scroll button when scrolled up just a little (20px)
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 20;
    setShowScrollButton(!isAtBottom);

    // Only load more if we're very close to the top (within 50px) and have more messages
    if (scrollTop < 50 && hasMore && !isLoadingMore && !isLoadingHistory) {
      // Calculate if we're at the absolute top
      const isAtTop = scrollTop === 0;

      if (isAtTop) {
        console.log('At top, loading more messages...', { nextCursor });
        setIsLoadingMore(true);
        loadMessages(nextCursor);
      }
    }
  };

  // Only scroll to bottom for new messages, not for loading history or older messages
  useEffect(() => {
    if (chatMessages.length > 0 && !isLoadingHistory && !isLoadingMore) {
      const lastMessage = chatMessages[chatMessages.length - 1];
      if ((lastMessage.role === "assistant" || lastMessage.role === "user") &&
        !lastMessage.createdAt) {
        scrollToBottom();
      }
    }
  }, [chatMessages, isLoadingHistory, isLoadingMore]);

  const handleStopResponse = () => {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setIsLoading(false);
      // Add the last message as completed to prevent hanging state
      setChatMessages((prev) => {
        const lastMessage = prev[prev.length - 1];
        if (lastMessage && lastMessage.role === "assistant") {
          return [...prev.slice(0, -1), { ...lastMessage, isStreaming: false }];
        }
        return prev;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    setIsLoading(true);
    setChatMessages((prev) => [...prev, { role: "user", content: inputValue }]);
    const userMessage = inputValue;
    setInputValue("");

    // Create new AbortController for this request
    const controller = new AbortController();
    setAbortController(controller);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...chatMessages, { role: "user", content: userMessage }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error("Failed to send message");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No reader available");

      let currentMessage = {
        role: "assistant",
        content: "",
        // isStreaming: true
      };

      setChatMessages((prev) => [...prev, currentMessage]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = new TextDecoder().decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data);

              if (parsed.isComplete) {
                // Replace the streaming message with the complete one
                setChatMessages((prev) => [
                  ...prev.slice(0, -1),
                  { role: "assistant", content: parsed.content },
                ]);
              } else if (parsed.isStreaming) {
                // Update the current streaming message
                setChatMessages((prev) => [
                  ...prev.slice(0, -1),
                  { ...currentMessage, content: parsed.content },
                ]);
                currentMessage.content = parsed.content;
              }
            } catch (e) {
              console.error("Failed to process chunk:", e);
            }
          }
        }
      }
    } catch (error) {
      console.error("Chat error:", error);
      toast({
        title: "Error",
        description: "Failed to send message",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Handle mouse down event to start dragging
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    setStartX(e.clientX);
    setStartWidth(width);
  };

  // Handle mouse move event while dragging
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const deltaX = startX - e.clientX;
      const newWidth = Math.max(400, Math.min(1200, startWidth + deltaX));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      // Prevent text selection while dragging
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.userSelect = "";
    };
  }, [isDragging, startX, startWidth]);

  // Handle mobile responsiveness
  useEffect(() => {
    const checkMobile = () => {
      const isMobileView = window.innerWidth < 768;
      setIsMobile(isMobileView);
      if (isMobileView && isOpen) {
        setIsFullScreen(true);
      }
    };

    // Check on mount
    checkMobile();

    // Add resize listener
    window.addEventListener('resize', checkMobile);

    return () => {
      window.removeEventListener('resize', checkMobile);
    };
  }, [isOpen]);

  if (!isOpen) {
    return (
      <Button
        onClick={() => {
          setIsOpen(true);
          if (isMobile) {
            setIsFullScreen(true);
          }
        }}
        className="fixed bottom-20 right-4 z-50 h-14 w-14 rounded-full p-0 shadow-lg transition-all hover:shadow-xl lg:bottom-4"
      >
        <MessageCircle className="h-6 w-6" />
      </Button>
    );
  }

  return (
    <Card
      ref={chatBoxRef}
      className={cn(
        "fixed z-50 flex flex-col overflow-hidden shadow-xl transition-all duration-200",
        isFullScreen || isMobile
          ? "inset-0 h-dvh w-screen rounded-none"
          : "bottom-4 right-4 h-[600px] max-h-[calc(100vh-2rem)] rounded-lg",
        isDragging && "select-none",
      )}
      style={
        !isFullScreen && !isMobile
          ? {
              width: `${width}px`,
              transition: isDragging ? "none" : "width 0.3s ease-in-out",
            }
          : undefined
      }
    >
      {/* Add drag handle with improved styling */}
      {!isFullScreen && !isMobile && (
        <div
          className="absolute left-0 top-0 h-full w-2 cursor-ew-resize hover:bg-primary/10 active:bg-primary/20"
          onMouseDown={handleMouseDown}
          style={{ touchAction: "none" }}
        />
      )}

      <div className={cn(
        "flex items-center justify-between border-b p-4",
        isFullScreen && !isMobile && "px-8 py-4"
      )}>
        <h3 className={cn(
          "text-lg font-semibold",
          isFullScreen && !isMobile && "text-xl"
        )}>AI Assistant</h3>
        <div className="flex items-center gap-2">
          {!isMobile && (
            <Button
              variant="ghost"
              size={isFullScreen ? "default" : "icon"}
              onClick={() => {
                setIsFullScreen(!isFullScreen);
                if (!isFullScreen) {
                  setWidth(500);
                }
              }}
              className="hover:bg-primary/10"
            >
              {isFullScreen ? (
                <div className="flex items-center gap-2">
                  <Minimize2 className="h-4 w-4" />
                  <span>Exit Fullscreen</span>
                </div>
              ) : (
                <Maximize2 className="h-5 w-5" />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setIsOpen(false);
              setIsFullScreen(false);
              setWidth(500);
            }}
            className="hover:bg-primary/10"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "flex-1 overflow-y-auto relative",
          isDragging && "pointer-events-none",
          isFullScreen && !isMobile ? "p-6" : "p-4"
        )}
        onScroll={handleScroll}
      >
        <div className={cn(
          "space-y-4",
          isFullScreen && "mx-auto max-w-5xl"
        )}>
          {/* Loading More Indicator - Move to top */}
          {isLoadingMore && (
            <div className="sticky top-0 flex justify-center py-2 bg-background/80 backdrop-blur-sm z-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Messages */}
          {isLoadingHistory ? (
            <div className="space-y-4">
              <div className="h-10 w-[60%] animate-pulse rounded-lg bg-muted" />
              <div className="ml-auto h-10 w-[80%] animate-pulse rounded-lg bg-muted" />
              <div className="h-10 w-[70%] animate-pulse rounded-lg bg-muted" />
            </div>
          ) : chatMessages.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              <h4 className="mb-2 text-lg font-medium">Welcome to AI Assistant!</h4>
              <p className="text-sm">Ask me anything about your tasks, schedule, or planning needs.</p>
            </div>
          ) : (
            <div className="flex flex-col space-y-4">
              {chatMessages.map((message, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex flex-col gap-2 rounded-lg px-4 py-2.5 text-sm",
                    message.role === "user"
                      ? "ml-auto w-fit max-w-[80%] bg-primary text-primary-foreground"
                      : "mr-auto w-full bg-secondary/50 backdrop-blur-sm",
                  )}
                >
                  {message.role === "assistant" ? (
                    <div className="w-full overflow-hidden">
                      <MarkdownPreview
                        source={message.content}
                        style={{
                          backgroundColor: "transparent",
                          color: "inherit",
                          fontSize: "0.875rem",
                        }}
                        className={cn(
                          "[&_.wmde-markdown]:bg-transparent",
                          "[&_blockquote]:pl-4 [&_blockquote]:italic",
                          "[&_code]:rounded [&_code]:px-1.5 [&_code]:py-0.5",
                          "[&_li]:mb-2 [&_ol]:list-decimal [&_ol]:pl-6",
                          "[&_pre]:rounded-lg [&_pre]:p-4",
                          // Enhanced table styles
                          "[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:rounded-lg [&_table]:border [&_table]:border-border",
                          "[&_table]:bg-background/50 [&_table]:shadow-sm",
                          // Table header styles
                          "[&_thead]:bg-muted/50",
                          "[&_th]:border [&_th]:border-border [&_th]:p-2 [&_th]:text-left [&_th]:font-semibold",
                          // Table cell styles
                          "[&_td]:border [&_td]:border-border [&_td]:p-2 [&_td]:align-middle",
                          // Text wrapping and overflow
                          "[&_td]:max-w-[200px] [&_td]:break-words",
                          "[&_th]:max-w-[200px] [&_th]:break-words",
                          // Dark mode
                          "dark:[&_table]:bg-background/5",
                          "dark:[&_thead]:bg-muted/20",
                          // Mobile optimizations
                          "text-[13px] md:text-sm",
                          // Ensure content is readable
                          "prose prose-sm max-w-none dark:prose-invert",
                          "[&_p]:mb-2 [&_p]:text-foreground",
                          // Scrollable table container
                          "[&_table]:block [&_table]:overflow-x-auto md:[&_table]:inline-table",
                          "[&_table]:max-w-full",
                          // Priority column
                          "[&_td:first-child]:whitespace-nowrap [&_td:first-child]:font-medium",
                          "[&_th:first-child]:whitespace-nowrap",
                        )}
                      />
                    </div>
                  ) : (
                    <div className="break-words">{message.content}</div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Current Message Loading */}
          {isLoading && (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Scroll to Bottom Button */}
        {showScrollButton && (
          <div className="fixed bottom-[120px] right-12 z-50">
            <Button
              size="icon"
              variant="secondary"
              className="h-10 w-10 rounded-full shadow-lg hover:shadow-xl transition-all duration-200 hover:translate-y-[-2px]"
              onClick={scrollToBottom}
            >
              <ArrowDown className="h-5 w-5" />
            </Button>
          </div>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className={cn(
          "border-t bg-background/80 backdrop-blur-sm",
          isFullScreen && !isMobile ? "p-6" : "p-4"
        )}
      >
        <div
          className={cn(
            "flex gap-3",
            isFullScreen && "mx-auto max-w-6xl"
          )}
        >
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type your message..."
            className={cn(
              "flex-1 text-base",
              isFullScreen && !isMobile ? "h-12 text-base" : "h-12"
            )}
            disabled={isLoading}
          />
          {isLoading ? (
            <Button
              type="button"
              size={isFullScreen && !isMobile ? "default" : "default"}
              variant="destructive"
              className={cn(
                "gap-2",
                isFullScreen && !isMobile ? "px-6 h-12" : "px-6"
              )}
              onClick={handleStopResponse}
            >
              <Square className="h-4 w-4" />
              Stop
            </Button>
          ) : (
            <Button
              type="submit"
              size={isFullScreen && !isMobile ? "default" : "default"}
              className={cn(
                isFullScreen && !isMobile ? "px-6 h-12" : "px-6"
              )}
              disabled={!inputValue.trim()}
            >
              Send
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}
