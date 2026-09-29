// 存档是这仓里唯一会写盘的东西，也是 README「换设备、清缓存之前先复制一份」那句话的落点。
// 以前这句话没有任何用例守着：js/core/storage.js 读的是全局 localStorage，node 里没有，
// 于是所有人都默认"它大概没问题"。这里用假 localStorage 把它接上，量四件事：
//   1) 盘上的形状 == 内存里的形状（坏盘、半截盘要能回落，不能崩给玩家看）；
//   2) best 只会变小、solves 只会变大（记分只会让人往好的方向走，这是评星的依据）；
//   3) 连续天数按日历日而不是按 24 小时（隔一天必须断，同一天第二次不加）；
//   4) exportText → importText 在"另一台机器"上还原出逐字节相同的进度 —— 那句承诺的全部内容。
// 每个用例都 import 一份带 ?v= 的新模块：模块里有 cache，同进程里复用会让上一条用例的
// 内存状态冒充"从盘上读回来的"。

import test from 'node:test';
import assert from 'node:assert/strict';

const KEY = 'nikoli.save.v1';

// 一台"设备"：一块盘 + 一份全新的模块实例
async function device(tag) {
  const disk = new Map();
  globalThis.localStorage = {
    getItem: (k) => (disk.has(k) ? disk.get(k) : null),
    setItem: (k, v) => disk.set(k, String(v)),
    removeItem: (k) => disk.delete(k),
  };
  const mod = await import(`../js/core/storage.js?v=${encodeURIComponent(tag)}`);
  return { store: mod.store, disk, raw: () => disk.get(KEY) };
}

test('空盘第一次读就是完整形状，而且写出去的就是内存里那一份', async () => {
  const { store, raw } = await device('shape');
  assert.deepEqual(store.statsObj(), { solves: 0, noHint: 0, hints: 0 });
  assert.deepEqual(store.settings, { sound: true, reduceMotion: false });
  assert.equal(store.record('nonogram:10'), null);
  assert.equal(store.totalSolves(), 0);
  store.set('sound', false);                       // 只有写过才该落盘
  const onDisk = JSON.parse(raw());
  assert.equal(onDisk.settings.sound, false, '设置只改了缓存没落盘：刷新就丢');
  assert.deepEqual(Object.keys(onDisk).sort(), ['daily', 'records', 'settings', 'stats', 'streak']);
});

test('best 只会变小、solves 只会变大：更差的一局改不动纪录', async () => {
  const { store } = await device('best');
  const a = store.finish('tents:8', { ms: 5000, moves: 24, hints: 0 });
  assert.deepEqual(a, { solves: 1, noHintSolves: 1, bestMs: 5000, bestMoves: 24 });
  const b = store.finish('tents:8', { ms: 9000, moves: 40, hints: 3 });
  assert.equal(b.solves, 2, '局数要累加');
  assert.equal(b.noHintSolves, 1, '用了提示的那局不配进"无提示"计数');
  assert.equal(b.bestMs, 5000, '慢的一局把最佳用时改坏了');
  assert.equal(b.bestMoves, 24, '多走的一局把最佳步数改坏了');
  assert.deepEqual(store.statsObj(), { solves: 2, noHint: 1, hints: 3 });
  const c = store.finish('tents:8', { ms: 4000, moves: 20, hints: 0 });
  assert.equal(c.bestMs, 4000, '更好的一局必须写下新纪录');
  assert.equal(c.bestMoves, 20);
  assert.equal(store.record('tents:8').bestMs, 4000, 'record() 读回来的必须是同一条账');
});

test('连续天数吃的是日历日：同一天第二次不加，隔一天就断', async () => {
  const { store } = await device('streak');
  assert.equal(store.streak('2026-09-27').count, 0);
  assert.equal(store.streak('2026-09-27').alive, false, '一天都没解过，谈不上 alive');
  assert.equal(store.markDaily('2026-09-27', 'nonogram'), 1, '第一天该把连续数起成 1');
  assert.equal(store.markDaily('2026-09-27', 'tents'), 0, '同一天再解一款不能再加');
  assert.deepEqual(Object.keys(store.dailyDone('2026-09-27')).sort(), ['nonogram', 'tents']);
  assert.equal(store.markDaily('2026-09-28', 'nonogram'), 2, '昨天解过，今天续上');
  // "活着"的口径是到第二天为止：过完 09-28 的当天和 09-29 都还接着，09-30 就断了。
  assert.equal(store.streak('2026-09-29').alive, true, '跨过午夜就把连续天数判死，是错的口径');
  assert.equal(store.streak('2026-09-30').alive, false, '隔了两天还说活着就是说谎');
  assert.equal(store.markDaily('2026-10-01', 'nonogram'), 1, '断了要重头数，不能加在 2 上');
  assert.equal(store.streak('2026-10-01').best, 2, '历史最长要留在 2');
  // 跨月末：8-31 与 9-01 是相邻的两个日历日，dayBefore 若是"减 24 小时"就会在这里判断
  store.markDaily('2026-08-31', 'slant');
  assert.equal(store.markDaily('2026-09-01', 'slant'), 2, '跨月的 dayBefore 算错了');
});

