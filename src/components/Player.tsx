import { useEffect, useRef, useState } from "react";
import { Pause, Play, FolderOpen, Download, FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { audioBlob, call, chooseDirectory } from "@/lib/api";
import { durationLabel } from "@/lib/text";
import type { VoiceRecord } from "@/types";
export default function Player({
  record,
  notify,
}: {
  record: VoiceRecord;
  notify: (s: string) => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  useEffect(() => {
    let alive = true;
    let resource = "";
    void audioBlob(record.audioPath, record.format)
      .then((blob) => {
        if (!alive) return;
        resource = URL.createObjectURL(blob);
        setUrl(resource);
      })
      .catch((e) => notify(String(e)));
    return () => {
      alive = false;
      if (resource) URL.revokeObjectURL(resource);
    };
  }, [record.audioPath, record.format, notify]);
  async function play() {
    try {
      if (playing) audio.current?.pause();
      else await audio.current?.play();
    } catch {
      notify("无法播放此音频，请在 Finder 中打开确认。");
    }
  }
  async function exportAgain() {
    try {
      const dir = await chooseDirectory();
      if (!dir) return;
      const name =
        record.audioPath
          .split("/")
          .pop()
          ?.replace(/\.[^.]+$/, "") || "配音";
      const path = await call<string>("reexport", {
        id: record.id,
        directory: dir,
        filename: name,
      });
      notify(`已导出：${path}`);
    } catch (e) {
      notify(String(e));
    }
  }
  return (
    <div className="player">
      <div className="player-top">
        <span>
          <FileCheck2 />
          {record.srtPath
            ? "音频与字幕已保存"
            : record.txtPath
              ? "音频已保存"
              : "试听已缓存"}
        </span>
        <span>{record.format.toUpperCase()}</span>
      </div>
      <div className="player-file" title={record.audioPath}>
        {record.audioPath.split("/").pop()}
      </div>
      <div className="playback">
        <Button
          variant="secondary"
          size="icon"
          aria-label={playing ? "暂停" : "播放"}
          title={url ? (playing ? "暂停" : "播放") : "正在载入音频…"}
          disabled={!url}
          onClick={() => void play()}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <div className="timeline">
          <label className="sr-only" htmlFor={`seek-${record.id}`}>
            播放进度
          </label>
          <input
            id={`seek-${record.id}`}
            type="range"
            aria-label="播放进度"
            disabled={!url}
            min={0}
            max={record.duration}
            step={0.01}
            value={Math.min(time, record.duration)}
            onChange={(e) => {
              const t = Number(e.target.value);
              if (audio.current) audio.current.currentTime = t;
              setTime(t);
            }}
          />
          <div>
            <span>{durationLabel(time)}</span>
            <span>{durationLabel(record.duration)}</span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="在 Finder 中显示"
          title="在 Finder 中显示"
          onClick={() =>
            void call("reveal_audio", { path: record.audioPath }).catch((e) =>
              notify(String(e)),
            )
          }
        >
          <FolderOpen />
        </Button>
        {record.txtPath && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="再次导出"
            title="再次导出"
            onClick={() => void exportAgain()}
          >
            <Download />
          </Button>
        )}
      </div>
      <audio
        ref={audio}
        src={url || undefined}
        onTimeUpdate={() => setTime(audio.current?.currentTime || 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
}
