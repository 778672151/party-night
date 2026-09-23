// 真浏览器（Windows Edge over CDP）测试脚手架：零 npm 依赖
import { writeFileSync, mkdirSync } from 'node:fs';

/** 截图目录（调试用，可选）：PN_SHOTS=/some/dir node test/browser/regress.mjs */
export const SHOTS = process.env.PN_SHOTS || 'pn-shots';

export async function connect(port = 9222) {
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const handlers = new Map();
  const failAll = (why) => {
    console.error('[cdp] ' + why + '（还有 ' + pending.size + ' 个请求没回）');
    for (const [, rej] of pending) rej(new Error('CDP 连接断了: ' + why));
    pending.clear();
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method && m.sessionId && handlers.has(m.sessionId)) handlers.get(m.sessionId)(m);
  };
  ws.onclose = (e) => failAll('websocket closed code=' + e.code);
  ws.onerror = () => failAll('websocket error');
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { send, handlers, browser: v.Browser, close: () => ws.close() };
}

export const OPEN = [];

export async function dumpOpen() {
  for (const p of OPEN) {
    try {
      const info = await p.eval(`JSON.stringify({
        code: (PN.app && PN.app.room && PN.app.room.code) || null,
        conn: PN.app && PN.app.conn, isHost: !!(PN.app && PN.app.room && PN.app.room.isHost),
        mode: PN.app && PN.app.state && PN.app.state.mode,
        phase: PN.app && PN.app.state && PN.app.state.g && PN.app.state.g.phase,
        players: (PN.app && PN.app.state && PN.app.state.players || []).map(x => x.name),
        peers: PN.app && PN.app.room ? Object.keys(PN.app.room.peers) : [],
        screen: PN.app && PN.app.screenName
      })`);
      console.log('  [' + (p.name || '?') + '] ' + info + ' dialogs=' + JSON.stringify(p.dialogs));
    } catch (e) { console.log('  [' + (p.name || '?') + '] 读取失败: ' + e.message); }
  }
}

