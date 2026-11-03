// Input must be an evaluation of the actual NixOS module. This module only
// validates/consumes that result; it never synthesizes proxy policy or assets.
import path from "node:path";
import { readFile, stat, access } from "node:fs/promises";
import { parse as validateJson } from "lossless-json";

const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const keys = (v, names) => object(v) && Object.keys(v).sort().join(",") === [...names].sort().join(",");
const loopback = (host) => ["127.0.0.1", "localhost", "[::1]"].includes(host);
const text = (s) => typeof s === "string" && !/[\0\r]/u.test(s);
export async function validateProxyConfig(value) {
  if (!keys(value, ["backendPort", "publicUrl", "root", "locations"]) || !Number.isInteger(value.backendPort) || value.backendPort < 1 || value.backendPort > 65535) throw new Error("invalid evaluated proxy envelope");
  const publicUrl = new URL(value.publicUrl);
  if (publicUrl.protocol !== "https:" || !loopback(publicUrl.hostname) || value.publicUrl !== publicUrl.origin || publicUrl.username || publicUrl.password || publicUrl.search || publicUrl.hash) throw new Error("proxy publicUrl must be an exact HTTPS loopback origin");
  const publicPort = Number(publicUrl.port || "443");
  if (publicPort === value.backendPort) throw new Error("proxy and backend ports must differ");
  if (value.root !== null) {
    if (!text(value.root) || /\n/u.test(value.root) || !path.isAbsolute(value.root) || !(await stat(value.root)).isDirectory()) throw new Error("invalid actual proxy asset root");
    await access(path.join(value.root, "index.html"));
  }
  if (!object(value.locations) || Object.keys(value.locations).length === 0) throw new Error("empty evaluated proxy locations");
  let proxied = 0;
  for (const [name, location] of Object.entries(value.locations)) {
    if (!name || /[\0\r\n{};]/u.test(name) || !keys(location, ["proxyPass", "proxyWebsockets", "tryFiles", "extraConfig"]) || typeof location.proxyWebsockets !== "boolean" || !text(location.extraConfig) || !(location.tryFiles === null || text(location.tryFiles))) throw new Error("invalid evaluated proxy location");
    if (location.proxyPass !== null) {
      if (!text(location.proxyPass)) throw new Error("invalid evaluated proxyPass");
      const target = new URL(location.proxyPass);
      if (target.protocol !== "http:" || !loopback(target.hostname) || Number(target.port || "80") !== value.backendPort || target.username || target.password || target.search || target.hash) throw new Error("proxyPass must target the declared loopback backend port");
      proxied++;
    }
  }
  if (!proxied) throw new Error("evaluated proxy has no backend locations");
  return value;
}
export async function readProxyConfig(file) {
  if (typeof file !== "string" || !path.isAbsolute(file)) throw new Error("HAYSTACK_PROXY_CONFIG_FILE must be an absolute module-evaluation JSON file");
  const info = await stat(file);
  if (!info.isFile() || info.size < 1 || info.size > 1024 * 1024) throw new Error("invalid evaluated proxy file size");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(file));
  validateJson(source);
  return validateProxyConfig(JSON.parse(source));
}
