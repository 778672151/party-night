// 手动泵送计时器：after/every 只入队，pump(name) 手动触发（宿主游戏逻辑用）
export function makeClock(host) {
  let q = [];
  const patch = {
    after(name, ms, fn) { host.timers[name] = { fake: true }; q.push({ name, fn }); },
    every(name, ms, fn) { host.timers[name] = { fake: true }; q.push({ name, fn }); },
    clearTimer(name) {
      delete host.timers[name];
      q = q.filter(t => t.name !== name);
    }
  };
  host.after = patch.after.bind(host);
  host.every = patch.every.bind(host);
  host.clearTimer = patch.clearTimer.bind(host);
  return {
    queue: () => q,
    pump(name) {
      const i = q.findIndex(t => t.name === name);
      if (i < 0) throw new Error('没有计时器: ' + name + '（现有: ' + q.map(t => t.name).join(',') + '）');
      const t = q.splice(i, 1)[0];
      t.fn();
      return true;
    },
    has(name) { return q.some(t => t.name === name); }
  };
}