export class Page {
  constructor(send, sessionId, targetId, ctxId) {
    this.send = send; this.sid = sessionId; this.targetId = targetId; this.ctxId = ctxId;
    this.ctxId = ctxId;
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, this.sid);
    if (r.exceptionDetails) throw new Error('page eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + '\n  expr=' + expr.slice(0, 200));
    return r.result.value;
  }
  async waitFor(expr, label, timeout = 25000) {
    const t0 = Date.now();
    for (;;) {
      let v = false;
      try { v = await this.eval('!!(' + expr + ')'); } catch (e) { v = false; }
      if (v) return true;
      if (Date.now() - t0 > timeout) throw new Error('等待超时: ' + (label || expr));
      await new Promise(r => setTimeout(r, 200));
    }
  }
  async box(sel) {
    return this.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width && !r.height) return null; return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, left: r.x, top: r.y }; })()`);
  }
  async mouse(type, x, y, extra = {}) {
    await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, ...extra }, this.sid);
  }
  /** 真实点击（走浏览器输入管线，会生成可信 pointer 事件） */
  async click(sel) {
    // 先滚到可见区再点：大厅里游戏变多以后，目标卡片可能在视口外，
    // 用坐标点击就会落在屏幕外（真实用户也会先滑动一下）
    await this.eval('(() => { const el = document.querySelector(' + JSON.stringify(sel) + '); if (el && el.scrollIntoView) el.scrollIntoView({ block: "center" }); return true; })()').catch(() => {});
    await new Promise(r => setTimeout(r, 150));
    const b = await this.box(sel);
    if (!b) throw new Error('找不到可点元素: ' + sel);
    await this.mouse('mouseMoved', b.x, b.y, { button: 'none' });
    await this.mouse('mousePressed', b.x, b.y, { buttons: 1 });
    await this.mouse('mouseReleased', b.x, b.y, { buttons: 0 });
    await new Promise(r => setTimeout(r, 120));
  }
  /** 在元素内按下并拖到另一坐标（同一元素坐标系内按比例） */
  async drag(sel, fromFrac, toFrac, steps = 12) {
    const b = await this.box(sel);
    if (!b) throw new Error('找不到可拖拽元素: ' + sel);
    const p = (f) => ({ x: b.left + b.w * f[0], y: b.top + b.h * f[1] });
    const a = p(fromFrac), z = p(toFrac);
    await this.mouse('mouseMoved', a.x, a.y, { button: 'none' });
    await this.mouse('mousePressed', a.x, a.y, { buttons: 1 });
    for (let i = 1; i <= steps; i++) {
      await this.mouse('mouseMoved', a.x + (z.x - a.x) * i / steps, a.y + (z.y - a.y) * i / steps, { buttons: 1 });
      await new Promise(r => setTimeout(r, 16));
    }
    return { from: a, to: z };
  }
  async release(x, y) { await this.mouse('mouseReleased', x, y, { buttons: 0 }); }
  async fill(sel, text) {
    await this.eval(`(() => {
      const e = document.querySelector(${JSON.stringify(sel)});
      const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      d.set.call(e, ${JSON.stringify(text)});
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.focus();
      return true;
    })()`);
  }
  async type(text, delay = 0) {
    for (const ch of text) { await this.send('Input.dispatchKeyEvent', { type: 'char', text: ch }, this.sid); if (delay) await new Promise(r => setTimeout(r, delay)); }
  }
  async key(key, code, keyCode) {
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode }, this.sid);
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode }, this.sid);
  }
  /** 触屏拖拽（真·touch 事件管线，会生成 pointerType='touch' 的 pointer 事件） */
  async touchDrag(sel, fromFrac, toFrac, steps = 12) {
    const b = await this.box(sel);
    if (!b) throw new Error('找不到可触元素: ' + sel);
    const p = (f) => ({ x: b.left + b.w * f[0], y: b.top + b.h * f[1] });
    const a = p(fromFrac), z = p(toFrac);
    await this.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] }, this.sid);
    for (let i = 1; i <= steps; i++) {
      await this.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (z.x - a.x) * i / steps, y: a.y + (z.y - a.y) * i / steps, id: 1 }] }, this.sid);
      await new Promise(r => setTimeout(r, 16));
    }
    await this.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, this.sid);
    return { from: a, to: z };
  }
  /** 截图（失败不影响用例结论） */
  async shot(name) {
    try {
      const r = await this.send('Page.captureScreenshot', { format: 'png' }, this.sid);
      mkdirSync(SHOTS, { recursive: true });
      const path = SHOTS + '/' + name + '.png';
      writeFileSync(path, Buffer.from(r.data, 'base64'));
      return path;
    } catch (e) { return null; }
  }
  async consoleErrors() { return this.eval('JSON.stringify(window.__pnErrors || [])'); }
  /** 原地刷新（模拟按 F5 / 断线后重开）：localStorage 里的身份会留下来 */
  async reload() {
    await this.send('Page.reload', { ignoreCache: false }, this.sid);
    await this.waitFor('document.readyState === "complete"', '页面刷新');
  }
}

export async function newPage(cdp, url, { width = 420, height = 900, mobile = true, ctxId } = {}) {
  let browserContextId = ctxId;
  if (!browserContextId) ({ browserContextId } = await cdp.send('Target.createBrowserContext'));
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }, sessionId);
  // 收集页面错误，便于断言「屏幕上不许出现 界面出错了」
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__pnErrors = []; window.addEventListener('error', e => window.__pnErrors.push(String(e.message)));
             const _ce = console.error; console.error = function (...a) { window.__pnErrors.push(a.map(String).join(' ')); _ce.apply(console, a); };`,
  }, sessionId);
  const page = new Page(cdp.send, sessionId, targetId, browserContextId);
  page.dialogs = [];
  // 关键：原生 confirm/prompt 会把页面挂起，不处理就整个测试卡死
  cdp.handlers.set(sessionId, (m) => {
    if (m.method !== 'Page.javascriptDialogOpening') return;
    page.dialogs.push({ type: m.params.type, message: m.params.message });
    cdp.send('Page.handleJavaScriptDialog', { accept: true }, sessionId).catch(() => {});
  });
  if (url) { await cdp.send('Page.navigate', { url }, sessionId); await page.waitFor('document.readyState === "complete"', '页面加载'); }
  OPEN.push(page);
  page.dispose = async () => {
    const i = OPEN.indexOf(page); if (i >= 0) OPEN.splice(i, 1);
    try { await cdp.send('Target.closeTarget', { targetId }); } catch (e) {}
    try { await cdp.send('Target.disposeBrowserContext', { browserContextId }); } catch (e) {}
  };
  return page;
}

/* ---------- 应用层辅助：真浏览器里真的建房/进房/开局 ---------- */
export const APP = process.env.PN_APP || 'http://localhost:8080/dist/party-night.html';

export async function createRoom(cdp, name) {
  const p = await newPage(cdp, APP);
  await p.fill('#pn-name', name);
  await p.click('#pn-create');
  await p.waitFor('document.querySelector(".roomcode .code")', name + ' 拿到房号', 40000);
  await p.waitFor('PN.app.conn === "connected"', name + ' 连上 broker', 40000);
  await p.waitFor('!!(PN.app.room.meta && PN.app.room.meta.host)', name + ' meta 已发布', 30000);
  p.code = await p.eval('PN.app.room.code');
  p.name = name;
  return p;
}

/**
 * 进房。会重试一种**环境**故障：公共 broker 连不上主服务器时客户端会自动换备用，
 * 而备用是另一套话题空间 —— 这个人会变成「一个人一个房」，和产品逻辑无关。
 * 真实用户看到的是大厅里那句「刷新一下一般就能看到群友了」。
 */
