/* ===== 鲸鱼推箱子 屏幕（复用原作 + 双人兼容）=====
 *
 * 画面/物理/动画/关卡/UI **全部是原作**（mini/plus-2265f7c6，Three.js 三渲二），
 * 我们只做三件事：
 *   ① 用 iframe 把原作整包跑起来
 *   ② 注入一段极薄桥接（不改原作任何文件）：postMessage 出局面、进来 move/load/restart
 *   ③ 双人兼容：轮流出手 + 移动日志；两端各自把日志重放进原作（确定性的 → 局面必然一致）
 *
 * 重要：这里**绝不重建 DOM**（ui.js 的 patch 恒返回 true）。把 iframe 挪到别的父节点会让它重新加载，
 * 那就会黑屏重进标题页。所有更新都是"就地改文字/禁用状态"。
 * 同时用捕获阶段拦掉 iframe 内的键盘与它的 UI 按钮：原作的输入只能由我们喂，否则双方局面会分叉。 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};
  var esc = PN.esc;

  /* 注入到 iframe 里的桥接（原封不动地调用原作已有的 window.tallgrass API） */
  var BRIDGE = [
    '(function(){',
    'if (window.__pnBridge) return; window.__pnBridge = 1;',
    'var W = window, D = document, allow = false;',
    'function q(){ var t = W.tallgrass; return (t && t.puzzle) ? t.puzzle : null; }',
    'function post(m){ try { m.pn = "soko"; parent.postMessage(m, "*"); } catch (e) {} }',
    'function start(){',
    '  var p = q(); if (p && p.rules) return true;',
    '  var b = D.querySelector("[data-action=play]");',   // 属性选择器不加引号：嵌套引号会把字符串截断（踩过）
    '  if (b) { allow = true; try { b.click(); } catch (e) {} allow = false; return true; }',
    '  try { if (p) p.load(0); } catch (e) {}',
    '  return false;',
    '}',
    'function move(dir){',
    '  var p = q(); if (!p) return;',
    '  var m0 = (p.rules && p.rules.moves) || 0;',
    '  try { p.active = true; p.input(dir); } catch (e) {}',
    '  var tries = 0;',
    '  var chk = setInterval(function(){',
    '    tries++;',
    '    var q2 = q();',
    '    var m1 = (q2 && q2.rules && q2.rules.moves) || m0;',
    '    if (m1 > m0 || tries >= 8) { clearInterval(chk); post({ t: "ack", ok: m1 > m0, moves: m1 }); try { q2.active = false; } catch (e) {} }',
    '  }, 110);',
    '  setTimeout(function(){ try { p.active = false; } catch (e) {} }, 500);',
    '}',
    'function load(i){ var p = q(); if (!p) return; try { p.load(i); } catch (e) {} }',
    'function restart(){ var p = q(); if (!p) return; try { p.restart(); } catch (e) {} }',
    // 捕获阶段拦键盘：原作的键盘输入一律不让它自己处理，改成转发给父页面统一派发
    'D.addEventListener("keydown", function(e){',
    '  e.preventDefault(); e.stopPropagation();',
    '  post({ t: "key", key: e.key });',
    '}, true);',
    // 拦住它自己的 UI 按钮（重开/撤销之类），只有我们主动点"开始"时放行
    'D.addEventListener("click", function(e){',
    '  if (allow) return;',
    '  var el = e.target && e.target.closest ? e.target.closest("[data-action]") : null;',
    '  if (el) { e.preventDefault(); e.stopPropagation(); }',
    '}, true);',
    'function tick(){',
    '  start();',
    '  var p = q();',
    '  if (p && p.active) p.active = false;      // 原作的输入只能由我们喂',
    '  var r = p && p.rules;',
    '  if (!r) { post({ t: "st", ready: false }); return; }',
    '  var goals = r.level && r.level.goals;',
    '  var onGoal = 0;',
    '  if (goals && goals.length) {',
    '    for (var i = 0; i < r.boxes.length; i++) {',
    '      var b = r.boxes[i]; if (goals[b.y * r.level.width + b.x]) onGoal++;',
    '    }',
    '  }',
    '  post({ t: "st", ready: true, moves: r.moves, pushes: r.pushes,',
    '         boxes: r.boxes.length, onGoal: onGoal, goals: goals ? goals.length : 0,',
    '         solved: !!p.solved });',
    '}',
    'setInterval(tick, 180); tick();',
    'W.addEventListener("message", function(e){',
    '  var m = e.data || {}; if (!m || m.pn !== "soko") return;',
    '  if (m.t === "move") move(m.dir);',
    '  else if (m.t === "load") load(m.i);',
    '  else if (m.t === "restart") restart();',
    '});',
    '})();'
  ].join('\n');

  var S = {
    frame: null, stage: null, applied: 0, li: -1, ready: false,
    rem: null, sentLevel: -1, ui: null, mounted: false, keySent: 0
  };

  function frameWin() { try { return S.frame && S.frame.contentWindow; } catch (e) { return null; } }
  /** 主动补注入桥接：不依赖 iframe 的 load 事件（实测会踩到竞态，导致桥接根本没进去）。
   *  每 300ms 检查一次，没有就注入 —— 同时也是自愈（原作重载后桥接会重装）。 */
  function ensureBridge() {
    var w = frameWin(), d = null;
    if (!w) return;
    try { d = S.frame.contentDocument; } catch (e) { S.injectErr = String(e && e.message); return; }
    if (!d || !d.body) return;
    if (w.__pnBridge) return;
    try {
      var sc = d.createElement('script');
      sc.textContent = BRIDGE;
      d.body.appendChild(sc);
      S.injected = (S.injected || 0) + 1;
    } catch (e) { S.injectErr = String(e && e.message); }
  }
  function bpost(m) {
    var w = frameWin(); if (!w) return;
    try { w.postMessage(Object.assign({ pn: 'soko' }, m), '*'); } catch (e) {}
  }
  /** 把权威日志重放进原作（含换关/重来） */
  function applyLog() {
    var ui = S.ui, g = ui && ui.state && ui.state.g;
    if (!ui || !g || !S.ready) return;
    if (g.li !== S.li) { S.li = g.li; S.applied = 0; bpost({ t: 'load', i: g.li }); }
    if (g.log.length < S.applied) {            // 重来：日志被清空
      S.applied = 0; bpost({ t: 'restart' });
    }
    if (S.applied < g.log.length) {
      var wait = Date.now() - (S.sentAt || 0);
      if (!S.sentAt) { S.sentAt = Date.now(); S.tries = 0; bpost({ t: 'move', dir: g.log[S.applied] }); }
      else if (wait > 900) {
        S.tries = (S.tries || 0) + 1;
        if (S.tries > 4) { S.applied++; S.sentAt = 0; S.tries = 0; }
        else { S.sentAt = Date.now(); bpost({ t: 'move', dir: g.log[S.applied] }); }
      }
    }
  }

  function onBridge(m) {
    var ui = S.ui, g = ui && ui.state && ui.state.g;
    if (!g) return;
    if (m.ready && !S.ready) { S.ready = true; S.li = -1; applyLog(); }
    if (!m.ready) { S.ready = false; return; }
    if (m.t === 'ack') {
      if (m.ok) { S.applied++; S.sentAt = 0; S.tries = 0; }
      else { S.sentAt = 0; }
      return;
    }
    S.rem = m;
    var mine = g.players[g.turnIdx] === ui.pid();
    var info = document.getElementById('sk-info');
    if (info) info.textContent = '步 ' + m.moves + ' · 推 ' + m.pushes + ' · 归位 ' + m.onGoal + '/' + m.goals;
    if (m.solved && S.sentLevel !== g.li + 1) {         // 由解开这一关的那位上报（房主侧会校验）
      S.sentLevel = g.li + 1;
      ui.send({ t: 'level', i: g.li + 1 });
    }
    var solved = document.getElementById('sk-solved');
    if (solved) solved.textContent = m.solved ? '✅ 全部归位' : '';
    if (!mine) return;
  }

  /** 就地更新（绝不重建 DOM） */
  function sync(state) {
    var ui = S.ui = this;
    var g = state.g || {};
    var me = ui.pid ? ui.pid() : null;
    var myTurn = g.phase === 'play' && g.players && g.players[g.turnIdx] === me;
    var opp = (g.players || []).filter(function (id) { return id !== me; })[0];
    var oppP = opp && ui.p ? ui.p(opp) : null;
    var turn = document.getElementById('sk-turn');
    if (turn) {
      turn.className = 'sk-turn' + (myTurn ? ' mine' : '');
      turn.innerHTML = myTurn
        ? '<b>🙋 轮到你推一步</b><span>把箱子都推到花点上（原作画面，我们只加了轮流出手）</span>'
        : '<b>👀 等 ' + esc(oppP ? oppP.name : '对方') + ' 推</b><span>同一头鲸鱼，他推完就到你</span>';
    }
    var hud = document.getElementById('sk-hud');
    if (hud) {
      hud.innerHTML =
        '<span class="sk-stat"><i>📕</i>第 ' + ((g.li || 0) + 1) + '/' + (g.levels || 5) + ' 关</span>' +
        '<span class="sk-stat"><i>🫸</i>我方日志 ' + (g.log || []).length + ' 步</span>' +
        '<span class="sk-stat"><i>✅</i>' + (g.cleared || 0) + '/' + (g.levels || 0) + '</span>' +
        '<span class="sk-stat" id="sk-info">同步中…</span>';
    }
    document.querySelectorAll('[data-dir]').forEach(function (b) { b.disabled = !myTurn; });
    applyLog();
    return true;
  }

  PN.screens = PN.screens || {};
  PN.screens.soko = {
    name: 'soko',
    debug: function () { return { ready: S.ready, applied: S.applied, li: S.li, injected: S.injected || 0, injectErr: S.injectErr || null, rem: S.rem }; },
    /** 恒返回真：游玩期间绝不重建 DOM（重建会把 iframe 挪走 → 原作重新加载） */
    patch: function (state) {
      if (!S.frame || !state.g || state.g.phase === 'over' || state.mode !== 'soko') return false;
      sync.call(this, state);
      return true;
    },
    render: function (state, secret) {
      var ui = this;
      var GC = PN.gameCommon;
      var g = state.g || {};
      var me = ui.pid();
      var myTurn = g.phase === 'play' && g.players && g.players[g.turnIdx] === me;
      var opp = (g.players || []).filter(function (id) { return id !== me; })[0];
      var oppP = opp ? ui.p(opp) : null;
      var wrap = ui.el('div');
      ui.renderTopbar(wrap);
      wrap.appendChild(ui.h(GC.gameHeader(ui, state, '🐳 鲸鱼推箱子（合作）',
        g.phase === 'over' ? '本局结束' : (myTurn ? '轮到你' : '等对方'),
        '<span class="pill">原作整包复用</span>')));

      var body = ui.el('div');
      if (g.phase === 'over') {
        var title = g.win ? '一起通关啦！🎉' : '这局先到这儿～';
        body.appendChild(ui.h('<div class="card center sk-hero"><div class="sk-result">' + esc(title) + '</div>' +
          '<div class="muted mt8">一起通了 ' + (g.cleared || 0) + ' 关 · 双方各 +' + ((g.cleared || 0) * 2) + ' 分</div></div>'));
        body.appendChild(ui.h(GC.scoreboard(state, undefined, '🏆 总积分')));
        var btns = ui.h(GC.overButtons(ui, 'soko'));
        body.appendChild(btns);
        PN.wireOver(btns, ui);
      } else {
        body.appendChild(ui.h('<div class="sk-turn" id="sk-turn"></div>'));
        body.appendChild(ui.h('<div class="sk-hud" id="sk-hud"></div>'));

        var stage = ui.el('div', 'sk-stage');
        var frame = S.frame || (S.frame = ui.el('iframe', 'sk-frame'));
        frame.setAttribute('allow', 'autoplay');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        stage.appendChild(frame);
        body.appendChild(stage);
        body.appendChild(ui.h('<div class="muted center mt8">方向键 / WASD / 下面十字键 · 走不动不算一步</div>'));

        var pad = ui.el('div', 'sk-pad');
        var mk = function (dir, label, cls2) {
          var b = ui.el('button', 'btn ' + (cls2 || 'ghost') + ' sk-key', label);
          b.setAttribute('data-dir', dir);
          b.disabled = !myTurn;
          b.addEventListener('click', function () { ui.send({ t: 'move', dir: dir }); });
          return b;
        };
        pad.appendChild(mk('up', '⬆️', 'primary'));
        var row3 = ui.el('div', 'sk-pad-row');
        row3.appendChild(mk('left', '⬅️'));
        var rs = ui.el('button', 'btn ghost sk-key', '🔄');
        rs.setAttribute('data-reset', '1');
        rs.title = '重来本关';
        rs.addEventListener('click', function () { ui.send({ t: 'reset' }); });
        row3.appendChild(rs);
        row3.appendChild(mk('right', '➡️'));
        pad.appendChild(row3);
        pad.appendChild(mk('down', '⬇️', 'primary'));
        body.appendChild(pad);

        S.ui = ui; S.applied = 0; S.ready = false; S.li = -1; S.sentLevel = -1;
        var base0 = ui.local('pn_sokobase') || '';
        var mount = function (base) {
          if (!base) { ui.toast('原作文件没找到（要从仓库根目录打开，见 README）', 'info'); return; }
          frame.src = base + 'plus-2265f7c6/index.html';
          frame.addEventListener('load', function () {
            try {
              var doc = frame.contentDocument;
              if (!doc) return;
              // 注入桥接：原封不动调用原作自己的 window.tallgrass
              var sc = doc.createElement('script');
              sc.textContent = BRIDGE;
              doc.body.appendChild(sc);
            } catch (e) { ui.toast('桥接注入失败：' + e.message, 'info'); }
          });
        };
        if (base0) mount(base0);
        else if (ui.miniBase) ui.miniBase(mount);
        else mount('../mini/');

        if (!S.poller) {
          S.poller = setInterval(function () { ensureBridge(); applyLog(); }, 300);
        }
        if (!S.mounted) {
          S.mounted = true;
          root.addEventListener('message', function (e) {
            var w = frameWin();
            if (!w || e.source !== w) return;
            var m = e.data || {};
            if (!m || m.pn !== 'soko') return;
            if (m.t === 'st') onBridge(m);
            else if (m.t === 'key') {
              var map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', W: 'up', S: 'down', A: 'left', D: 'right' };
              var dir = map[m.key];
              if (!dir) return;
              var st = S.ui && S.ui.state;
              if (!st || !st.g || st.g.phase !== 'play') return;
              if (st.g.players[st.g.turnIdx] !== S.ui.pid()) return;      // 不是你的回合，按键无效
              if (Date.now() - S.keySent < 120) return;                   // 防抖
              S.keySent = Date.now();
              S.ui.send({ t: 'move', dir: dir });
            }
          });
        }
        sync.call(ui, state);
      }
      wrap.appendChild(body);
      if (state.phase !== 'over') wrap.appendChild(ui.renderGameFooter());
      return wrap;
    },

    /** 离开屏幕时收摊：全局 poller 不清掉的话，它会继续去读**下一个游戏**的 state.g，
     *  当场抛 TypeError（围棋的 g 没有 log 字段），而且此后每款游戏都抛。见 ui.js setScreen。 */
    stop: function () {
      if (S.poller) { clearInterval(S.poller); S.poller = null; }
      S.ui = null; S.win = null;
      S.ready = false; S.mounted = false;
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
