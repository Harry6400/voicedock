import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Options, Workspace } from "@/types";

export default function AdvancedSettings({
  open,
  onOpenChange,
  onCloseAutoFocus,
  data,
  filename,
  onFilename,
  onOption,
  onSavePreset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (event: Event) => void;
  data: Workspace;
  filename: string;
  onFilename: (value: string) => void;
  onOption: (options: Partial<Options>) => void;
  onSavePreset: () => void;
}) {
  const o = data.options;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="advanced-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>高级参数</DialogTitle>
          <DialogDescription>
            常用参数保留在主面板，这里调整文件名、表现力和预设。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="filename">本次文件名</FieldLabel>
            <Input
              id="filename"
              value={filename}
              onChange={(event) => onFilename(event.target.value)}
              placeholder="留空按命名规则保存"
              autoComplete="off"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="latency">延迟模式</FieldLabel>
            <select
              id="latency"
              aria-label="延迟模式"
              value={o.latency}
              onChange={(event) => onOption({ latency: event.target.value })}
            >
              <option value="normal">正常 · 优先质量</option>
              <option value="balanced">平衡</option>
              <option value="low">低延迟</option>
            </select>
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="normalize">规范化数字和单位</FieldLabel>
            <Switch
              id="normalize"
              checked={o.normalize}
              onCheckedChange={(normalize) => onOption({ normalize })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="temperature">
              表现力 <output>{o.temperature.toFixed(2)}</output>
            </FieldLabel>
            <input
              id="temperature"
              aria-label="表现力"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={o.temperature}
              onChange={(event) =>
                onOption({ temperature: Number(event.target.value) })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="top-p">
              多样性 <output>{o.topP.toFixed(2)}</output>
            </FieldLabel>
            <input
              id="top-p"
              aria-label="多样性"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={o.topP}
              onChange={(event) =>
                onOption({ topP: Number(event.target.value) })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="presets">配音预设</FieldLabel>
            <select
              id="presets"
              aria-label="配音预设"
              defaultValue=""
              onChange={(event) => {
                const preset = data.presets.find(
                  (item) => item.name === event.target.value,
                );
                if (preset) onOption(preset.options);
                event.target.value = "";
              }}
            >
              <option value="">载入预设…</option>
              {data.presets.map((preset) => (
                <option key={preset.name}>{preset.name}</option>
              ))}
            </select>
          </Field>
          <Button variant="outline" size="sm" onClick={onSavePreset}>
            <Plus data-icon="inline-start" />
            将当前配置保存为预设
          </Button>
        </FieldGroup>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>完成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