export async function joinRoom(cdp, name, code, tries = 5) {
  for (let i = 0; i < tries; i++) {
    const p = await newPage(cdp, APP + '#' + code);
    await p.fill('#pn-name', name);
    await p.click('#pn-join');
    await p.waitFor('PN.app.room && PN.app.room.code', name + ' 进房', 40000);
    await p.waitFor('PN.app.conn === "connected"', name + ' 连上 broker', 40000);
    p.code = code; p.name = name;
    const lonely = await p.waitFor('PN.app.state && PN.app.state.players.length >= 2', name + ' 看到房里别人', 12000)
      .then(() => false).catch(() => true);
    if (!lonely) return p;
    console.log('  [环境重试] ' + name + ' 落在了另一台公共服务器，重新进房…');
    await p.dispose();
    await sleep(2500);           // 给公共 broker 一点时间把下一次连接分配回同一台
  }
  throw new Error(name + ' 连续 ' + tries + ' 次都没能和房主进到同一个房间（公共 broker 兜底导致，非产品缺陷）');
}

/** 等房主名单里出现 n 个人 */
/** 在同一个浏览器上下文里重开一个页面：localStorage 保留，所以玩家的 id 不变（= 同一个人回来） */
export async function reopenInContext(cdp, oldPage, url) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId: oldPage.ctxId });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 1, mobile: true }, sessionId);
  const page = new Page(cdp.send, sessionId, targetId, oldPage.ctxId);
  page.dialogs = [];
  page.name = oldPage.name;
  cdp.handlers.set(sessionId, (m) => {
    if (m.method !== 'Page.javascriptDialogOpening') return;
    page.dialogs.push({ type: m.params.type, message: m.params.message });
    cdp.send('Page.handleJavaScriptDialog', { accept: true }, sessionId).catch(() => {});
  });
  OPEN.push(page);
  page.dispose = oldPage.dispose;
  await cdp.send('Page.navigate', { url }, sessionId);
  await page.waitFor('document.readyState === "complete"', '重开页面');
  return page;
}

/** 只关页面、保留浏览器上下文（模拟「人掉线但还会回来」） */
export async function closeTabOnly(cdp, page) {
  const i = OPEN.indexOf(page); if (i >= 0) OPEN.splice(i, 1);
  await cdp.send('Target.closeTarget', { targetId: page.targetId });
}

export async function waitPlayers(host, n, timeout = 40000) {
  await host.waitFor('PN.app.state && PN.app.state.players.length >= ' + n, '名单 ' + n + ' 人', timeout);
  await sleep(400);
}

/**
 * 等一个跨端断言真正收敛，而不是「睡固定时长再读」。
 *
 * 为什么必须有它：动作走 QoS0，房主未回执就会按 ACT_RETRY_MS(1500ms) 重传。
 * 以前测试习惯 `await sleep(1500)` 再读 —— 恰好卡在一个重传周期上，于是同样一段正确的代码，
 * 有时读到已生效、有时读到还没生效（实测 duo-conflict §4：8 次里 4 次读到 0 手/2 手而假红）。
 * 判定条件应该由调用方给出「什么算稳定」，本函数只负责轮询到稳定为止。
 *
 * @param read () => 要观察的值（可以是 async，内部会 await）
 * @param ok   (value) => boolean —— 这个读数算不算「已经是想要的结果」
 * @param opts { timeout = 12000, interval = 250 }
 * @returns 稳定（且满足 ok）后的读数；超时则返回最后一次读数，由调用方断言给结论
 */
export async function settle(read, ok, opts = {}) {
  const { timeout = 12000, interval = 250 } = opts;
  const t0 = Date.now();
  let prev = await read();
  while (Date.now() - t0 < timeout) {
    await sleep(interval);
    const cur = await read();
    // 连续两次读数完全相同 ⇒ 重传窗口已经走完，这一刻的值才是最终值
    const settled = JSON.stringify(cur) === JSON.stringify(prev);
    if (settled && ok(cur)) return cur;
    prev = cur;
  }
  // 超时不算失败：交回最后一次读数，让调用方的断言给出结论（失败信息才有上下文）
  return await read();
}

/** 反复点直到状态满足条件：大厅随时可能被一条状态消息重建，单次点击可能落空 */
export async function clickUntil(page, sel, cond, label, tries = 4, perTry = 6000) {
  for (let i = 0; i < tries; i++) {
    await page.click(sel);
    try { await page.waitFor(cond, label, perTry); return; } catch (e) { /* 重建把点击吃掉了，再点 */ }
  }
  throw new Error('点了 ' + tries + ' 次仍未满足: ' + label);
}

export async function startGame(host, mode) {
  await clickUntil(host, '.modecard[data-mode="' + mode + '"] [data-act="start"]',
    'PN.app.state.mode === "' + mode + '"', '进入 ' + mode);
  await sleep(600);
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));


export function assert(cond, msg) {
  if (cond) { console.log('  ✓ ' + msg); return true; }
  console.log('  ✗ ' + msg); process.exitCode = 1; return false;
}