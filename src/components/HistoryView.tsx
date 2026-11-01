import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
  EmptyContent,
} from "@/components/ui/empty";
import Player from "./Player";
import { cleanText, durationLabel } from "@/lib/text";
import type { VoiceRecord } from "@/types";

export default function HistoryView({
  history,
  result,
  onResult,
  onLoad,
  onCompose,
  notify,
}: {
  history: VoiceRecord[];
  result: VoiceRecord | null;
  onResult: (record: VoiceRecord | null) => void;
  onLoad: (text: string) => void;
  onCompose: () => void;
  notify: (message: string) => void;
}) {
  return (
    <div className="subpage history-page">
      <div className="page-heading">
        <div>
          <h2>生成历史</h2>
          <p>最近 {history.length} 次生成，可载入台词、试听或再次导出。</p>
        </div>
      </div>
      {!history.length && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <History />
            </EmptyMedia>
            <EmptyTitle>还没有生成记录</EmptyTitle>
            <EmptyDescription>
              生成后的音频、字幕路径与原始台词会保存在这里。
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" onClick={onCompose}>
              开始配音
            </Button>
          </EmptyContent>
        </Empty>
      )}
      <div className="history-list">
        {history.map((record) => (
          <article className="history-row" key={record.id}>
            <div className="history-meta">
              <strong>{record.voiceName}</strong>
              <time dateTime={record.createdAt}>
                {new Date(record.createdAt).toLocaleString("zh-CN", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
            <p>{cleanText(record.text).slice(0, 110)}</p>
            <div className="history-details">
              <span>
                {record.model} · {durationLabel(record.duration)}
              </span>
              <Badge variant="outline">{record.format.toUpperCase()}</Badge>
              {record.srtPath && <Badge variant="secondary">SRT</Badge>}
            </div>
            <div className="history-actions">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onLoad(record.text)}
              >
                载入台词
              </Button>
              <Button
                variant={result?.id === record.id ? "secondary" : "outline"}
                size="sm"
                aria-expanded={result?.id === record.id}
                onClick={() =>
                  onResult(result?.id === record.id ? null : record)
                }
              >
                {result?.id === record.id ? "收起播放器" : "播放 / 导出"}
              </Button>
            </div>
            {result?.id === record.id && (
              <Player record={record} notify={notify} />
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
