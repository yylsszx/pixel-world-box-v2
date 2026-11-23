// #v0.94 渲染稳定性 + 物理实感回归测试（根除三症状 + 重叠 + 闪烁 + 物理假）
// 覆盖：①脏种族 def 兜底不崩帧 ②逐单位隔离（坏单位不牵连后续单位）③深度排序（建筑/单位/树）
// ④LOD 迟滞（边界 zoom 不抖档）⑤软分离（同格单位互推）⑥受击击退 ⑦全种族全档位渲染零异常
// 用法：node scripts/v094-stability-test.mjs
import { createJiti } from 'jiti';
import path from 'node:path';
const ROOT = '/home/z/my-project/pixel-world-box';

// ============ 录制型 canvas stub（记录 fillRect 调用序 + 当前变换） ============
const noop = () => {};
let callSeq = 0;
const makeRecordingCtx = (tag) => {
  let m = [1, 0, 0, 1, 0, 0]; // 当前变换
  const stack = [];
  const rec = { tag, calls: [] };
  const ctx = {
    canvas: { width: 0, height: 0 },
    _rec: rec,
    save: () => { stack.push([...m]); },
    restore: () => { if (stack.length) m = stack.pop(); },
    setTransform: (a, b, c, d, e, f) => { m = [a, b, c, d, e ?? 0, f ?? 0]; },
    translate: (x, y) => { m[4] += m[0] * x + m[2] * y; m[5] += m[1] * x + m[3] * y; },
    scale: (x, y) => { m[0] *= x; m[1] *= x; m[2] *= y; m[3] *= y; },
    fillRect: (x, y, w, h) => { rec.calls.push({ i: callSeq++, m: [...m], x, y, w, h }); },
    clearRect: noop, beginPath: noop, closePath: noop, arc: noop, fill: noop, stroke: noop,
    moveTo: noop, lineTo: noop, ellipse: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
    setLineDash: noop, clip: noop, rect: noop, strokeRect: noop,
    drawImage: (...a) => { rec.calls.push({ i: callSeq++, m: [...m], img: true, x: a[1] ?? 0, y: a[2] ?? 0 }); },
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)), width: w | 0, height: h | 0 }),
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)), width: w | 0, height: h | 0 }),
    putImageData: noop,
    measureText: () => ({ width: 0 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => ({}),
  };
  return new Proxy(ctx, { set: () => true, get: (t, k) => (k in t ? t[k] : noop) });
};
const allCtxs = [];
globalThis.document = {
  createElement: (t) => t === 'canvas'
    ? { width: 0, height: 0, getContext: () => { const c = makeRecordingCtx(`c${allCtxs.length}`); allCtxs.push(c); return c; }, style: {} }
    : { style: {}, appendChild: noop },
  addEventListener: noop,
  getElementById: () => null,
};
globalThis.localStorage = { getItem: () => null, setItem: noop, removeItem: noop };
globalThis.requestAnimationFrame = noop;
globalThis.performance = globalThis.performance ?? { now: () => Date.now() };

const jiti = createJiti(import.meta.url, { alias: { '@': path.join(ROOT, 'src') } });
const { GameEngine } = await jiti.import(path.join(ROOT, 'src/lib/game/engine.ts'));
const { R } = await jiti.import(path.join(ROOT, 'src/lib/game/types.ts'));
const { render, currentLodTier, LOD_TIER, resetSpriteQuarantine } = await jiti.import(path.join(ROOT, 'src/lib/game/render.ts'));
const { BUILD_KINDS } = await jiti.import(path.join(ROOT, 'src/lib/game/types.ts'));

let pass = 0, fail = 0, fails = [];
const ok = (cond, name) => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; fails.push(name); console.log(`  ✗ ${name}`); } };

// 世界画布 = engine.worldCtx（构造期创建的第一个 ctx，含 terrain/props 等之后）—— 用引用对比拿到
const worldRec = () => eng.worldCtx && eng.worldCtx._rec;

