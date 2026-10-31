use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const MODELS: &[&str] = &["s2.1-pro-free", "s2.1-pro", "s2-pro", "s1", "drama-3"];

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Voice {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub description: String,
    pub favorite: bool,
    pub tags: Vec<String>,
    pub last_used: Option<String>,
    pub preview_text: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Options {
    pub voice_id: String,
    pub model: String,
    pub speed: f64,
    pub format: String,
    pub subtitles: bool,
    pub normalize: bool,
    pub latency: String,
    pub temperature: f64,
    pub top_p: f64,
    pub output_dir: String,
    pub name_template: String,
}
impl Default for Options {
    fn default() -> Self {
        Self {
            voice_id: String::new(),
            model: "s2.1-pro-free".into(),
            speed: 1.,
            format: "mp3".into(),
            subtitles: true,
            normalize: true,
            latency: "normal".into(),
            temperature: 0.7,
            top_p: 0.7,
            output_dir: String::new(),
            name_template: "{date}_{voice}_{title}".into(),
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Preset {
    pub name: String,
    pub options: Options,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub text: String,
    pub voice_name: String,
    pub voice_id: String,
    pub model: String,
    pub created_at: String,
    pub audio_path: String,
    pub srt_path: Option<String>,
    pub txt_path: String,
    pub format: String,
    pub duration: f64,
    pub warning: Option<String>,
}
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AppData {
    pub draft: String,
    pub voices: Vec<Voice>,
    pub options: Options,
    pub history: Vec<Record>,
    pub presets: Vec<Preset>,
    pub proxy: String,
    pub shortcut: String,
}
impl AppData {
    pub fn fresh(output_dir: String) -> Self {
        Self {
            options: Options {
                output_dir,
                ..Options::default()
            },
            shortcut: "Alt+Super+KeyG".into(),
            ..Self::default()
        }
    }
}
pub fn request_body(text: &str, o: &Options, voices: &[Voice]) -> Result<Value, String> {
    let voice = voices
        .iter()
        .find(|v| v.id == o.voice_id && v.provider == "fish")
        .ok_or("请先添加并选择 Fish Audio 音色（使用原始 Voice ID）。")?;
    validate_voice(voice)?;
    if text.trim().is_empty() {
        return Err("请输入台词。".into());
    }
    if text.chars().count() > 50000 {
        return Err("单次台词超过本应用的 50,000 字安全上限，请缩短后重试；不会自动拆单。".into());
    }
    if !MODELS.contains(&o.model.as_str()) {
        return Err("无效模型，已阻止可能的付费回退。".into());
    }
    if !["mp3", "wav", "opus"].contains(&o.format.as_str()) {
        return Err("不支持的音频格式。".into());
    }
    if !["normal", "balanced", "low"].contains(&o.latency.as_str())
        || !(0.5..=2.).contains(&o.speed)
        || !(0.0..=1.).contains(&o.temperature)
        || !(0.0..=1.).contains(&o.top_p)
    {
        return Err("合成参数超出允许范围。".into());
    }
    Ok(
        json!({"text":text,"reference_id":voice.id,"format":o.format,"prosody":{"speed":o.speed},"normalize":o.normalize,"latency":o.latency,"temperature":o.temperature,"top_p":o.top_p}),
    )
}
pub fn validate_voice(v: &Voice) -> Result<(), String> {
    if v.id.is_empty()
        || v.id.len() > 128
        || !v
            .id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Voice ID 只允许字母、数字、连字符和下划线。".into());
    }
    if v.name.trim().is_empty() || v.name.chars().count() > 80 {
        return Err("请填写 1–80 字的音色别名。".into());
    }
    Ok(())
}
