use std::{
    fs,
    io::{Cursor, Write},
    path::{Path, PathBuf},
};
use symphonia::core::{
    codecs::DecoderOptions, formats::FormatOptions, io::MediaSourceStream, meta::MetadataOptions,
    probe::Hint,
};
use tempfile::NamedTempFile;

pub fn validate_audio(bytes: &[u8], format: &str) -> Result<f64, String> {
    if bytes.len() < 44 {
        return Err("返回音频为空或已损坏。".into());
    }
    if format == "opus" {
        return validate_opus(bytes);
    }
    let magic = match format {
        "wav" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WAVE"),
        "mp3" => bytes.starts_with(b"ID3") || (bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0),
        _ => false,
    };
    if !magic {
        return Err("音频内容与所选格式不符，已拒绝保存。".into());
    }
    if format == "wav" {
        let declared = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
        if declared + 8 != bytes.len() {
            return Err("WAV 文件长度不完整，已拒绝保存。".into());
        }
    }
    let source = MediaSourceStream::new(Box::new(Cursor::new(bytes.to_vec())), Default::default());
    let mut hint = Hint::new();
    hint.with_extension(format);
    let mut reader = symphonia::default::get_probe()
        .format(
            &hint,
            source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|_| "无法识别音频容器。")?
        .format;
    let track = reader.default_track().ok_or("音频没有可播放轨道。")?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|_| "无法解码返回音频。")?;
    let mut seconds = 0.;
    loop {
        match reader.next_packet() {
            Ok(packet) if packet.track_id() == track_id => {
                let decoded = decoder
                    .decode(&packet)
                    .map_err(|_| "音频帧损坏，已拒绝保存。")?;
                seconds += decoded.frames() as f64 / decoded.spec().rate as f64;
            }
            Ok(_) => {}
            Err(symphonia::core::errors::Error::IoError(e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(_) => return Err("音频数据读取失败。".into()),
        }
    }
    if seconds <= 0. {
        Err("音频没有有效采样。".into())
    } else {
        Ok(seconds)
    }
}
fn validate_opus(bytes: &[u8]) -> Result<f64, String> {
    let mut reader = ogg::PacketReader::new(Cursor::new(bytes));
    let mut packets = 0;
    let mut last = 0;
    let mut preskip = 0;
    let mut ended = false;
    while let Some(p) = reader.read_packet().map_err(|_| "Opus 容器校验失败。")? {
        if packets == 0 {
            if p.data.len() < 19 || !p.data.starts_with(b"OpusHead") {
                return Err("返回内容不是 Ogg Opus。".into());
            }
            preskip = u16::from_le_bytes([p.data[10], p.data[11]]) as u64;
        } else if packets == 1 && !p.data.starts_with(b"OpusTags") {
            return Err("Opus 元数据缺失。".into());
        }
        if p.absgp_page() != u64::MAX {
            last = p.absgp_page();
        }
        ended |= p.last_in_stream();
        packets += 1;
    }
    if packets < 3 || !ended || last <= preskip {
        return Err("Opus 数据不完整。".into());
    }
    Ok((last - preskip) as f64 / 48000.)
}
pub fn safe_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_control() || "/\\:*?\"<>|".contains(c) {
                '_'
            } else {
                c
            }
        })
        .take(100)
        .collect();
    let s = s.trim().trim_matches('.').trim();
    if s.is_empty() {
        "配音".into()
    } else {
        s.to_string()
    }
}
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut temp = NamedTempFile::new_in(path.parent().ok_or("无效目录。")?)
        .map_err(|_| "无法写入目录，请检查权限。")?;
    temp.write_all(bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| "写入失败，请检查磁盘空间。")?;
    temp.persist_noclobber(path)
        .map_err(|_| "文件已存在或无法完成原子保存。")?;
    Ok(())
}
pub struct Exported {
    pub audio: PathBuf,
    pub srt: Option<PathBuf>,
    pub txt: PathBuf,
}
pub fn export(
    dir: &Path,
    base: &str,
    format: &str,
    audio: &[u8],
    srt: Option<&str>,
    text: &str,
) -> Result<Exported, String> {
    if !dir.is_dir() {
        return Err("保存目录不存在，请重新选择。".into());
    }
    let base = safe_name(base);
    for n in 0..10000 {
        let stem = if n == 0 {
            base.clone()
        } else {
            format!("{base}_{n}")
        };
        let a = dir.join(format!("{stem}.{format}"));
        let s = dir.join(format!("{stem}.srt"));
        let t = dir.join(format!("{stem}.txt"));
        if [&a, &s, &t].iter().any(|p| p.exists()) {
            continue;
        }
        let lock_path = dir.join(format!(".{stem}.voicedock-lock"));
        let _lock = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(f) => f,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("保存目录不可写。".into()),
        };
        let mut created = Vec::new();
        let result = (|| {
            write_atomic(&t, text.as_bytes())?;
            created.push(t.clone());
            if let Some(sub) = srt {
                write_atomic(&s, sub.as_bytes())?;
                created.push(s.clone());
            }
            write_atomic(&a, audio)?;
            Ok(Exported {
                audio: a,
                srt: srt.map(|_| s),
                txt: t,
            })
        })();
        if result.is_err() {
            for p in created {
                let _ = fs::remove_file(p);
            }
        }
        let _ = fs::remove_file(lock_path);
        return result;
    }
    Err("同名文件过多，请更改文件名。".into())
}
