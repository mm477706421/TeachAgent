import { memo, useEffect } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "./chat-markdown.css";

const markdownComponents = {
  // Model output must not load remote images or execute embedded HTML.
  img: ({ alt }: { alt?: string }) => (
    <span className="markdown-image-note">[图片：{alt || "未提供说明"}]</span>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div
      className="markdown-table"
      role="region"
      aria-label="回答表格，可横向滚动"
      tabIndex={0}
    >
      <table>{children}</table>
    </div>
  ),
};

function AssistantMessage({
  content,
  streaming,
  onProgress,
}: {
  content: string;
  streaming: boolean;
  onProgress: () => void;
}) {
  useEffect(() => onProgress(), [content, streaming, onProgress]);
  return (
    <div className="assistant-reply" data-typing={streaming}>
      <div
        className="message-bubble markdown-body"
        aria-live="off"
        aria-busy={streaming}
      >
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
          skipHtml
        >
          {content}
        </Markdown>
        {streaming && <span className="typing-cursor" aria-hidden="true" />}
      </div>
      {streaming && (
        <span className="stream-status" role="status">
          {content ? "正在生成回答…" : "正在等待模型回应…"}
        </span>
      )}
    </div>
  );
}

export default memo(AssistantMessage);