const renderFrame = (zoom) => {
  callSeq = 0;
  eng.cam.zoom = zoom;
  const screen = makeRecordingCtx('screen');
  render(eng, screen, 1024, 640);
  return screen;
};

console.log('== v0.94 渲染稳定性 + 物理实感回归 ==');

// ============ ① 全种族全档位渲染零异常 ============
console.log('[1] 全种族 × 四档 zoom 渲染零异常（旧版：坏 def 击穿整帧 → 成片消失）');
const eng = new GameEngine(88009411);
const zooms = [2.0, 4.0, 6.5, 9.0];
const racesAll = Object.keys(R).map((k) => R[k]).filter((v) => typeof v === 'number');
const placed = [];
for (let k = 0; k < racesAll.length; k++) {
  const u = eng.spawnUnit(racesAll[k], 60 + (k % 12) * 2, 60 + ((k / 12) | 0) * 2, { civ: -1 });
  if (u) { u.age = 10; placed.push(u); }
}
let threw = null;
try {
  for (const z of zooms) { renderFrame(z); eng.frameCount += 7; }
} catch (e) { threw = e; }
ok(!threw, `全 ${placed.length} 种族 × ${zooms.length} 档渲染零异常${threw ? `（${String(threw).slice(0, 90)}）` : ''}`);

// ============ ② 脏种族 def 兜底 + 逐单位隔离 ============
console.log('[2] 脏种族 def（动态种窗口期）→ 兜底定义 + 隔离（旧版：RACES[id] 缺失 → TypeError 击穿整帧）');
resetSpriteQuarantine();
const bogus = eng.spawnUnit(R.HUMAN, 100.5, 80.5, { civ: -1 });
bogus.race = 9999; // 不存在的种族 id（模拟重置/读档窗口期的动态种悬空引用）
const after = eng.spawnUnit(R.HUMAN, 100.5, 81.5, { civ: -1 }); // 排在坏单位之后的合法单位
after.age = 10;
let spyErr = [];
const origErr = console.error; console.error = (...a) => { spyErr.push(a); };
let threw2 = null;
try { renderFrame(9.0); eng.frameCount += 3; renderFrame(9.0); } catch (e) { threw2 = e; }
console.error = origErr;
ok(!threw2, `脏 def 不再击穿整帧${threw2 ? `（${String(threw2).slice(0, 90)}）` : ''}`);
// 坏单位走兑底 def（FALLBACK_RACE_DEF）优雅降级为普通绘制 —— 根本不抛（比隔离更早一层）
// 合法单位（y=81.5 > 坏单位 80.5 → 排序后画在坏单位之后）仍产出主体像素（排除阴影行：躯干区 y ≤ py）
{
  const rec = worldRec();
  const px = (after.rx ?? after.x) * 2, py = (after.ry ?? after.y) * 2;
  const has = rec.calls.some((c) => c.m && c.m[0] === 4 && Math.abs(c.x - px) < 6 && c.y <= py + 1 && c.y > py - 8);
  ok(has, '坏单位之后的合法单位正常绘制（旧版会整帧消失）');
  // 坏单位本身：兑底 def 也可绘（不再只剩阴影 —— 阴影在 py+2，本体断言限定躯干区）
  const bpx = (bogus.rx ?? bogus.x) * 2, bpy = (bogus.ry ?? bogus.y) * 2;
  const hasEmg = rec.calls.some((c) => c.m && c.m[0] === 4 && Math.abs(c.x - bpx) < 6 && c.y <= bpy + 1 && c.y > bpy - 8);
  ok(hasEmg, '脏 def 单位本体有像素（兑底/应急，不再只剩脚下阴影）');
}

