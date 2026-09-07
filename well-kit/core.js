/* 核心纯逻辑（无 DOM / localStorage 依赖）
   UMD 风格：浏览器挂 window.FRCORE，Node 可 require */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.FRCORE = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LB_PER_KG = 2.2046;
  var KJ_PER_KCAL = 4.184;

  /* ===== 格式化（浮点守卫）===== */
  function fmt(n, digits) {
    var v = (Math.round(n * 100) / 100).toFixed(digits === undefined ? 1 : digits);
    return v;
  }
  function round1(n) { return Math.round(n * 10) / 10; }

  /* ===== 单位换算 ===== */
  function kgToLb(kg) { return round1(kg * LB_PER_KG); }
  function lbToKg(lb) { return round1(lb / LB_PER_KG); }
  function kcalToKj(kcal) { return Math.round(kcal * KJ_PER_KCAL); }

  /* ===== 训练消耗（MET × 体重kg × 时长h）===== */
  function burnCalories(met, weightKg, durationMin) {
    if (!(met > 0) || !(weightKg > 0) || !(durationMin > 0)) return 0;
    return Math.round(met * weightKg * durationMin / 60);
  }
  /* 手动修正优先（override 有效时优先于公式值） */
  function effectiveCalories(formula, override) {
    return (override != null && isFinite(override) && override >= 0) ? override : formula;
  }

  /* 基础代谢率 BMR（Mifflin-St Jeor，kcal/日）
     男：10×体重 + 6.25×身高 − 5×年龄 + 5
     女：10×体重 + 6.25×身高 − 5×年龄 − 161 */
  function bmr(weightKg, heightCm, age, gender) {
    if (!(weightKg > 0) || !(heightCm > 0) || !(age > 0)) return 0;
    var base = 10 * weightKg + 6.25 * heightCm - 5 * age;
    return Math.round(gender === 'female' ? base - 161 : base + 5);
  }

  /* 推荐每日宏量（g）：基于体重与每日目标热量
     蛋白 1.6g/kg（减脂保肌下限）、脂肪 1.0g/kg（激素健康下限）、碳水 = 余量/4
     返回 {p,c,f,valid}；体重或热量非法时 valid=false */
  function recommendedMacros(weightKg, targetCal) {
    if (!(weightKg > 0) || !(targetCal > 0)) return { p: 0, c: 0, f: 0, valid: false };
    var p = Math.round(1.6 * weightKg);
    var f = Math.round(1.0 * weightKg);
    var carbCal = targetCal - p * 4 - f * 9;
    var c = Math.max(0, Math.round(carbCal / 4));
    return { p: p, c: c, f: f, valid: true };
  }

  /* ===== 食物热量 / 宏量（cal 为每单位）===== */
  function foodCalories(food, qty) { return food.cal * qty; }
  function foodMacros(food, qty) {
    return {
      p: food.protein == null ? null : food.protein * qty,
      c: food.carbs == null ? null : food.carbs * qty,
      f: food.fat == null ? null : food.fat * qty
    };
  }
  /* 宏量任一缺失 → 该食物需显示"未知"（E4） */
  function hasMissingMacro(food) {
    return food.protein == null || food.carbs == null || food.fat == null;
  }

  /* ===== 日期工具（本地时区，YYYY-MM-DD）===== */
  function dateStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parseDate(s) {
    var p = s.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function addDays(s, n) {
    var d = parseDate(s);
    d.setDate(d.getDate() + n);
    return dateStr(d);
  }
  function eachDay(fromStr, toStr) {
    var out = [], cur = fromStr, guard = 0;
    while (cur <= toStr && guard < 4000) { out.push(cur); cur = addDays(cur, 1); guard++; }
    return out;
  }
  function weekStart(s) {
    var d = parseDate(s);
    var day = d.getDay();
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    return dateStr(d);
  }
  function monthKey(s) { return s.slice(0, 7); }

  /* ===== 输入校验（返回是否无效）===== */
  function isInvalidNumber(v, min, max) {
    if (v == null || v === '' || !isFinite(v)) return true;
    if (min != null && v < min) return true;
    if (max != null && v > max) return true;
    return false;
  }

  /* ===== 目标状态机 =====
     goal: { type:'kcal'|'weight', value, start, end, status }
     ctx: { today, latestWeight, periodAvgIntake }
     周期未结束 → active；结束后按口径判定 done / expired */
  function goalStatus(goal, ctx) {
    if (!goal || !goal.status || goal.status === 'inactive') return 'inactive';
    if (goal.status !== 'active') return goal.status;
    var ended = goal.end && goal.end < ctx.today;
    if (!ended) return 'active';
    if (goal.type === 'weight') {
      return (ctx.latestWeight != null && ctx.latestWeight <= goal.value) ? 'done' : 'expired';
    }
    if (goal.type === 'kcal') {
      return (ctx.periodAvgIntake != null && ctx.periodAvgIntake <= goal.value) ? 'done' : 'expired';
    }
    return 'expired';
  }

  /* ===== 报表聚合 =====
     dailyMap: { 'YYYY-MM-DD': { intake, burned } }
     周/月口径：周期自然日日均（无记录日计 0） */
  function buildDailyMap(training, diet) {
    var map = {};
    function add(date, k, v) {
      if (!map[date]) map[date] = { intake: 0, burned: 0 };
      map[date][k] += v;
    }
    training.forEach(function (r) { add(r.date, 'burned', effectiveCalories(r.calories, r.override)); });
    diet.forEach(function (r) { add(r.date, 'intake', r.cal * r.qty); });
    return map;
  }
  function periodAvg(dailyMap, fromStr, toStr, key) {
    var days = eachDay(fromStr, toStr);
    var sum = 0;
    days.forEach(function (d) {
      var v = dailyMap[d] ? dailyMap[d][key] : 0;
      if (isFinite(v)) sum += v;
    });
    return days.length ? sum / days.length : 0;
  }
  function periodIntakeAvg(dailyMap, fromStr, toStr) { return periodAvg(dailyMap, fromStr, toStr, 'intake'); }
  function periodBurnedAvg(dailyMap, fromStr, toStr) { return periodAvg(dailyMap, fromStr, toStr, 'burned'); }

  return {
    fmt: fmt,
    round1: round1,
    kgToLb: kgToLb,
    lbToKg: lbToKg,
    kcalToKj: kcalToKj,
    burnCalories: burnCalories,
    effectiveCalories: effectiveCalories,
    bmr: bmr,
    recommendedMacros: recommendedMacros,
    foodCalories: foodCalories,
    foodMacros: foodMacros,
    hasMissingMacro: hasMissingMacro,
    dateStr: dateStr,
    parseDate: parseDate,
    addDays: addDays,
    eachDay: eachDay,
    weekStart: weekStart,
    monthKey: monthKey,
    isInvalidNumber: isInvalidNumber,
    goalStatus: goalStatus,
    buildDailyMap: buildDailyMap,
    periodAvg: periodAvg,
    periodIntakeAvg: periodIntakeAvg,
    periodBurnedAvg: periodBurnedAvg
  };
});
