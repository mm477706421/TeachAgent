import { memo, useEffect, useMemo, useState } from "react";
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
  animate,
  onComplete,
  onProgress,
}: {
  content: string;
  animate: boolean;
  onComplete: () => void;
  onProgress: () => void;
}) {
  const [visible, setVisible] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const offsets = useMemo(() => {
    // Reveal complete graphemes, including Chinese and joined emoji.
    const segments = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });
    return Array.from(
      segments.segment(content),
      ({ index, segment }) => index + segment.length,
    );
  }, [content]);

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!animate) return;
    if (reducedMotion || !offsets.length) {
      onComplete();
      return;
    }
    setVisible(0);
    const started = performance.now();
    const duration = Math.min(12000, Math.max(600, offsets.length * 24));
    const timer = window.setInterval(() => {
      const count = Math.min(
        offsets.length,
        Math.floor(((performance.now() - started) / duration) * offsets.length),
      );
      setVisible(count);
      if (count === offsets.length) {
        window.clearInterval(timer);
        onComplete();
      }
    }, 32);
    return () => window.clearInterval(timer);
  }, [animate, content, offsets, reducedMotion, onComplete]);

  const typing = animate && !reducedMotion && visible < offsets.length;
  const text = typing
    ? content.slice(0, visible ? offsets[visible - 1] : 0)
    : content;
  useEffect(() => onProgress(), [text, typing, onProgress]);

  return (
    <div className="assistant-reply" data-typing={typing}>
      <div
        className="message-bubble markdown-body"
        aria-live={animate ? "polite" : "off"}
        aria-atomic="true"
        aria-busy={typing}
      >
        <Markdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
          skipHtml
        >
          {text}
        </Markdown>
        {typing && <span className="typing-cursor" aria-hidden="true" />}
      </div>
      {typing && (
        <div className="typing-controls">
          <span role="status">正在显示回答…</span>
          <button type="button" className="text-btn" onClick={onComplete}>
            立即显示全文
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(AssistantMessage);
