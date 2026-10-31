use base64::{engine::general_purpose::STANDARD, Engine};
use regex::Regex;
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

static TAGS: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\[[^\]\r\n]*\]").unwrap());
pub fn clean_text(s: &str) -> String {
    TAGS.replace_all(s, "").trim().to_string()
}
fn comparable(s: &str) -> String {
    clean_text(s)
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

// Bytes are retained until a complete line arrives, including split UTF-8 and CRLF.
#[derive(Default)]
pub struct SseParser {
    line: Vec<u8>,
    data: Vec<String>,
    previous_cr: bool,
    started: bool,
    pub event: String,
}
impl SseParser {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<String>, String> {
        let mut events = Vec::new();
        for &b in bytes {
            if b == b'\n' && self.previous_cr {
                self.previous_cr = false;
                continue;
            }
            self.previous_cr = b == b'\r';
            if b == b'\r' || b == b'\n' {
                let mut line = String::from_utf8(std::mem::take(&mut self.line))
                    .map_err(|_| "SSE 响应不是有效 UTF-8。")?;
                if !self.started {
                    line = line.trim_start_matches('\u{feff}').to_string();
                    self.started = true;
                }
                if line.is_empty() {
                    if !self.data.is_empty() {
                        let payload = self.data.join("\n");
                        self.data.clear();
                        if self.event == "error" {
                            return Err("Fish 流返回错误事件；已停止，无自动重试。".into());
                        }
                        events.push(payload);
                    }
                    self.event.clear();
                } else if !line.starts_with(':') {
                    let (field, value) = line.split_once(':').unwrap_or((&line, ""));
                    let value = value.strip_prefix(' ').unwrap_or(value);
                    match field {
                        "data" => self.data.push(value.to_string()),
                        "event" => self.event = value.to_string(),
                        _ => {}
                    }
                }
            } else {
                self.line.push(b);
            }
            if self.line.len() + self.data.iter().map(String::len).sum::<usize>() > 16 * 1024 * 1024
            {
                return Err("SSE 事件过大。".into());
            }
        }
        Ok(events)
    }
    pub fn finish(&self) -> Result<(), String> {
        if !self.line.is_empty() || !self.data.is_empty() {
            Err("时间戳流意外截断，请重试；未保存不完整结果。".into())
        } else {
            Ok(())
        }
    }
}
#[derive(Clone, Deserialize)]
pub struct Segment {
    pub text: String,
    pub start: f64,
    pub end: f64,
}
#[derive(Deserialize)]
pub struct Alignment {
    pub segments: Vec<Segment>,
}
#[derive(Deserialize)]
pub struct StreamEvent {
    pub audio_base64: String,
    #[serde(default)]
    pub content: String,
    pub chunk_seq: u64,
    pub chunk_audio_offset_sec: f64,
    pub alignment: Option<Alignment>,
}
#[derive(Default)]
pub struct Collector {
    pub audio: Vec<u8>,
    snapshots: BTreeMap<u64, StreamEvent>,
    chunks: BTreeSet<u64>,
}
impl Collector {
    pub fn accept(&mut self, payload: &str) -> Result<(), String> {
        if payload == "[DONE]" {
            return Ok(());
        }
        let e: StreamEvent =
            serde_json::from_str(payload).map_err(|_| "无法解析 Fish 时间戳响应。")?;
        let audio = STANDARD
            .decode(&e.audio_base64)
            .map_err(|_| "收到无效的音频 Base64。")?;
        self.audio.extend(audio);
        self.chunks.insert(e.chunk_seq);
        if e.alignment.is_some() {
            self.snapshots.insert(e.chunk_seq, e);
        }
        Ok(())
    }
    pub fn srt(&self, original: &str, duration: f64) -> Result<String, String> {
        if self.chunks.is_empty() || self.chunks.iter().any(|k| !self.snapshots.contains_key(k)) {
            return Err("部分文本块缺少可靠对齐信息，仅保存音频与干净台词，未生成 SRT。".into());
        }
        let mut segments = Vec::new();
        let mut content = String::new();
        for e in self.snapshots.values() {
            content.push_str(&e.content);
            if !e.chunk_audio_offset_sec.is_finite() || e.chunk_audio_offset_sec < 0. {
                return Err("时间戳偏移无效，未生成 SRT。".into());
            }
            for s in &e.alignment.as_ref().unwrap().segments {
                segments.push(Segment {
                    text: clean_text(&s.text),
                    start: s.start + e.chunk_audio_offset_sec,
                    end: s.end + e.chunk_audio_offset_sec,
                });
            }
        }
        let expected = comparable(original);
        let aligned: String = segments.iter().map(|s| comparable(&s.text)).collect();
        if expected.is_empty()
            || aligned != expected
            || (!content.is_empty() && comparable(&content) != expected)
        {
            return Err("对齐文本未完整覆盖原台词（可能含数字规范化或缺失片段），仅保存音频与 TXT，未生成 SRT。".into());
        }
        build_srt(&segments, duration)
    }
}
fn join_text(a: &mut String, b: &str) {
    if a.chars().last().is_some_and(|c| c.is_ascii_alphanumeric())
        && b.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
    {
        a.push(' ');
    }
    a.push_str(b);
}
fn stamp(t: f64) -> String {
    let ms = (t * 1000.).round() as u64;
    format!(
        "{:02}:{:02}:{:02},{:03}",
        ms / 3600000,
        ms / 60000 % 60,
        ms / 1000 % 60,
        ms % 1000
    )
}
pub fn build_srt(segments: &[Segment], duration: f64) -> Result<String, String> {
    let mut cues: Vec<Segment> = Vec::new();
    let mut last_end = 0.;
    for s in segments.iter().filter(|s| !s.text.trim().is_empty()) {
        if !s.start.is_finite()
            || !s.end.is_finite()
            || s.start < 0.
            || s.end <= s.start
            || (s.start * 1000.).round() < (last_end * 1000_f64).round()
            || s.end > duration + 0.35
            || ((s.end - s.start) * 1000.).round() < 1.
        {
            return Err("对齐时间无效、重叠或超出音频，未生成 SRT。".into());
        }
        last_end = s.end;
        let merge = cues.last().is_some_and(|p| {
            !p.text
                .ends_with(['。', '！', '？', '.', '!', '?', '；', ';'])
                && s.start - p.end < 0.55
                && s.end - p.start <= 5.5
                && p.text.chars().count() + s.text.chars().count() <= 38
        });
        if merge {
            let p = cues.last_mut().unwrap();
            join_text(&mut p.text, &s.text);
            p.end = s.end;
        } else {
            cues.push(s.clone());
        }
    }
    if cues.is_empty() {
        return Err("没有可靠时间戳，未生成 SRT。".into());
    }
    Ok(cues
        .iter()
        .enumerate()
        .map(|(i, s)| {
            format!(
                "{}\n{} --> {}\n{}\n\n",
                i + 1,
                stamp(s.start),
                stamp(s.end),
                wrap(&s.text)
            )
        })
        .collect())
}
fn wrap(text: &str) -> String {
    // Only line wrapping: never invent sub-segment timings.
    if text.chars().count() <= 24 {
        return text.into();
    }
    let mut out = String::new();
    let mut n = 0;
    for c in text.chars() {
        if n == 24 {
            out.push('\n');
            n = 0;
        }
        out.push(c);
        n += 1;
    }
    out
}