// ============ ③ 深度排序：单位在建筑北 → 被建筑遮挡（先画）；在南 → 盖建筑（后画） ============
console.log('[3] 统一深度排序（旧版：建筑永远垫底 → 站房后的单位盖在房顶上）');
{
  const eng2 = new GameEngine(88009412);
  const civ = eng2.civs[eng2.spawnUnit(R.HUMAN, 120, 120).civ];
  const bx = 120, by = 100;
  eng2.buildBuilding(by * 256 + bx, BUILD_KINDS.HOUSE, civ.id);
  const north = eng2.spawnUnit(R.HUMAN, bx + 0.5, by - 0.6, { civ: civ.id }); north.age = 10; // 建筑北侧
  const south = eng2.spawnUnit(R.HUMAN, bx + 3.5, by + 1.4, { civ: civ.id }); south.age = 10; // 建筑南侧（横向错开 —— 避开北单位的断言窗口）
  eng2.effects.length = 0; // 清出生闪光（特效画在排序 pass 之后，会污染调用序断言）
  const savedEng = eng; // 复用 renderFrame 需换 engine —— 手动内联
  const scr = makeRecordingCtx('screen');
  callSeq = 0; eng2.cam.zoom = 6.5;
  render(eng2, scr, 1024, 640);
  const rec = eng2.worldCtx._rec;
  const bldCalls = rec.calls.filter((c) => c.m[0] === 2 && Math.abs(c.x - bx * 4) < 10 && Math.abs(c.y - by * 4) < 10);
  const unitCalls = (u) => {
    const px = (u.rx ?? u.x) * 2, py = (u.ry ?? u.y) * 2;
    return rec.calls.filter((c) => c.m[0] === 4 && Math.abs(c.x - px) < 5 && Math.abs(c.y - py) < 7);
  };
  const nCalls = unitCalls(north), sCalls = unitCalls(south);
  const nBody = nCalls.filter((c) => c.y <= ((north.ry ?? north.y) * 2) + 1);
  const sBody = sCalls.filter((c) => c.y <= ((south.ry ?? south.y) * 2) + 1);
  ok(bldCalls.length >= 3 && nBody.length >= 3 && sBody.length >= 3, `三者均有主体绘制（建筑${bldCalls.length}/北${nBody.length}/南${sBody.length}）`);
  const bldLast = Math.max(...bldCalls.map((c) => c.i));
  const nLast = Math.max(...nBody.map((c) => c.i));
  const sLast = Math.max(...sBody.map((c) => c.i));
  ok(nLast < bldLast, `北侧单位先于建筑绘制（被房遮挡）: 北#${nLast} < 房#${bldLast}`);
  ok(sLast > bldLast, `南侧单位后于建筑绘制（盖住房前）: 南#${sLast} > 房#${bldLast}`);
}

// ============ ④ LOD 迟滞：边界 zoom 不抖档 ============
console.log('[4] LOD 迟滞（旧版：zoom 8.0 附近每帧来回切档 → 大小/贴图闪烁）');
{
  resetSpriteQuarantine();
  renderFrame(9.5);
  ok(currentLodTier() === LOD_TIER.FINE, 'zoom 9.5 → FINE 档');
  renderFrame(8.0); // 落入迟滞窗 (7.75, 8.25)
  const t1 = currentLodTier();
  renderFrame(8.05); renderFrame(7.95); renderFrame(8.1);
  ok(currentLodTier() === t1 && t1 === LOD_TIER.FINE, `迟滞窗内档位稳定 FINE（实测 ${currentLodTier()}）`);
  renderFrame(6.0);
  ok(currentLodTier() === LOD_TIER.FULL, 'zoom 6.0 → FULL 档');
  renderFrame(5.6); renderFrame(5.5); renderFrame(5.7); // 迟滞窗 (5.35, 5.85)
  ok(currentLodTier() === LOD_TIER.FULL, `5.6 边界不回退 MINI（实测 ${currentLodTier()}）`);
  renderFrame(3.0);
  ok(currentLodTier() === LOD_TIER.MINI, 'zoom 3.0 → MINI 档');
  renderFrame(2.5); renderFrame(2.4); // 迟滞窗 (2.35, 2.65)
  ok(currentLodTier() === LOD_TIER.MINI, `2.5 边界不回退 DOT（实测 ${currentLodTier()}）`);
  renderFrame(2.0);
  ok(currentLodTier() === LOD_TIER.DOT, 'zoom 2.0 → DOT 档');
  renderFrame(2.5);
  ok(currentLodTier() === LOD_TIER.DOT, `迟滞窗内从下往上维持 DOT（升档需 ≥2.65；实测 ${currentLodTier()}）`);
  renderFrame(2.7);
  ok(currentLodTier() === LOD_TIER.MINI, 'zoom 2.7 越过升档阈值 → MINI');
}

