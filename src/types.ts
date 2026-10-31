export interface Voice {
  id: string;
  name: string;
  provider: string;
  description: string;
  favorite: boolean;
  tags: string[];
  lastUsed: string | null;
  previewText: string;
}
export interface Options {
  voiceId: string;
  model: string;
  speed: number;
  format: "mp3" | "wav" | "opus";
  subtitles: boolean;
  normalize: boolean;
  latency: string;
  temperature: number;
  topP: number;
  outputDir: string;
  nameTemplate: string;
}
export interface VoiceRecord {
  id: string;
  text: string;
  voiceName: string;
  voiceId: string;
  model: string;
  createdAt: string;
  audioPath: string;
  srtPath: string | null;
  txtPath: string;
  format: string;
  duration: number;
  warning: string | null;
}
export interface Workspace {
  draft: string;
  voices: Voice[];
  options: Options;
  history: VoiceRecord[];
  presets: { name: string; options: Options }[];
  proxy: string;
  shortcut: string;
}
export const defaultOptions: Options = {
  voiceId: "",
  model: "s2.1-pro-free",
  speed: 1,
  format: "mp3",
  subtitles: true,
  normalize: true,
  latency: "normal",
  temperature: 0.7,
  topP: 0.7,
  outputDir: "",
  nameTemplate: "{date}_{voice}_{title}",
};
export const emptyWorkspace: Workspace = {
  draft: "",
  voices: [],
  options: defaultOptions,
  history: [],
  presets: [],
  proxy: "",
  shortcut: "Alt+Super+KeyG",
};
export const models = ["s2.1-pro-free", "s2.1-pro", "s2-pro", "s1", "drama-3"];
