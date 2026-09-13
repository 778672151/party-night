/* audio.js — 纯 WebAudio 程序化音效 + BGM，无外部资源 */
(function (G) {
  'use strict';
  var ctx = null, master, sfxG, musG, comp, noiseBuf, ready = false, muted = false, volScale = 1;
  function AC() { return typeof AudioContext !== 'undefined' ? AudioContext : (typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null); }
  function init() {
    if (ready) return true;
    var C = AC(); if (!C) return false;
    try { ctx = new C(); } catch (e) { return false; }
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 24; comp.ratio.value = 8; comp.attack.value = .003; comp.release.value = .18;
    master = ctx.createGain(); master.gain.value = .85;
    sfxG = ctx.createGain(); sfxG.gain.value = 1;
    musG = ctx.createGain(); musG.gain.value = .34;
    sfxG.connect(comp); musG.connect(comp); comp.connect(master); master.connect(ctx.destination);
    var n = ctx.sampleRate * 2; noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    var dat = noiseBuf.getChannelData(0);
    for (var i = 0; i < n; i++) dat[i] = Math.random() * 2 - 1;
    ready = true; return true;
  }
  function t0() { return ctx.currentTime; }
  function noise(o) {
    if (!ready) return;
    var s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    s.playbackRate.value = o.rate || 1;
    var f = ctx.createBiquadFilter(); f.type = o.type || 'bandpass';
    f.frequency.setValueAtTime(o.f0 || 900, t0());
    f.frequency.exponentialRampToValueAtTime(Math.max(40, o.f1 || o.f0 || 900), t0() + (o.dur || .1));
    f.Q.value = o.q === undefined ? 1.2 : o.q;
    var g = ctx.createGain(); var d = o.dur || .1, a = o.atk === undefined ? .002 : o.atk;
    g.gain.setValueAtTime(0, t0());
    g.gain.linearRampToValueAtTime((o.gain === undefined ? .3 : o.gain) * volScale, t0() + a);
    g.gain.exponentialRampToValueAtTime(.0006, t0() + d);
    s.connect(f); f.connect(g); g.connect(o.dest || sfxG);
    s.start(); s.stop(t0() + d + .02);
  }
  function tone(o) {
    if (!ready) return;
    var s = ctx.createOscillator(); s.type = o.type || 'sine';
    var d = o.dur || .12;
    s.frequency.setValueAtTime(o.f0 || 220, t0());
    if (o.f1) s.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0() + d);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t0());
    g.gain.linearRampToValueAtTime((o.gain === undefined ? .25 : o.gain) * volScale, t0() + (o.atk === undefined ? .004 : o.atk));
    g.gain.exponentialRampToValueAtTime(.0005, t0() + d);
    var last = g;
    if (o.lp) { var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; g.connect(f); last = f; }
    s.connect(g); last.connect(o.dest || sfxG);
    s.start(); s.stop(t0() + d + .02);
  }
  /* —— 音效表 —— */
  var SFX = {
    whiffL: function () { noise({ type: 'bandpass', f0: 2600, f1: 700, q: 1.1, dur: .1, gain: .12 }); },
    whiffH: function () { noise({ type: 'bandpass', f0: 1500, f1: 320, q: .9, dur: .19, gain: .2 }); },
    hitL: function () { noise({ type: 'bandpass', f0: 2000, f1: 500, q: .8, dur: .07, gain: .34 }); tone({ type: 'triangle', f0: 210, f1: 90, dur: .09, gain: .3 }); },
    hitM: function () { noise({ type: 'bandpass', f0: 1400, f1: 260, q: .7, dur: .12, gain: .45 }); tone({ type: 'triangle', f0: 150, f1: 55, dur: .16, gain: .45 }); },
    hitH: function () {
      noise({ type: 'lowpass', f0: 1800, f1: 180, q: .6, dur: .2, gain: .6 });
      tone({ type: 'sine', f0: 120, f1: 38, dur: .3, gain: .6 });
      tone({ type: 'square', f0: 330, f1: 90, dur: .07, gain: .12, lp: 2400 });
    },
    guard: function () { noise({ type: 'highpass', f0: 3200, f1: 1800, q: .5, dur: .12, gain: .3 }); tone({ type: 'square', f0: 620, f1: 380, dur: .08, gain: .1, lp: 3000 }); },
    guardCrush: function () { noise({ type: 'bandpass', f0: 900, f1: 200, q: .5, dur: .4, gain: .5 }); tone({ type: 'sawtooth', f0: 300, f1: 60, dur: .5, gain: .3, lp: 1200 }); },
    jump: function () { noise({ type: 'highpass', f0: 900, f1: 2600, q: .6, dur: .12, gain: .1 }); },
    land: function () { noise({ type: 'lowpass', f0: 700, f1: 120, q: .5, dur: .16, gain: .28 }); },
    dash: function () { noise({ type: 'bandpass', f0: 700, f1: 2400, q: .8, dur: .16, gain: .14 }); },
    roll: function () { noise({ type: 'lowpass', f0: 1200, f1: 300, q: .5, dur: .26, gain: .18 }); },
    fire: function () { noise({ type: 'bandpass', f0: 400, f1: 1500, q: .5, dur: .35, gain: .3 }); tone({ type: 'sawtooth', f0: 90, f1: 260, dur: .3, gain: .18, lp: 1400 }); },
    burn: function () { noise({ type: 'bandpass', f0: 700, f1: 180, q: .4, dur: .5, gain: .35 }); tone({ type: 'sine', f0: 70, f1: 30, dur: .5, gain: .4 }); },
    explode: function () { noise({ type: 'lowpass', f0: 2400, f1: 80, q: .4, dur: .55, gain: .6 }); tone({ type: 'sine', f0: 90, f1: 28, dur: .6, gain: .5 }); },
    superFlash: function () { tone({ type: 'sawtooth', f0: 120, f1: 1800, dur: .5, gain: .22, lp: 4000 }); noise({ type: 'highpass', f0: 400, f1: 5000, q: .4, dur: .5, gain: .22 }); },
    ko: function () { tone({ type: 'sine', f0: 200, f1: 32, dur: .9, gain: .55 }); noise({ type: 'lowpass', f0: 1600, f1: 60, q: .4, dur: .8, gain: .45 }); },
    meter: function () { tone({ type: 'square', f0: 520, f1: 1200, dur: .14, gain: .07, lp: 4000 }); },
    bell: function () { tone({ type: 'sine', f0: 1180, f1: 1180, dur: .5, gain: .18 }); tone({ type: 'sine', f0: 1760, f1: 1740, dur: .35, gain: .1 }); },
    menu: function () { tone({ type: 'square', f0: 700, f1: 900, dur: .05, gain: .08, lp: 3000 }); },
    ok: function () { tone({ type: 'square', f0: 600, f1: 1400, dur: .16, gain: .1, lp: 4000 }); },
    voiceL: function () { voice(300, 560, .16); },
    voiceH: function () { voice(200, 380, .3); },
    voiceHit: function () { voice(240, 180, .22); },
    voiceKO: function () { voice(180, 120, .55); }
  };
  function voice(f0, f1, dur) {
    if (!ready) return;
    var s = ctx.createOscillator(); s.type = 'sawtooth';
    s.frequency.setValueAtTime(f0, t0()); s.frequency.exponentialRampToValueAtTime(f1, t0() + dur * .8);
    var fm = ctx.createBiquadFilter(); fm.type = 'bandpass'; fm.frequency.value = 780; fm.Q.value = 4;
    var fm2 = ctx.createBiquadFilter(); fm2.type = 'bandpass'; fm2.frequency.value = 1240; fm2.Q.value = 6;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0, t0()); g.gain.linearRampToValueAtTime(.16 * volScale, t0() + .02);
    g.gain.exponentialRampToValueAtTime(.0006, t0() + dur);
    s.connect(fm); fm.connect(fm2); fm2.connect(g); g.connect(sfxG);
    s.start(); s.stop(t0() + dur + .03);
  }
  /* —— BGM —— */
  var mus = { on: false, step: 0, next: 0, bpm: 152, timer: null };
  var BASS = [0, 0, 7, 0, 3, 0, 7, 10];
  var LEAD = [12, 15, 19, 22, 19, 15, 14, 15, 12, 15, 19, 24, 22, 19, 15, 12];
  function nfreq(semi) { return 82.41 * Math.pow(2, semi / 12); }
  function schedule() {
    if (!ready || !mus.on) return;
    var spb = 60 / mus.bpm / 4;
    while (mus.next < ctx.currentTime + .18) {
      var s = mus.step % 16, bar = Math.floor(mus.step / 16) % 4, tt = mus.next;
      // kick
      if (s === 0 || s === 6 || s === 10) at(tt, function (t) { mtone('sine', 130, 44, .17, .5, t); mnoise(t, 2600, 400, .02, .12); });
      // snare
      if (s === 4 || s === 12 || (s === 14 && bar % 2 === 1)) at(tt, function (t) { mnoise(t, 1900, 700, .11, .2); });
      // hat
      if (s % 2 === 1) at(tt, function (t) { mnoise(t, 8000, 6000, .035, s % 4 === 3 ? .1 : .055); });
      // bass
      if (s % 2 === 0) { var bn = nfreq(BASS[(s / 2) % 8] + (bar >= 2 ? 5 : 0)); at(tt, function (t) { mtone('sawtooth', bn, bn, .16, .2, t, 420); }); }
      // lead
      if (bar % 2 === 1 && s % 1 === 0) { var ln = nfreq(LEAD[s] + (bar >= 2 ? 5 : 0) + 12); at(tt, function (t) { mtone('square', ln, ln, .085, .06, t, 3200); }); }
      mus.step++; mus.next += spb;
    }
    function at(t, fn) { fn(t); }
  }
  function mtone(type, f0, f1, dur, gain, t, lp) {
    var s = ctx.createOscillator(); s.type = type;
    s.frequency.setValueAtTime(f0, t); if (f1 !== f0) s.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    var g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + .006);
    g.gain.exponentialRampToValueAtTime(.0005, t + dur);
    var last = g;
    if (lp) { var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; g.connect(f); last = f; }
    s.connect(g); last.connect(musG); s.start(t); s.stop(t + dur + .02);
  }
  function mnoise(t, f0, f1, dur, gain) {
    var s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    var f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = .9;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    var g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + .004);
    g.gain.exponentialRampToValueAtTime(.0005, t + dur);
    s.connect(f); f.connect(g); g.connect(musG); s.start(t); s.stop(t + dur + .02);
  }
  G.Audio = {
    init: init,
    get ok() { return ready; },
    play: function (name, vol) {
      if (!ready || muted) return;
      var f = SFX[name]; if (!f) return;
      volScale = vol === undefined ? 1 : vol;
      try { f(); } catch (e) { }
      volScale = 1;
    },
    resume: function () { if (ready && ctx.state === 'suspended') ctx.resume(); },
    music: function (on) {
      if (!init()) return;
      mus.on = on;
      if (on) {
        mus.next = ctx.currentTime + .05; mus.step = 0;
        if (!mus.timer) mus.timer = setInterval(schedule, 40);
      } else if (mus.timer) { clearInterval(mus.timer); mus.timer = null; }
    },
    get musicOn() { return mus.on; },
    toggleMute: function () { muted = !muted; if (ready) master.gain.value = muted ? 0 : .85; return muted; },
    duck: function (v, dur) { if (!ready) return; try { musG.gain.cancelScheduledValues(ctx.currentTime); musG.gain.setValueAtTime(musG.gain.value, ctx.currentTime); musG.gain.linearRampToValueAtTime(.34 * v, ctx.currentTime + .02); musG.gain.linearRampToValueAtTime(.34, ctx.currentTime + (dur || .5)); } catch (e) { } }
  };
})(window.G);
