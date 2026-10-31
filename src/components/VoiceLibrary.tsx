import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Headphones,
  Plus,
  Search,
  Star,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import type { Voice } from "@/types";
import { call } from "@/lib/api";
const blank: Voice = {
  id: "",
  name: "",
  provider: "fish",
  description: "",
  favorite: false,
  tags: [],
  lastUsed: null,
  previewText: "你好，欢迎来到我的声音工作台。",
};
export default function VoiceLibrary({
  voices,
  selected,
  onChange,
  onSelect,
  onPreview,
  notify,
  busy,
}: {
  voices: Voice[];
  selected: string;
  onChange: (v: Voice[]) => void;
  onSelect: (id: string) => void;
  onPreview: (v: Voice) => void;
  notify: (s: string) => void;
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [favorites, setFavorites] = useState(false);
  const [editing, setEditing] = useState<Voice | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [removing, setRemoving] = useState<Voice | null>(null);
  const [importing, setImporting] = useState(false);
  async function importVoices() {
    setImporting(true);
    try {
      const r = await call<{ voices: Voice[]; warning: string | null }>(
        "import_voices",
      );
      const added = r.voices.filter((v) => !voices.some((w) => w.id === v.id));
      onChange([...voices, ...added]);
      notify(
        `已导入 ${added.length} 个账号音色，保留已有别名。${r.warning || ""}`,
      );
    } catch (e) {
      notify(String(e));
    } finally {
      setImporting(false);
    }
  }
  const filtered = voices.filter(
    (v) =>
      (!favorites || v.favorite) &&
      `${v.name} ${v.id} ${v.description} ${v.tags.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  function commit() {
    if (!editing) return;
    if (
      !/^[a-zA-Z0-9_-]{1,128}$/.test(editing.id) ||
      !editing.name.trim() ||
      editing.name.length > 80
    ) {
      notify("请填写有效 Voice ID 和 1–80 字中文别名。");
      return;
    }
    if (isNew && voices.some((v) => v.id === editing.id)) {
      notify("这个 Voice ID 已在资料库中。");
      return;
    }
    onChange(
      isNew
        ? [...voices, { ...editing, name: editing.name.trim() }]
        : voices.map((v) =>
            v.id === editing.id ? { ...editing, name: editing.name.trim() } : v,
          ),
    );
    setEditing(null);
  }
  function move(id: string, by: number) {
    const i = voices.findIndex((v) => v.id === id);
    if (i + by < 0 || i + by >= voices.length) return;
    const next = [...voices];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    onChange(next);
  }
  return (
    <div className="subpage">
      <div className="page-heading">
        <div>
          <h2>音色资料库</h2>
          <p>让每一个角色，都有自己的名字。</p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setIsNew(true);
            setEditing({ ...blank });
          }}
        >
          <Plus data-icon="inline-start" />
          添加音色
        </Button>
      </div>
      <div className="search-row">
        <label className="search">
          <Search />
          <Input
            aria-label="搜索音色"
            placeholder="搜索别名、ID 或标签"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <Button
          size="icon"
          variant={favorites ? "secondary" : "ghost"}
          aria-label="仅看收藏"
          aria-pressed={favorites}
          onClick={() => setFavorites(!favorites)}
        >
          <Star />
        </Button>
      </div>
      <Button
        variant="ghost"
        size="xs"
        disabled={importing || busy}
        onClick={() => void importVoices()}
      >
        {importing ? "正在读取账号音色…" : "从 Fish 账号导入音色"}
      </Button>
      <div className="voice-list">
        {filtered.map((v) => (
          <article
            className="voice-row"
            key={v.id}
            data-selected={selected === v.id}
          >
            <button
              className="voice-avatar"
              onClick={() => onSelect(v.id)}
              aria-label={`选择 ${v.name}`}
            >
              {v.name.slice(0, 1)}
            </button>
            <div className="voice-detail">
              <button
                className="text-button voice-name"
                onClick={() => onSelect(v.id)}
              >
                {v.name}
                {selected === v.id && <span className="selected-dot" />}
              </button>
              <p>
                {v.description || "Fish Audio"}
                {v.tags.length > 0 && ` · ${v.tags.join(" / ")}`}
              </p>
              <button
                className="voice-id text-button"
                title="复制原始 Voice ID"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(v.id)
                    .then(() => notify("Voice ID 已复制。"))
                    .catch(() => notify("无法复制，请在编辑音色中选中 ID。"))
                }
              >
                {v.id}
                <Copy />
              </button>
              <div className="voice-actions">
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy}
                  onClick={() => onPreview(v)}
                >
                  <Headphones data-icon="inline-start" />
                  试听
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`编辑 ${v.name}`}
                  onClick={() => {
                    setIsNew(false);
                    setEditing({ ...v });
                  }}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`上移 ${v.name}`}
                  disabled={voices[0]?.id === v.id}
                  onClick={() => move(v.id, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`下移 ${v.name}`}
                  disabled={voices.at(-1)?.id === v.id}
                  onClick={() => move(v.id, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`删除 ${v.name}`}
                  onClick={() => setRemoving(v)}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`收藏 ${v.name}`}
              aria-pressed={v.favorite}
              onClick={() =>
                onChange(
                  voices.map((w) =>
                    w.id === v.id ? { ...w, favorite: !w.favorite } : w,
                  ),
                )
              }
            >
              <Star fill={v.favorite ? "currentColor" : "none"} />
            </Button>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {voices.length ? "没有找到音色" : "添加你的第一个声音"}
            </EmptyTitle>
            <EmptyDescription>
              {voices.length
                ? "换个关键词，或关闭收藏筛选。"
                : "从 Fish Audio 复制原始 Voice ID，再为它起一个中文别名。试听会调用当前模型，结果自动缓存。"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isNew ? "添加音色" : "编辑音色"}</DialogTitle>
            <DialogDescription>
              中文别名仅用于本地显示。合成始终使用原始 ID。
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="voice-id">Voice ID</FieldLabel>
                <Input
                  id="voice-id"
                  readOnly={!isNew}
                  value={editing.id}
                  onChange={(e) =>
                    setEditing({ ...editing, id: e.target.value.trim() })
                  }
                  placeholder="粘贴 Fish Audio Voice ID"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="voice-name">中文别名</FieldLabel>
                <Input
                  id="voice-name"
                  value={editing.name}
                  maxLength={80}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                  placeholder="例如：猫娘·甜美"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="voice-description">描述</FieldLabel>
                <Input
                  id="voice-description"
                  value={editing.description}
                  onChange={(e) =>
                    setEditing({ ...editing, description: e.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="voice-tags">标签（逗号分隔）</FieldLabel>
                <Input
                  id="voice-tags"
                  value={editing.tags.join(",")}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      tags: e.target.value.split(/[,，]/),
                    })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="preview-text">试听短句</FieldLabel>
                <Input
                  id="preview-text"
                  value={editing.previewText}
                  onChange={(e) =>
                    setEditing({ ...editing, previewText: e.target.value })
                  }
                />
              </Field>
            </FieldGroup>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button onClick={commit}>保存音色</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!removing} onOpenChange={(v) => !v && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除「{removing?.name}」？</DialogTitle>
            <DialogDescription>
              只删除本地音色资料，生成历史和音频文件会保留。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                onChange(voices.filter((v) => v.id !== removing?.id));
                setRemoving(null);
              }}
            >
              删除音色
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