test('导出去另一台机器：进度逐字节还原，含最佳用时与连续天数', async () => {
  const a = await device('export-a');
  a.store.finish('nonogram:15', { ms: 60000, moves: 200, hints: 0 });
  a.store.finish('nonogram:15', { ms: 55000, moves: 180, hints: 2 });
  a.store.markDaily('2026-09-28', 'nonogram');
  a.store.set('reduceMotion', true);
  const text = a.store.exportText();

  const b = await device('export-b');
  b.store.finish('nonogram:15', { ms: 1000, moves: 10, hints: 0 });   // 先有一坨别的进度
  b.store.importText(text);
  assert.deepEqual(b.store.record('nonogram:15'), a.store.record('nonogram:15'));
  assert.deepEqual(b.store.statsObj(), a.store.statsObj());
  assert.deepEqual(b.store.dailyDone('2026-09-28'), a.store.dailyDone('2026-09-28'));
  assert.deepEqual(b.store.settings, a.store.settings);
  assert.equal(b.store.streak('2026-09-29').count, 1);
  assert.equal(JSON.parse(b.raw()).records['nonogram:15'].bestMs, 55000, '导回来的没写进盘');
});

test('导入要认得出垃圾：不是存档的文本必须当场拒，不许半截生效', async () => {
  const { store, raw } = await device('reject');
  store.finish('slant:10', { ms: 3000, moves: 100, hints: 0 });
  const before = raw();
  for (const junk of ['', 'not json', '{}', '[]', 'null', '{"records":null}']) {
    assert.throws(() => store.importText(junk), undefined, `这句居然收下了：${JSON.stringify(junk)}`);
  }
  assert.equal(raw(), before, '被拒绝的导入把盘改了');
  assert.equal(store.record('slant:10').bestMs, 3000, '被拒绝的导入把内存里的进度换了');
});

test('盘上是坏的或半截的也要能玩：回落成可用形状，落子与通关都不抛', async () => {
  for (const [tag, junk] of [
    ['corrupt', '{"records":'],                       // 截断的 JSON
    ['garbage', 'hello world'],                       // 根本不是 JSON
    ['half', '{"records":{"tents:6":{"solves":3}}}'], // 只有 records，别的键都缺
    ['wrongtype', '{"records":7,"settings":"loud"}'], // 类型全错：曾经在这里把通关当场炸掉
    ['asarray', '{"records":[1,2],"daily":"x"}'],     // 数组不是记录表
  ]) {
    const disk = new Map([[KEY, junk]]);
    globalThis.localStorage = {
      getItem: (k) => (disk.has(k) ? disk.get(k) : null),
      setItem: (k, v) => disk.set(k, String(v)),
      removeItem: (k) => disk.delete(k),
    };
    const mod = await import(`../js/core/storage.js?v=${tag}`);
    const st = mod.store.statsObj();
    assert.equal(typeof st.solves, 'number', `${tag}: stats 没回落成数字`);
    assert.equal(st.solves >= 0, true);
    // 这一句同时钉住两件事：半截盘里那条真的纪录要留下，其余几种坏盘都得读不出记录。
    assert.equal(JSON.stringify(mod.store.record('tents:6')),
      JSON.stringify(tag === 'half' ? { solves: 3 } : null), `${tag}: records 的回落不对`);
    assert.deepEqual(Object.keys(mod.store.settings).sort(), ['reduceMotion', 'sound'], `${tag}: settings 形状不对`);
    mod.store.set('sound', false);                    // 坏了也要能继续写
    assert.equal(JSON.parse(disk.get(KEY)).settings.sound, false, `${tag}: 修不回来，下次还是崩`);
    // 真正的承诺：这一局打完要记得住，不是"读的时候不抛就算"。
    const cur = mod.store.finish('nonogram:5', { ms: 100, moves: 20, hints: 0 });
    assert.equal(cur.solves, 1, `${tag}: 通关记账炸了`);
    assert.equal(JSON.parse(disk.get(KEY)).records['nonogram:5'].solves, 1, `${tag}: 新成绩没落盘`);
  }
});

test('导入框里的垃圾必须当场拒绝：{"records":7} 这种"看着像"的也不行', async () => {
  const { store } = await device('import-junk');
  for (const junk of ['{"records":7}', '{"records":[]}', '{"records":"x"}', '[]', '{"records":null}']) {
    assert.throws(() => store.importText(junk), undefined, `这句居然收下了：${junk}`);
  }
  store.importText('{"records":{"slant:6":{"solves":2}}}');   // 合规的那句要能进
  assert.equal(store.record('slant:6').solves, 2);
  assert.deepEqual(store.statsObj(), { solves: 0, noHint: 0, hints: 0 }, '缺 stats 时不该凭空造数');
});

test('reset 真清盘，不是只把缓存抹了', async () => {
  const { store, raw } = await device('reset');
  store.finish('hitori:8', { ms: 2000, moves: 12, hints: 0 });
  store.markDaily('2026-09-28', 'hitori');
  assert.ok(raw());
  store.reset();
  const after = JSON.parse(raw());
  assert.deepEqual(after.records, {}, '盘上还留着成绩');
  assert.deepEqual(after.daily, {}, '盘上还留着每日记录');
  assert.equal(after.stats.solves, 0);
  assert.equal(store.totalSolves(), 0, '缓存里还数着旧局数');
  assert.equal(store.streak('2026-09-29').alive, false);
});

test('隐身模式（setItem 抛错）不许把游戏带崩', async () => {
  const disk = new Map();
  globalThis.localStorage = {
    getItem: () => { throw new Error('SecurityError'); },
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => {},
  };
  const mod = await import('../js/core/storage.js?v=private');
  assert.deepEqual(mod.store.statsObj(), { solves: 0, noHint: 0, hints: 0 });
  mod.store.finish('pegsolitaire:33', { ms: 1000, moves: 31, hints: 0 });   // 必须只是存不住
  mod.store.set('sound', false);
  assert.equal(disk.size, 0, '写不进去却往内存里塞了东西');
  assert.equal(mod.store.record('pegsolitaire:33').solves, 1, '本局内存里的账还是要记');
});
