/* ===== v4 传输层：统一信封 + 墨迹分块序号 + 丢包补发 =====
 *
 * 为什么需要它：公共 broker 是 QoS0（尽力送达）。画笔数据以前每 55ms 一块，
 * 块与块之间既没有序号也没有补发 —— 丢一块就在对端留下一个永久缺口，
 * 只能靠「不连线」掩盖，看起来就是断笔/藕断丝连/别人看不到。
 *
 * 现在的规则：每一块都带「本块第一个点在整笔中的下标 i0」。
 * 接收端把点写进稀疏数组 —— 有没有缺、缺哪几个，一眼就能看出来；
 * 发现空洞就向发送者要一次补发，空洞填上后整笔重绘一遍。
 * 因为按 i0 落位，补发的块即使晚到、乱序到，也不会把笔画写歪。
 */
(function (root) {
  'use strict';
  var PN = root.PN = root.PN || {};

  var V = 4; // 协议版本：版本不匹配的消息整条丢弃，老实现不会把新消息解释错

  /** 所有跨端消息都过这里，统一带上版本号与（可选的）轮次 */
  function pack(ch, obj, round) {
    obj.v = V;
    obj.ch = ch;
    if (round !== undefined && round !== null) obj.r = round;
    return obj;
  }
  function isV4(msg) { return !!msg && msg.v === V; }

  /* ---------------- 发送端：记住最近几笔的已发分块，供对端缺号时补发 ---------------- */
  function Out(keepStrokes) {
    this.byStroke = {};
    this.order = [];
    this.keep = keepStrokes || 4; // 只留最近几笔，更早的没人会再要
    this.seq = 0;
    this.dropped = 0;             // 自测用：人为丢包计数（正常玩法恒为 0）
  }
  /** 把一段点打包成可分块传输的消息；i0 = 这段第一个点在整笔中的下标 */
  Out.prototype.pack = function (id, i0, pts, meta) {
    var msg = { t: 'stroke', id: id, i0: i0, s: pts, seq: ++this.seq };
    if (meta) for (var k in meta) if (Object.prototype.hasOwnProperty.call(meta, k)) msg[k] = meta[k];
    var st = this.byStroke[id];
    if (!st) {
      st = this.byStroke[id] = { id: id, chunks: [] };
      this.order.push(id);
      while (this.order.length > this.keep) { var old = this.order.shift(); delete this.byStroke[old]; }
    }
    st.chunks.push(msg);
    return msg;
  };
  /** 补发：某笔里所有「覆盖到 fromIdx 及之后」的块 */
  Out.prototype.missing = function (id, fromIdx) {
    var st = this.byStroke[id];
    if (!st) return [];
    var out = [];
    for (var i = 0; i < st.chunks.length; i++) {
      var c = st.chunks[i];
      if (c.i0 + c.s.length > fromIdx) out.push(c);
    }
    return out;
  };
  Out.prototype.reset = function () { this.byStroke = {}; this.order = []; this.seq = 0; };

  /* ---------------- 接收端：按 i0 落位，返回「连续前缀长度」和「空洞」 ---------------- */
  /**
   * @param pts  稀疏点数组（按整笔下标存放）
   * @param have 当前连续前缀长度（pts[0..have-1] 都是齐的）
   * @param msg  收到的块
   * @returns {{have:number, gap:number[]|null, first:number, last:number}}
   *          gap = [fromIdx, toIdx] 表示中间缺了这一段，需要向发送者补发
   */
  function place(pts, have, msg) {
    var s = msg.s || [];
    var i0 = msg.i0 || 0; // 没有 i0 就当下标 0：老格式消息不能把稀疏数组写成 pts[NaN]
    for (var k = 0; k < s.length; k++) pts[i0 + k] = s[k];
    var gap = i0 > have ? [have, i0 - 1] : null;
    var h = have;
    while (h < pts.length && pts[h] !== undefined) h++;
    return { have: h, gap: gap, first: i0, last: i0 + s.length - 1 };
  }

  PN.Wire = { V: V, pack: pack, isV4: isV4, Out: Out, place: place };
})(typeof globalThis !== 'undefined' ? globalThis : this);
