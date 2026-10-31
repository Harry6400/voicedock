use crate::subtitles::{Collector, SseParser};
use futures_util::StreamExt;
use reqwest::{Client, StatusCode};
use serde_json::Value;
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub fn client(proxy: &str) -> Result<Client, String> {
    let mut builder = Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(300));
    if !proxy.trim().is_empty() {
        let url = reqwest::Url::parse(proxy).map_err(|_| "代理地址无效。")?;
        if !["http", "https", "socks5", "socks5h"].contains(&url.scheme())
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("代理须使用 HTTP/HTTPS/SOCKS5，且不能在地址中包含凭据。".into());
        }
        builder = builder.proxy(reqwest::Proxy::all(proxy).map_err(|_| "代理地址无效。")?);
    }
    builder.build().map_err(|_| "无法初始化网络连接。".into())
}
pub fn status_error(status: StatusCode) -> String {
    match status.as_u16() {
        401 | 403 => "API Key 无效或没有音色访问权限，请检查设置。",
        402 => "余额不足或免费模型不可用。不会切换付费模型；请检查 Fish 账户或主动选择模型。",
        404 => "音色或接口不存在，请核对 Voice ID；如时间戳接口不可用，可主动关闭字幕后重试。",
        422 | 400 => "Fish 拒绝了音色、文本或参数，请核对 Voice ID、格式及文本长度。",
        429 => "请求过于频繁，有限重试已用尽，请稍后再试。",
        500..=599 => "Fish 服务暂时不可用，或所选免费模型未开放。未更换模型、未自动重试。",
        _ => "Fish 请求失败，请检查账户与参数。",
    }
    .into()
}
pub async fn synthesize(
    client: &Client,
    endpoint: &str,
    key: &str,
    model: &str,
    body: &Value,
    subtitles: bool,
    cancel: CancellationToken,
    status: impl Fn(&str),
) -> Result<Collector, String> {
    let response = {
        let mut retries = 0u32;
        loop {
            status(if retries == 0 {
                "正在连接 Fish Audio…"
            } else {
                "限流后重试连接…"
            });
            let response = tokio::select! { biased; _ = cancel.cancelled() => return Err("已取消。服务端可能已开始计费，请在 Fish 账户核对。".into()), r = client.post(endpoint).bearer_auth(key).header("model", model).json(body).send() => r.map_err(|_|"网络连接失败或超时。为避免重复计费，未自动重发；请检查代理后手动重试。")? };
            if response.status() == StatusCode::TOO_MANY_REQUESTS && retries < 2 {
                let delay = response
                    .headers()
                    .get("retry-after")
                    .and_then(|h| h.to_str().ok())
                    .and_then(|h| h.parse::<u64>().ok())
                    .unwrap_or(1 << retries)
                    .clamp(1, 8);
                retries += 1;
                status("触发速率限制，稍后自动重试（最多 2 次）…");
                tokio::select! { _ = cancel.cancelled() => return Err("已取消。".into()), _ = tokio::time::sleep(Duration::from_secs(delay)) => {} }
                continue;
            }
            if !response.status().is_success() {
                return Err(status_error(response.status()));
            }
            break response;
        }
    };
    if subtitles
        && !response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .contains("text/event-stream")
    {
        return Err("时间戳接口没有返回 SSE；请主动选择仅音频模式后重试。".into());
    }
    let mut stream = response.bytes_stream();
    let mut parser = SseParser::default();
    let mut collector = Collector::default();
    status("正在接收音频…");
    loop {
        let next = tokio::select! { biased; _ = cancel.cancelled() => return Err("已取消，未保存不完整文件。服务端可能已开始计费。".into()), r = stream.next() => r };
        let Some(bytes) = next else { break };
        let bytes = bytes.map_err(|_| "音频流意外中断或超时。未自动重试、未保存不完整文件。")?;
        if subtitles {
            for e in parser.push(&bytes)? {
                collector.accept(&e)?;
            }
        } else {
            collector.audio.extend(bytes);
        }
        if collector.audio.len() > 200 * 1024 * 1024 {
            return Err("响应超过 200 MB 安全上限，已停止。".into());
        }
    }
    if subtitles {
        parser.finish()?;
    }
    if cancel.is_cancelled() {
        return Err("已取消。".into());
    }
    Ok(collector)
}
