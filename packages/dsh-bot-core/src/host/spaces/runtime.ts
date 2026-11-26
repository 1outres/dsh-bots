import type { SpaceRuntimeBoot } from "../../shared/spaces"

const RUNTIME = `(() => {
  "use strict";
  const boot = __BOOT__;
  const script = document.currentScript;
  const api = new URL("./", script && script.src ? script.src : location.href).href;
  const read = async (response) => {
    const body = await response.json();
    if (!response.ok) {
      const error = new Error(body && body.message ? body.message : "the request failed");
      error.code = body && body.error;
      throw error;
    }
    return body;
  };
  const post = (path, body) =>
    fetch(api + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(read);
  const changes = new Set();
  const named = new Map();
  const live = new EventSource(api + "live");
  live.addEventListener("kv", (event) => {
    const change = JSON.parse(event.data);
    const value = Object.prototype.hasOwnProperty.call(change, "value") ? change.value : undefined;
    for (const listener of [...changes]) listener({ key: change.key, value });
  });
  live.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    for (const listener of [...(named.get(message.name) || [])]) listener(message.data);
  });
  live.addEventListener("gone", () => live.close());
  const refuseRead = () => Promise.reject(new Error("this page can only read"));
  const kv = Object.freeze({
    async get(key) {
      const response = await fetch(api + "kv?key=" + encodeURIComponent(key));
      if (response.status === 404) return undefined;
      return (await read(response)).value;
    },
    async list(prefix) {
      const response = await fetch(api + "kv?prefix=" + encodeURIComponent(prefix || ""));
      return (await read(response)).entries;
    },
    set(key, value) {
      return boot.writable ? post("kv", { op: "set", key, value }).then(() => undefined) : refuseRead();
    },
    delete(key) {
      return boot.writable ? post("kv", { op: "delete", key }).then(() => undefined) : refuseRead();
    },
    on(listener) {
      changes.add(listener);
      return () => changes.delete(listener);
    },
  });
  const space = Object.freeze({
    viewer: boot.viewer,
    revision: boot.revision,
    writable: boot.writable,
    kv,
    send(name, data) {
      return post("events", data === undefined ? { name } : { name, data });
    },
    on(name, listener) {
      const listeners = named.get(name) || new Set();
      listeners.add(listener);
      named.set(name, listeners);
      return () => listeners.delete(listener);
    },
  });
  Object.defineProperty(window, "space", { value: space, enumerable: true });
})();
`

export function spaceRuntime(boot: SpaceRuntimeBoot): string {
  return RUNTIME.replace("__BOOT__", JSON.stringify(boot))
}