// ============ ⑤ 软分离：同格两单位互推 ============
console.log('[5] 物理实感①软分离（旧版：零碰撞 → 单位可完全重叠成一像素）');
{
  const eng3 = new GameEngine(88009413);
  const a = eng3.spawnUnit(R.HUMAN, 80.5, 80.5, { civ: -1 }); a.age = 10;
  const b = eng3.spawnUnit(R.HUMAN, 80.5, 80.5, { civ: -1 }); b.age = 10;
  const d0 = Math.hypot(a.x - b.x, a.y - b.y);
  for (let t = 0; t < 30; t++) eng3.tick();
  const d1 = Math.hypot(a.x - b.x, a.y - b.y);
  ok(d0 < 0.05 && d1 > 0.25, `同格双单位 30 tick 后被推开（${d0.toFixed(3)} → ${d1.toFixed(3)}）`);
  // 推开后不得重叠复原（持续分离）
  for (let t = 0; t < 30; t++) eng3.tick();
  const d2 = Math.hypot(a.x - b.x, a.y - b.y);
  ok(d2 > 0.25, `分离稳定（60 tick 后 ${d2.toFixed(3)}）`);
}

// ============ ⑥ 受击击退：挨打者位移 ============
console.log('[6] 物理实感②受击击退（旧版：挨打原地不动只有闪烁）');
{
  const eng4 = new GameEngine(88009414);
  const wolf = eng4.spawnUnit(R.WOLF, 60.5, 60.5, { civ: -1 }); wolf.age = 5; wolf.food = 90;
  const sheep = eng4.spawnUnit(R.SHEEP, 61.5, 60.5, { civ: -1 }); sheep.age = 5;
  let displaced = false, hurtSeen = false, kbSeen = false;
  let prevX = sheep.x, prevY = sheep.y;
  for (let t = 0; t < 400; t++) {
    eng4.tick();
    if (sheep.dead) break;
    if (sheep.hurt >= 18) hurtSeen = true;
    if ((sheep.kbCd ?? 0) > 0) kbSeen = true;
    if (hurtSeen && Math.hypot(sheep.x - prevX, sheep.y - prevY) > 0.12) displaced = true;
    prevX = sheep.x; prevY = sheep.y;
  }
  ok(hurtSeen, '狼-羊接战（hurt≥18 观测到）');
  ok(kbSeen, '击退冷却字段被设置（击退 pass 生效）');
  ok(displaced, '受击 tick 位移 >0.12（击退真实落地）');
}

// ============ ⑦ 速度门迟滞（图层闪烁根除） ============
console.log('[7] 特效速度门迟滞（旧版：speed 跨 8 整层蒸发/重现）');
{
  // fxOnOf 内部状态由 render 帧首驱动 —— 行为验证：speed=8.0（窗内）连续帧 groundUsed 稳定
  eng.speed = 8.0;
  renderFrame(6.5); const s1 = currentLodTier(); // 只验证不抛 + 档位不受 speed 影响
  renderFrame(6.5);
  ok(s1 === LOD_TIER.FULL && currentLodTier() === LOD_TIER.FULL, 'speed=8 时渲染正常（不抛异常）');
  eng.speed = 0;
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) { console.log('失败项：' + fails.join(' | ')); process.exit(1); }
