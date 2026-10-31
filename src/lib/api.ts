import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Workspace, VoiceRecord, Options } from "@/types";
import { emptyWorkspace } from "@/types";
export const desktop = isTauri();
export const loadWorkspace = () =>
  desktop
    ? invoke<Workspace>("load_data")
    : Promise.resolve(structuredClone(emptyWorkspace));
export const persist = (data: Workspace) =>
  desktop ? invoke("save_data", { data }) : Promise.resolve();
export const call = <T = void>(
  command: string,
  args?: Record<string, unknown>,
) =>
  desktop
    ? invoke<T>(command, args)
    : Promise.reject(new Error("请在 VoiceDock 桌面应用中使用此功能。"));
export async function chooseDirectory() {
  if (!desktop) throw new Error("请在桌面应用中选择保存目录。");
  await call("set_interacting", { value: true });
  try {
    return await open({
      directory: true,
      multiple: false,
      title: "选择配音保存目录",
    });
  } finally {
    await call("set_interacting", { value: false });
  }
}
export const synthesize = (
  text: string,
  options: Options,
  filename: string,
  preview: boolean,
  paidConfirmed: boolean,
) =>
  call<VoiceRecord>("generate", {
    text,
    options,
    filename,
    preview,
    paidConfirmed,
  });
export async function audioBlob(path: string, format: string) {
  const bytes = await call<ArrayBuffer>("read_audio", { path });
  return new Blob([bytes], {
    type:
      format === "mp3"
        ? "audio/mpeg"
        : format === "wav"
          ? "audio/wav"
          : "audio/ogg",
  });
}
