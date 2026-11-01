import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  ChevronDown,
  Headphones,
  SlidersHorizontal,
  FolderOpen,
  Sparkles,
  Square,
  LoaderCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";

import AdvancedSettings from "./AdvancedSettings";
import ScriptEditor from "./ScriptEditor";
import Player from "./Player";
import {
  models,
  type Options,
  type Workspace,
  type Voice,
  type VoiceRecord,
} from "@/types";

interface Props {
  data: Workspace;
  ready: boolean;
  busy: boolean;
  status: string;
  captionPreview: boolean;
  onCaptionPreview: (value: boolean) => void;
  filename: string;
  onFilename: (value: string) => void;
  result: VoiceRecord | null;
  notify: (message: string) => void;
  onDraft: (text: string) => void;
  onOption: (options: Partial<Options>) => void;
  onChooseVoice: (trigger: HTMLButtonElement) => void;
  onManageVoice: () => void;
  onPreview: (voice: Voice) => void;
  onChooseDirectory: () => void;
  onGenerate: () => void;
  onCancel: () => void;
  onPreset: (trigger: HTMLButtonElement | null) => void;
}

export default function ComposePanel(props: Props) {
  const {
    data,
    ready,
    busy,
    status,
    captionPreview,
    onCaptionPreview,
    filename,
    onFilename,
    result,
    notify,
    onDraft,
    onOption,
    onChooseVoice,
    onManageVoice,
    onPreview,
    onChooseDirectory,
    onGenerate,
    onCancel,
    onPreset,
  } = props;
  const [advanced, setAdvanced] = useState(false);
  const advancedTrigger = useRef<HTMLButtonElement>(null);
  const transferringFocus = useRef(false);
  const resultRegion = useRef<HTMLDivElement>(null);
  const resultId = result?.id;
  useEffect(() => {
    if (resultId) resultRegion.current?.scrollIntoView({ block: "nearest" });
  }, [resultId]);
  const o = data.options;
  const selected = data.voices.find((voice) => voice.id === o.voiceId);
  return (
    <div className="compose">
      <div className="compose-body">
        <section className="voice-section" aria-label="配音音色">
          <div className="current-voice">
            <button
              className="voice-select"
              aria-label="选择配音音色"
              onClick={(event) => onChooseVoice(event.currentTarget)}
            >
              <span className="voice-avatar">
                {selected?.name.slice(0, 1) || <AudioLines />}
              </span>
              <span>
                <strong>{selected?.name || "选择一个声音"}</strong>
                <small title={selected?.description || selected?.id}>
                  {selected?.description ||
                    (selected
                      ? "Fish Audio · " + selected.id.slice(0, 12) + "…"
                      : "添加 Voice ID，给声音起个名字")}
                </small>
              </span>
              <ChevronDown />
            </button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="试听当前音色"
              title="试听当前音色"
              disabled={!selected || busy}
              onClick={() => selected && onPreview(selected)}
            >
              <Headphones />
            </Button>
          </div>
          <Button
            className="manage-voices"
            variant="ghost"
            size="xs"
            onClick={onManageVoice}
          >
            管理音色
          </Button>
        </section>
        <ScriptEditor
          text={data.draft}
          onChange={onDraft}
          preview={captionPreview}
          onPreview={onCaptionPreview}
        />
        <section className="parameters-section" aria-label="生成参数">
          <div className="section-heading">
            <span>生成参数</span>
            <Button
              ref={advancedTrigger}
              variant="ghost"
              size="xs"
              onClick={() => {
                transferringFocus.current = false;
                setAdvanced(true);
              }}
            >
              <SlidersHorizontal data-icon="inline-start" />
              高级
            </Button>
          </div>
          <QuickControls o={o} onOption={onOption} />
          {o.model !== "s2.1-pro-free" && (
            <p className="paid-note">已选付费模型，每次调用前需确认计费。</p>
          )}
        </section>
        {data.draft.length > 5000 && (
          <p className="muted long-text-note">
            长文本将整篇发送一次，服务端可内部分块。实际限额以 Fish
            账户为准；本应用上限 50,000 字。
          </p>
        )}
        {result && (
          <div className="result-region" ref={resultRegion}>
            <Player key={result.id} record={result} notify={notify} />
          </div>
        )}
      </div>
      <GenerationControls
        o={o}
        ready={ready}
        busy={busy}
        status={status}
        onChooseDirectory={onChooseDirectory}
        onOption={onOption}
        onCancel={onCancel}
        onGenerate={onGenerate}
      />
      <AdvancedSettings
        open={advanced}
        onOpenChange={setAdvanced}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!transferringFocus.current) advancedTrigger.current?.focus();
        }}
        data={data}
        filename={filename}
        onFilename={onFilename}
        onOption={onOption}
        onSavePreset={() => {
          transferringFocus.current = true;
          setAdvanced(false);
          onPreset(advancedTrigger.current);
        }}
      />
    </div>
  );
}

