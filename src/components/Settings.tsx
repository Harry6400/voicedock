import { useEffect, useState } from "react";
import { KeyRound, FolderOpen, ShieldCheck } from "lucide-react";
import { isEnabled, enable, disable } from "@tauri-apps/plugin-autostart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import { call, chooseDirectory, desktop, persist } from "@/lib/api";
import type { Workspace } from "@/types";
export default function Settings({
  data,
  onSaved,
  hasKey,
  onKey,
  notify,
}: {
  data: Workspace;
  onSaved: (d: Workspace) => void;
  hasKey: boolean;
  onKey: (v: boolean) => void;
  notify: (s: string) => void;
}) {
  const [key, setKey] = useState("");
  const [proxy, setProxy] = useState(data.proxy);
  const [shortcut, setShortcut] = useState(data.shortcut);
  const [dir, setDir] = useState(data.options.outputDir);
  const [template, setTemplate] = useState(data.options.nameTemplate);
  const [auto, setAuto] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (desktop)
      void isEnabled()
        .then(setAuto)
        .catch(() => notify("无法读取开机启动状态。"));
  }, [notify]);
  async function storeKey(remove = false) {
    try {
      await call("set_api_key", { key: remove ? "" : key });
      setKey("");
      onKey(!remove);
      notify(
        remove
          ? "API Key 已从系统安全存储删除。"
          : "API Key 已保存到系统安全存储，尚未验证 API 连接。",
      );
    } catch (e) {
      notify(String(e));
    }
  }
  async function save() {
    setSaving(true);
    try {
      const next = {
        ...data,
        proxy: proxy.trim(),
        shortcut: shortcut.trim(),
        options: {
          ...data.options,
          outputDir: dir,
          nameTemplate: template || "{date}_{voice}_{title}",
        },
      };
      await persist(next);
      onSaved(next);
      notify("设置已保存。");
    } catch (e) {
      notify(String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="subpage settings">
      <div className="page-heading">
        <div>
          <h2>设置</h2>
          <p>配置服务、文件输出和系统行为。</p>
        </div>
      </div>
      <section className="settings-section">
        <h3>
          <KeyRound />
          服务凭据
        </h3>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="api-key">
              API Key{" "}
              <span className="muted">
                {hasKey ? "已保存 · 未验证连接" : "尚未配置"}
              </span>
            </FieldLabel>
            <Input
              id="api-key"
              type="password"
              autoComplete="off"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={
                hasKey ? "输入新的 Key 以替换" : "粘贴你的 Fish Audio API Key"
              }
            />
            <FieldDescription>
              <ShieldCheck />
              凭据只保存在 macOS Keychain，网络请求由本地后端执行。
            </FieldDescription>
            <div className="inline-actions">
              <Button
                size="sm"
                disabled={!key.trim()}
                onClick={() => void storeKey()}
              >
                保存 Key
              </Button>
              {hasKey && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void storeKey(true)}
                >
                  删除 Key
                </Button>
              )}
            </div>
          </Field>
        </FieldGroup>
      </section>
      <section className="settings-section">
        <h3>文件输出</h3>
        <FieldGroup>
          <Field>
            <FieldLabel>默认保存目录</FieldLabel>
            <Button
              variant="outline"
              className="directory-button"
              title={dir || "选择默认保存目录"}
              onClick={() =>
                void chooseDirectory()
                  .then((p) => p && setDir(p))
                  .catch((e) => notify(String(e)))
              }
            >
              <FolderOpen data-icon="inline-start" />
              <span>{dir || "选择保存目录"}</span>
            </Button>
          </Field>
          <Field>
            <FieldLabel htmlFor="name-template">命名规则</FieldLabel>
            <Input
              id="name-template"
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            />
            <FieldDescription>
              支持 {"{date}"}、{"{voice}"}、{"{title}"}；同名文件自动递增。
            </FieldDescription>
          </Field>
        </FieldGroup>
      </section>
      <section className="settings-section">
        <h3>网络</h3>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="proxy">手动代理（可选）</FieldLabel>
            <Input
              id="proxy"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              placeholder="http://127.0.0.1:7897"
            />
            <FieldDescription>
              留空使用系统代理。支持 HTTP / HTTPS /
              SOCKS5；地址中不保存账号密码。
            </FieldDescription>
          </Field>
        </FieldGroup>
      </section>
      <section className="settings-section">
        <h3>系统</h3>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="shortcut">全局快捷键</FieldLabel>
            <Input
              id="shortcut"
              value={shortcut}
              onChange={(e) => setShortcut(e.target.value)}
            />
            <FieldDescription>
              默认 ⌥⌘G。使用 Alt、Super、Shift 和 KeyG 等按键名。
            </FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <FieldLabel htmlFor="autostart">登录时启动 VoiceDock</FieldLabel>
            <Switch
              id="autostart"
              checked={auto}
              disabled={!desktop}
              onCheckedChange={(v) => {
                void (v ? enable() : disable())
                  .then(() => setAuto(v))
                  .catch(() =>
                    notify("无法修改开机启动，请从打包后的应用重试。"),
                  );
              }}
            />
          </Field>
        </FieldGroup>
      </section>
      <p className="settings-footnote">
        ⌘↵ 生成配音　⌘, 设置　Esc 收起面板
        <br />
        免费模型不可用时会提示，绝不静默切换付费模型。
      </p>
      <div className="settings-savebar">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "正在保存…" : "保存设置"}
        </Button>
      </div>
    </div>
  );
}
