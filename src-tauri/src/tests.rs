use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::json;
use std::time::Duration;
use wiremock::{
    matchers::{body_json, header, method, path},
    Mock, MockServer, ResponseTemplate,
};

fn voice() -> Voice {
    Voice {
        id: "4ed45d53ee9245d9abf20db5221b19b2".into(),
        name: "猫娘·甜美".into(),
        provider: "fish".into(),
        description: "".into(),
        favorite: false,
        tags: vec![],
        last_used: None,
        preview_text: "你好。".into(),
    }
}
fn event(seq: u64, offset: f64, text: &str, start: f64, end: f64, audio: &[u8]) -> String {
    json!({"audio_base64":STANDARD.encode(audio),"content":text,"chunk_seq":seq,"chunk_audio_offset_sec":offset,"alignment":{"segments":[{"text":text,"start":start,"end":end}]}}).to_string()
}
fn wav() -> Vec<u8> {
    let pcm = vec![0u8; 8820];
    let len = pcm.len() as u32;
    let mut b = Vec::new();
    b.extend(b"RIFF");
    b.extend((36 + len).to_le_bytes());
    b.extend(b"WAVEfmt ");
    b.extend(16u32.to_le_bytes());
    b.extend(1u16.to_le_bytes());
    b.extend(1u16.to_le_bytes());
    b.extend(44100u32.to_le_bytes());
    b.extend(88200u32.to_le_bytes());
    b.extend(2u16.to_le_bytes());
    b.extend(16u16.to_le_bytes());
    b.extend(b"data");
    b.extend(len.to_le_bytes());
    b.extend(pcm);
    b
}
#[test]
fn alias_never_sent_and_tags_preserved() {
    let v = voice();
    let o = Options {
        voice_id: v.id.clone(),
        ..Options::default()
    };
    let b = request_body("[shy] 你好，[whisper] 世界。", &o, &[v.clone()]).unwrap();
    assert_eq!(b["reference_id"], v.id);
    assert_eq!(b["text"], "[shy] 你好，[whisper] 世界。");
    assert!(!b.to_string().contains("猫娘"));
}
#[test]
fn rejects_unknown_model_and_alias_as_id() {
    let v = voice();
    let mut o = Options {
        voice_id: v.id.clone(),
        model: "typo".into(),
        ..Options::default()
    };
    assert!(request_body("hi", &o, &[v.clone()]).is_err());
    o.model = "s2.1-pro-free".into();
    o.voice_id = v.name.clone();
    assert!(request_body("hi", &o, &[v]).is_err());
}
#[test]
fn sse_network_boundaries_crlf_multiline_utf8() {
    let raw = "\u{3a} keepalive\r\ndata: {\r\ndata: \"你好\": 1}\r\n\r\n";
    for step in 1..raw.len() {
        let mut p = subtitles::SseParser::default();
        let mut out = Vec::new();
        for b in raw.as_bytes().chunks(step) {
            out.extend(p.push(b).unwrap());
        }
        p.finish().unwrap();
        assert_eq!(out, vec!["{\n\"你好\": 1}"]);
    }
}
#[test]
fn truncated_and_error_sse_rejected() {
    let mut p = subtitles::SseParser::default();
    p.push(b"data: {}\n").unwrap();
    assert!(p.finish().is_err());
    let mut p = subtitles::SseParser::default();
    assert!(p.push(b"event: error\ndata: {}\n\n").is_err());
}
#[test]
fn snapshots_replace_audio_always_appends_global_offsets() {
    let mut c = subtitles::Collector::default();
    c.accept(&event(0, 0., "你", 0., 0.2, b"a")).unwrap();
    c.accept(&event(0, 0., "你好。", 0., 0.8, b"b")).unwrap();
    c.accept(&event(1, 1.5, "世界！", 0., 0.8, b"c")).unwrap();
    assert_eq!(c.audio, b"abc");
    let s = c.srt("[shy]你好。世界！", 3.).unwrap();
    assert_eq!(s.matches(" --> ").count(), 2);
    assert!(s.contains("00:00:01,500 --> 00:00:02,300"));
    assert!(!s.contains("[shy]"));
}
#[test]
fn missing_partial_and_overlapping_alignment_not_faked() {
    let mut c = subtitles::Collector::default();
    c.accept(&event(0, 0., "你", 0., 0.8, b"a")).unwrap();
    assert!(c.srt("你好", 2.).is_err());
    c.accept(&event(1, 0.5, "好", 0., 0.8, b"b")).unwrap();
    assert!(c.srt("你好", 2.).is_err());
    let mut c = subtitles::Collector::default();
    c.accept(&json!({"audio_base64":"YQ==","content":"hi","chunk_seq":0,"chunk_audio_offset_sec":0,"alignment":null}).to_string()).unwrap();
    assert!(c.srt("hi", 2.).is_err());
}
#[test]
fn srt_merges_words_and_breaks_on_pause() {
    let a = vec![
        subtitles::Segment {
            text: "Hello".into(),
            start: 0.,
            end: 0.3,
        },
        subtitles::Segment {
            text: "world.".into(),
            start: 0.3,
            end: 0.8,
        },
        subtitles::Segment {
            text: "你好。".into(),
            start: 1.5,
            end: 2.,
        },
    ];
    let s = subtitles::build_srt(&a, 2.1).unwrap();
    assert!(s.contains("Hello world."));
    assert_eq!(s.matches(" --> ").count(), 2);
}
#[test]
fn real_wav_decodes_and_corruption_rejected() {
    let b = wav();
    assert!((files::validate_audio(&b, "wav").unwrap() - 0.1).abs() < 0.001);
    assert!(files::validate_audio(&b, "mp3").is_err());
    assert!(files::validate_audio(b"{\"error\":\"not audio\"}", "mp3").is_err());
    assert!(files::validate_audio(&b[..b.len() - 1], "wav").is_err());
}
#[test]
fn export_conflict_and_shared_basename() {
    let d = tempfile::tempdir().unwrap();
    let b = wav();
    let a = files::export(d.path(), "test", "wav", &b, Some("srt"), "txt").unwrap();
    let z = files::export(d.path(), "test", "wav", &b, Some("srt"), "txt").unwrap();
    assert_eq!(a.audio.file_stem(), a.txt.file_stem());
    assert_eq!(z.audio.file_name().unwrap(), "test_1.wav");
    assert_eq!(std::fs::read(a.audio).unwrap(), b);
    assert_eq!(files::safe_name("../../坏:名"), "_.._坏_名");
}
#[test]
fn sidecar_conflict_never_overwrites() {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(d.path().join("x.srt"), "original").unwrap();
    let o = files::export(d.path(), "x", "wav", &wav(), None, "clean").unwrap();
    assert_eq!(o.audio.file_name().unwrap(), "x_1.wav");
    assert_eq!(
        std::fs::read_to_string(d.path().join("x.srt")).unwrap(),
        "original"
    );
}
#[tokio::test]
async fn mocked_api_sends_explicit_free_model_and_full_text() {
    let s = MockServer::start().await;
    let body = json!({"text":"[shy]原文。第二句。","reference_id":"id"});
    Mock::given(method("POST"))
        .and(path("/tts"))
        .and(header("model", "s2.1-pro-free"))
        .and(header("authorization", "Bearer fake-only-in-test"))
        .and(body_json(&body))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(wav()))
        .expect(1)
        .mount(&s)
        .await;
    let c = provider::synthesize(
        &reqwest::Client::new(),
        &format!("{}/tts", s.uri()),
        "fake-only-in-test",
        "s2.1-pro-free",
        &body,
        false,
        CancellationToken::new(),
        |_| {},
    )
    .await
    .unwrap();
    assert!(files::validate_audio(&c.audio, "wav").is_ok());
}
#[tokio::test]
async fn mocked_sse_combines_packets() {
    let s = MockServer::start().await;
    let raw = format!(
        "data: {}\n\ndata: {}\n\n",
        event(0, 0., "hi", 0., 1., b"a"),
        event(0, 0., "hi", 0., 1., b"b")
    );
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(raw, "text/event-stream"))
        .mount(&s)
        .await;
    let c = provider::synthesize(
        &reqwest::Client::new(),
        &s.uri(),
        "fake-only-in-test",
        "s2.1-pro-free",
        &json!({}),
        true,
        CancellationToken::new(),
        |_| {},
    )
    .await
    .unwrap();
    assert_eq!(c.audio, b"ab");
    assert!(c.srt("hi", 2.).is_ok());
}
#[tokio::test]
async fn rate_limits_bounded_to_three_requests() {
    let s = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(429).insert_header("retry-after", "1"))
        .expect(3)
        .mount(&s)
        .await;
    let r = provider::synthesize(
        &reqwest::Client::new(),
        &s.uri(),
        "fake-only-in-test",
        "s2.1-pro-free",
        &json!({}),
        false,
        CancellationToken::new(),
        |_| {},
    )
    .await;
    assert!(r.err().unwrap().contains("有限重试"));
}
#[tokio::test]
async fn cancels_pending_request_without_retry() {
    let s = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(10)))
        .mount(&s)
        .await;
    let token = CancellationToken::new();
    let cancel = token.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(40)).await;
        cancel.cancel();
    });
    let r = provider::synthesize(
        &reqwest::Client::new(),
        &s.uri(),
        "fake-only-in-test",
        "s2.1-pro-free",
        &json!({}),
        false,
        token,
        |_| {},
    )
    .await;
    assert!(r.err().unwrap().contains("已取消"));
    assert!(s.received_requests().await.unwrap().len() <= 1);
}
#[tokio::test]
async fn unauthorized_never_retried_and_no_secrets_in_errors() {
    let s = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(401).set_body_string("secret should not leak"))
        .expect(1)
        .mount(&s)
        .await;
    let e = provider::synthesize(
        &reqwest::Client::new(),
        &s.uri(),
        "fake-only-in-test",
        "s2.1-pro-free",
        &json!({}),
        false,
        CancellationToken::new(),
        |_| {},
    )
    .await
    .err()
    .unwrap();
    assert!(e.contains("API Key"));
    assert!(!e.contains("secret"));
}
#[test]
fn mp3_and_opus_fixtures_are_real_and_valid() {
    let mp3 = include_bytes!("../fixtures/tone.mp3");
    let opus = include_bytes!("../fixtures/tone.opus");
    assert!(files::validate_audio(mp3, "mp3").unwrap() > 0.19);
    assert!((files::validate_audio(opus, "opus").unwrap() - 0.2).abs() < 0.01);
    let mut corrupt = opus.to_vec();
    corrupt[90] ^= 1;
    assert!(files::validate_audio(&corrupt, "opus").is_err());
}
#[tokio::test]
async fn offline_audio_subtitle_export_end_to_end() {
    let server = MockServer::start().await;
    let wav = wav();
    let split = wav.len() / 2;
    let raw = format!(
        "data: {}\n\ndata: {}\n\n",
        event(0, 0., "测试", 0., 0.04, &wav[..split]),
        event(0, 0., "测试。", 0., 0.1, &wav[split..])
    );
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_raw(raw, "text/event-stream"))
        .expect(1)
        .mount(&server)
        .await;
    let c = provider::synthesize(
        &reqwest::Client::new(),
        &server.uri(),
        "fake-only-in-test",
        "s2.1-pro-free",
        &json!({"text":"[shy]测试。"}),
        true,
        CancellationToken::new(),
        |_| {},
    )
    .await
    .unwrap();
    let duration = files::validate_audio(&c.audio, "wav").unwrap();
    let srt = c.srt("[shy]测试。", duration).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let out = files::export(
        dir.path(),
        "离线验收",
        "wav",
        &c.audio,
        Some(&srt),
        &subtitles::clean_text("[shy]测试。"),
    )
    .unwrap();
    assert_eq!(std::fs::read(out.audio).unwrap(), wav);
    assert!(std::fs::read_to_string(out.srt.unwrap())
        .unwrap()
        .contains("00:00:00,100"));
    assert_eq!(std::fs::read_to_string(out.txt).unwrap(), "测试。");
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "Uses the real macOS Keychain with a temporary non-API credential; run explicitly."]
fn native_keychain_round_trip() {
    struct Cleanup(keyring::Entry);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = self.0.delete_credential();
        }
    }
    let entry = keyring::Entry::new(
        "com.harry6400.voicedock.validation",
        &format!("test-{}", std::process::id()),
    )
    .unwrap();
    let entry = Cleanup(entry);
    entry
        .0
        .set_password("local-validation-placeholder-not-an-api-key")
        .unwrap();
    assert_eq!(
        entry.0.get_password().unwrap(),
        "local-validation-placeholder-not-an-api-key"
    );
    entry.0.delete_credential().unwrap();
    assert!(matches!(
        entry.0.get_password(),
        Err(keyring::Error::NoEntry)
    ));
}
