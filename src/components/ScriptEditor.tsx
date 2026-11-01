import { useRef } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { cleanText, insertTag } from "@/lib/text";
const emotions = [
  ["害羞", "[shy]"],
  ["开心", "[happy]"],
  ["耳语", "[whisper]"],
  ["生气", "[angry]"],
  ["笑声", "[laughing]"],
];
export default function ScriptEditor({
  text,
  onChange,
  preview,
  onPreview,
}: {
  text: string;
  onChange: (s: string) => void;
  preview: boolean;
  onPreview: (v: boolean) => void;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const overlay = useRef<HTMLPreElement>(null);
  function add(tag: string) {
    const el = textarea.current;
    const result = insertTag(
      text,
      tag,
      el?.selectionStart ?? text.length,
      el?.selectionEnd ?? text.length,
    );
    onPreview(false);
    onChange(result.text);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(result.cursor, result.cursor);
    });
  }
  return (
    <section className="script-section" aria-label="台词编辑">
      <div className="section-heading">
        <ToggleGroup
          type="single"
          value={preview ? "caption" : "speech"}
          onValueChange={(v) => v && onPreview(v === "caption")}
          aria-label="台词预览模式"
        >
          <ToggleGroupItem value="speech">合成文本</ToggleGroupItem>
          <ToggleGroupItem value="caption">字幕文本</ToggleGroupItem>
        </ToggleGroup>
        <span className="count">
          {Array.from(preview ? cleanText(text) : text).length.toLocaleString()}{" "}
          字
        </span>
      </div>
      <div className="editor-shell">
        {preview ? (
          <div className="caption-preview">
            {cleanText(text) || (
              <span className="muted">字幕会保留台词，移除情绪指令。</span>
            )}
          </div>
        ) : (
          <>
            <pre ref={overlay} aria-hidden="true" className="editor-highlight">
              {text
                .split(/(\[[^\]\r\n]*\])/g)
                .map((part, i) =>
                  part.startsWith("[") ? (
                    <mark key={`${i}-${part}`}>{part}</mark>
                  ) : (
                    part
                  ),
                )}
              {"\n"}
            </pre>
            <textarea
              ref={textarea}
              aria-label="配音台词"
              placeholder={
                "写下这一段的声音…\n\n支持整篇台词，也可以插入情绪标签。"
              }
              spellCheck={false}
              value={text}
              onChange={(e) => onChange(e.target.value)}
              onScroll={(e) => {
                if (overlay.current)
                  overlay.current.scrollTop = e.currentTarget.scrollTop;
              }}
            />
          </>
        )}
      </div>
      <div className="emotion-bar">
        <span>情绪</span>
        {emotions.map(([label, tag]) => (
          <Button
            key={tag}
            variant="ghost"
            size="xs"
            title={tag}
            onClick={() => add(tag)}
          >
            {label}
          </Button>
        ))}
      </div>
    </section>
  );
}
