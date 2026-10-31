import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const env = { ...process.env };
const cargoHome = path.join(root, ".tools", "cargo");
const localCargo = path.join(
  cargoHome,
  "bin",
  process.platform === "win32" ? "cargo.exe" : "cargo",
);
if (existsSync(localCargo)) {
  env.CARGO_HOME = cargoHome;
  env.RUSTUP_HOME = path.join(root, ".tools", "rustup");
  env.PATH = path.join(cargoHome, "bin") + path.delimiter + env.PATH;
}
const [tool, ...args] = process.argv.slice(2);
const executable =
  tool === "tauri"
    ? process.execPath
    : existsSync(localCargo)
      ? localCargo
      : "cargo";
const commandArgs =
  tool === "tauri"
    ? [
        path.join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"),
        ...args,
      ]
    : args;
const child = spawn(executable, commandArgs, {
  cwd: root,
  env,
  stdio: "inherit",
});
child.on("error", (e) => {
  process.stderr.write(`无法运行工具链：${e.message}\n`);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