function QuickControls({
  o,
  onOption,
}: {
  o: Options;
  onOption: (options: Partial<Options>) => void;
}) {
  return (
    <FieldGroup className="quick-controls">
      <Field>
        <FieldLabel htmlFor="model">模型</FieldLabel>
        <select
          id="model"
          aria-label="模型"
          value={o.model}
          onChange={(event) => onOption({ model: event.target.value })}
        >
          {models.map((model) => (
            <option key={model} value={model}>
              {model === "s2.1-pro-free"
                ? "S2.1 Pro · 免费"
                : model + " · 付费"}
            </option>
          ))}
        </select>
      </Field>
      <Field>
        <FieldLabel htmlFor="speed">
          语速 <output>{o.speed.toFixed(1)}×</output>
        </FieldLabel>
        <input
          id="speed"
          aria-label="语速"
          type="range"
          min="0.5"
          max="2"
          step="0.1"
          value={o.speed}
          onChange={(event) => onOption({ speed: Number(event.target.value) })}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="format">格式</FieldLabel>
        <select
          id="format"
          aria-label="音频格式"
          value={o.format}
          onChange={(event) =>
            onOption({ format: event.target.value as Options["format"] })
          }
        >
          <option value="mp3">MP3</option>
          <option value="wav">WAV</option>
          <option value="opus">Opus</option>
        </select>
      </Field>
    </FieldGroup>
  );
}

function GenerationControls({
  o,
  ready,
  busy,
  status,
  onChooseDirectory,
  onOption,
  onCancel,
  onGenerate,
}: {
  o: Options;
  ready: boolean;
  busy: boolean;
  status: string;
  onChooseDirectory: () => void;
  onOption: (options: Partial<Options>) => void;
  onCancel: () => void;
  onGenerate: () => void;
}) {
  return (
    <div className="generate-area">
      <div className="directory-row">
        <FolderOpen />
        <span>保存到</span>
        <button
          className="text-button"
          title={o.outputDir || "选择配音保存目录"}
          onClick={onChooseDirectory}
        >
          {o.outputDir?.split("/").pop() || "选择保存目录"}
        </button>
        <ChevronDown />
      </div>
      <div className="subtitle-toggle">
        <label htmlFor="subtitles">
          同时生成字幕 <small>音频 + SRT + 干净台词</small>
        </label>
        <Switch
          id="subtitles"
          checked={o.subtitles}
          onCheckedChange={(subtitles) => onOption({ subtitles })}
        />
      </div>
      <Button
        className="generate-button"
        variant={busy ? "secondary" : "default"}
        disabled={!ready}
        onClick={busy ? onCancel : onGenerate}
      >
        {busy ? (
          <Square data-icon="inline-start" />
        ) : (
          <Sparkles data-icon="inline-start" />
        )}
        {busy ? "取消合成" : "生成配音"}
        <kbd>⌘ ↵</kbd>
      </Button>
      <div className="generation-status" aria-live="polite">
        {busy && <LoaderCircle className="status-spinner" />}
        {busy
          ? status
          : o.subtitles
            ? "使用同一次合成的真实时间戳，不额外生成音频。"
            : "仅生成音频和干净台词。"}
      </div>
    </div>
  );
}
