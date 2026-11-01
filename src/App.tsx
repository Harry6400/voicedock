import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { listen } from "@tauri-apps/api/event";
import {
  AudioLines,
  Pin,
  Settings2,
  History,
  Minus,
  Headphones,
  Plus,
  X,
  Search,
  Star,
  Check,
  ArrowLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import ComposePanel from "@/components/ComposePanel";
import HistoryView from "@/components/HistoryView";
import VoiceLibrary from "@/components/VoiceLibrary";
import Settings from "@/components/Settings";
import {
  call,
  chooseDirectory,
  desktop,
  loadWorkspace,
  persist,
  synthesize,
} from "@/lib/api";
import { emptyWorkspace } from "@/types";
import type { Options, Voice, VoiceRecord, Workspace } from "@/types";
type View = "compose" | "voices" | "history" | "settings";
interface Job {
  text: string;
  options: Options;
  preview: boolean;
}
export default function App() {
  const [data, setData] = useState<Workspace>(emptyWorkspace);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("compose");
  const [hasKey, setHasKey] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(true);
  const [captionPreview, setCaptionPreview] = useState(false);
  const [filename, setFilename] = useState("");
  const [result, setResult] = useState<VoiceRecord | null>(null);
  const [chooser, setChooser] = useState(false);
  const [search, setSearch] = useState("");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [paid, setPaid] = useState<Job | null>(null);
  const [presetDialog, setPresetDialog] = useState(false);
  const [presetName, setPresetName] = useState("");
  const notify = useCallback(
    (s: string) => setMessage(s.replace(/^Error: /, "")),
    [],
  );
  const dialogReturnFocus = useRef<HTMLElement | null>(null);
  const dataRef = useRef(data);
  const busyRef = useRef(false);
  const generationRef = useRef<() => void>(() => {});
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  const o = data.options;
  const matchingVoices = data.voices.filter(
    (voice) =>
      (!onlyFavorites || voice.favorite) &&
      `${voice.name} ${voice.id} ${voice.tags}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const update = useCallback((patch: Partial<Workspace>) => {
    setSaved(false);
    setData((d) => ({ ...d, ...patch }));
  }, []);
  const option = (patch: Partial<Options>) =>
    update({ options: { ...o, ...patch } });
  useEffect(() => {
    let active = true;
    void Promise.all([
      loadWorkspace(),
      desktop ? call<boolean>("key_status") : Promise.resolve(false),
    ])
      .then(([d, k]) => {
        if (active) {
          setData(d);
          setHasKey(k);
          setReady(true);
        }
      })
      .catch((e) => notify(String(e)));
    return () => {
      active = false;
    };
  }, [notify]);
  useEffect(() => {
    if (!ready || !desktop) return;
    void call<boolean>("shortcut_status")
      .then((registered) => {
        if (!registered)
          notify(
            "全局快捷键未能注册，请在设置中改用其他组合；仍可从菜单栏打开。",
          );
      })
      .catch((e) => notify(String(e)));
  }, [ready, notify]);
  useEffect(() => {
    if (!ready || saved) return;
    const timer = setTimeout(() => {
      void persist(data)
        .then(() => {
          if (dataRef.current === data) setSaved(true);
        })
        .catch((e) => notify(`草稿或配置保存失败：${String(e)}`));
    }, 350);
    return () => clearTimeout(timer);
  }, [data, ready, saved, notify]);
  useEffect(() => {
    if (!desktop) return;
    const p = [
      listen<string>("generation-status", (e) => setStatus(e.payload)),
      listen("open-settings", () => setView("settings")),
    ];
    return () => {
      for (const item of p) void item.then((unlisten) => unlisten());
    };
  }, []);
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (
          e.defaultPrevented ||
          document.querySelector('[role="dialog"][data-state="open"]') ||
          chooser ||
          paid ||
          presetDialog
        )
          return;
        if (view !== "compose") {
          setView("compose");
          return;
        }
        void call("hide_panel").catch((e) => notify(String(e)));
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        generationRef.current();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        setView("settings");
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [view, chooser, paid, presetDialog, notify]);
  async function execute(job: Job, confirmed = false) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    setStatus("准备合成…");
    try {
      await persist(dataRef.current);
      const r = await synthesize(
        job.text,
        job.options,
        filename,
        job.preview,
        confirmed,
      );
      setResult(r);
      const fresh = await loadWorkspace();
      setData((d) => ({ ...d, history: fresh.history, voices: fresh.voices }));
      notify(
        r.warning ||
          (job.preview
            ? "试听已缓存，重复试听相同参数不会重新调用。"
            : "已保存音频" + (r.srtPath ? "、SRT 字幕" : "") + "与干净台词。"),
      );
    } catch (e) {
      notify(String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
      setStatus("");
    }
  }
  function request(job: Job) {
    if (busyRef.current) return;
    if (!desktop) {
      notify("浏览器用于界面预览。请运行 VoiceDock 桌面应用进行合成。");
      return;
    }
    if (!job.text.trim()) {
      notify("先写一段台词，再生成声音。");
      return;
    }
    if (!job.options.voiceId) {
      notify("先添加并选择一个音色。");
      setView("voices");
      return;
    }
    if (!hasKey) {
      notify("先在设置中保存 Fish Audio API Key。");
      setView("settings");
      return;
    }
    if (job.options.model !== "s2.1-pro-free") {
      dialogReturnFocus.current = document.activeElement as HTMLElement | null;
      setPaid(job);
      return;
    }
    void execute(job);
  }
  function generate() {
    request({ text: data.draft, options: o, preview: false });
  }
  useEffect(() => {
    generationRef.current = generate;
  });
  function preview(v: Voice) {
    request({
      text: v.previewText.trim() || "你好，欢迎来到我的声音工作台。",
      options: { ...o, voiceId: v.id },
      preview: true,
    });
  }
  async function pin() {
    if (pinning) return;
    setPinning(true);
    try {
      await call("pin_panel", { value: !pinned });
      setPinned((value) => !value);
    } catch (e) {
      notify(String(e));
    } finally {
      setPinning(false);
    }
  }
  async function choose() {
    try {
      const directory = await chooseDirectory();
      if (directory) option({ outputDir: directory });
    } catch (e) {
      notify(String(e));
    }
  }
  function voicesChange(voices: Voice[]) {
    update({
      voices,
      options: {
        ...o,
        voiceId: voices.some((v) => v.id === o.voiceId)
          ? o.voiceId
          : voices[0]?.id || "",
      },
    });
  }
  return (
    <main className="app-shell">
      <header className="app-header" data-tauri-drag-region>
        <div className="brand" data-tauri-drag-region>
          <span className="brand-mark">
            <AudioLines />
          </span>
          <div data-tauri-drag-region>
            <h1 data-tauri-drag-region>VoiceDock</h1>
            <span className="provider-status">
              <span className={hasKey ? "status-dot saved" : "status-dot"} />
              Fish Audio{" "}
              <span className="muted">
                / {hasKey ? "Key 已保存" : "待配置"}
              </span>
            </span>
          </div>
        </div>
        <div className="header-actions">
          <Button
            variant={pinned ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label={pinned ? "取消置顶" : "固定在桌面"}
            title="固定在桌面"
            aria-pressed={pinned}
            disabled={pinning}
            onClick={() => void pin()}
          >
            <Pin />
          </Button>
          <Button
            variant={view === "history" ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label="生成历史"
            title="生成历史"
            onClick={() => setView(view === "history" ? "compose" : "history")}
          >
            <History />
          </Button>
          <Button
            variant={view === "settings" ? "secondary" : "ghost"}
            size="icon-sm"
            aria-label="设置"
            title="设置 ⌘,"
            onClick={() =>
              setView(view === "settings" ? "compose" : "settings")
            }
          >
            <Settings2 />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="收起面板"
            onClick={() =>
              void call("hide_panel").catch((e) => notify(String(e)))
            }
          >
            <Minus />
          </Button>
        </div>
      </header>
      {!desktop && (
        <div className="browser-note">
          界面预览 · 合成与文件操作请使用桌面应用
        </div>
      )}
      {message && (
        <Alert className="message" role="status">
          <AlertDescription>{message}</AlertDescription>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="关闭提示"
            onClick={() => setMessage("")}
          >
            <X />
          </Button>
        </Alert>
      )}
      {view !== "compose" && (
        <div className="back-row">
          <Button variant="ghost" size="sm" onClick={() => setView("compose")}>
            <ArrowLeft data-icon="inline-start" />
            返回配音
          </Button>
        </div>
      )}
      <div
        className={
          view === "compose"
            ? "workspace-scroll workspace-compose"
            : "workspace-scroll"
        }
      >
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={view}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.16 }}
            className={
              view === "compose" ? "view-content compose-view" : "view-content"
            }
          >
            {view === "compose" && (
              <ComposePanel
                data={data}
                ready={ready}
                busy={busy}
                status={status}
                captionPreview={captionPreview}
                onCaptionPreview={setCaptionPreview}
                filename={filename}
                onFilename={setFilename}
                result={result}
                notify={notify}
                onDraft={(draft) => update({ draft })}
                onOption={option}
                onChooseVoice={(trigger) => {
                  dialogReturnFocus.current = trigger;
                  setSearch("");
                  setChooser(true);
                }}
                onManageVoice={() => setView("voices")}
                onPreview={preview}
                onChooseDirectory={() => void choose()}
                onGenerate={generate}
                onCancel={() =>
                  void call("cancel_generation").catch((e) => notify(String(e)))
                }
                onPreset={(trigger) => {
                  dialogReturnFocus.current = trigger;
                  setPresetDialog(true);
                }}
              />
            )}
            {view === "voices" && (
              <VoiceLibrary
                voices={data.voices}
                selected={o.voiceId}
                onChange={voicesChange}
                onSelect={(id) => {
                  option({ voiceId: id });
                  setView("compose");
                }}
                onPreview={preview}
                notify={notify}
                busy={busy}
              />
            )}
            {view === "settings" && (
              <Settings
                data={data}
                hasKey={hasKey}
                onKey={setHasKey}
                onSaved={(d) => {
                  setData(d);
                  setSaved(true);
                }}
                notify={notify}
              />
            )}
            {view === "history" && (
              <HistoryView
                history={data.history}
                result={result}
                onResult={setResult}
                onLoad={(draft) => {
                  update({ draft });
                  setView("compose");
                }}
                onCompose={() => setView("compose")}
                notify={notify}
              />
            )}
          </m.div>
        </AnimatePresence>
      </div>
      <footer className="app-footer">
        <span>
          {pinned ? "已固定 · 拖动标题可移动" : "菜单栏待命"}
          <span className="footer-dot">·</span>
          {saved ? "草稿已保存" : "正在保存…"}
        </span>
        <span>⌥ ⌘ G</span>
      </footer>
      <Dialog open={chooser} onOpenChange={setChooser}>
        <DialogContent
          className="voice-chooser"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            dialogReturnFocus.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>选择声音</DialogTitle>
            <DialogDescription>
              搜索别名、标签或 Voice ID，选择后返回台词编辑。
            </DialogDescription>
          </DialogHeader>
          <div className="search-row">
            <label className="search">
              <Search />
              <Input
                aria-label="搜索音色选择器"
                placeholder="搜索音色、标签或 ID"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <Button
              variant={onlyFavorites ? "secondary" : "ghost"}
              size="icon"
              aria-label="仅显示收藏"
              aria-pressed={onlyFavorites}
              onClick={() => setOnlyFavorites(!onlyFavorites)}
            >
              <Star />
            </Button>
          </div>
          <div className="chooser-list">
            {!matchingVoices.length && (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>
                    {data.voices.length ? "没有找到音色" : "还没有添加音色"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {data.voices.length
                      ? "换个关键词，或关闭收藏筛选。"
                      : "添加 Fish Audio Voice ID，为它起一个中文别名。"}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {matchingVoices.map((v) => (
              <div className="chooser-row" key={v.id}>
                <button
                  onClick={() => {
                    option({ voiceId: v.id });
                    setChooser(false);
                  }}
                >
                  <span className="voice-avatar">{v.name.slice(0, 1)}</span>
                  <span>
                    <strong>{v.name}</strong>
                    <small>{v.id}</small>
                  </span>
                  {v.id === o.voiceId && <Check />}
                </button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`试听 ${v.name}`}
                  disabled={busy}
                  onClick={() => preview(v)}
                >
                  <Headphones />
                </Button>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setChooser(false);
              setView("voices");
            }}
          >
            <Plus data-icon="inline-start" />
            管理与添加音色
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={!!paid} onOpenChange={(v) => !v && setPaid(null)}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            dialogReturnFocus.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>确认调用付费模型</DialogTitle>
            <DialogDescription>
              本次将使用 {paid?.options.model} 调用 Fish Audio，可能产生费用。
              {paid?.preview
                ? "如已有相同试听缓存，将直接使用缓存。"
                : "台词将整篇发送一次。"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaid(null)}>
              取消
            </Button>
            <Button
              onClick={() => {
                if (paid) {
                  const job = paid;
                  setPaid(null);
                  void execute(job, true);
                }
              }}
            >
              确认本次调用
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={presetDialog} onOpenChange={setPresetDialog}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            dialogReturnFocus.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>保存配音预设</DialogTitle>
            <DialogDescription>
              记录当前音色、模型、语速、格式和保存目录。同名预设将被替换。
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="preset-name">预设名称</FieldLabel>
            <Input
              id="preset-name"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="例如：视频开场旁白"
            />
          </Field>
          <DialogFooter>
            <Button
              disabled={!presetName.trim()}
              onClick={() => {
                update({
                  presets: [
                    ...data.presets.filter((p) => p.name !== presetName.trim()),
                    { name: presetName.trim(), options: { ...o } },
                  ],
                });
                setPresetDialog(false);
                setPresetName("");
              }}
            >
              保存预设
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
