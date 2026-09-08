/* 个人健身记录 Web —— 应用层
   覆盖 PRD F1-F9 与边界 E1-E12；数据存 localStorage；hash 路由 7 视图 */
(function () {
  'use strict';
  var C = window.FRCORE;
  var D = window.FRDATA;
  var KEYS = { profile: 'frp_profile', goal: 'frp_goal', units: 'frp_units', training: 'frp_training', diet: 'frp_diet', weight: 'frp_weight', customFoods: 'frp_custom_foods' };

  /* ================= 状态与持久化 ================= */
  var state = load();
  function load() {
    function jget(k, def) { try { var v = localStorage.getItem(k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
    var s = {
      profile: jget(KEYS.profile, null),
      goal: jget(KEYS.goal, null),
      units: jget(KEYS.units, { weight: 'kg', energy: 'kcal' }),
      training: jget(KEYS.training, []),
      diet: jget(KEYS.diet, []),
      weight: jget(KEYS.weight, []),
      customFoods: jget(KEYS.customFoods, [])
    };
    return s;
  }
  function save() {
    var data = {};
    Object.keys(KEYS).forEach(function (k) { data[KEYS[k]] = state[k]; });
    try {
      var total = 0;
      Object.keys(data).forEach(function (k) { total += (data[k] == null ? 0 : JSON.stringify(data[k]).length) * 2; });
      if (total > 5 * 1024 * 1024 * 0.6) toast('本地存储使用已超 60%，建议清理旧数据或导出备份（E5）');
      Object.keys(data).forEach(function (k) { localStorage.setItem(k, JSON.stringify(data[k])); });
      return true;
    } catch (e) {
      confirmModal('存储失败', '本地存储已满/不可用，记录可能丢失（E5）。建议清理浏览器数据或旧记录。', null);
      return false;
    }
  }
  function clearAllData() {
    Object.keys(KEYS).forEach(function (k) { try { localStorage.removeItem(KEYS[k]); } catch (e) {} });
    state = load();
  }

  /* ================= UI 基础 ================= */
  var view = document.getElementById('view');
  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }
  var modalEl = document.getElementById('modal');
  function confirmModal(title, body, onOk, okText) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = body;
    document.getElementById('modalOk').textContent = okText || '确认';
    modalEl.classList.remove('hidden');
    document.getElementById('modalOk').onclick = function () { modalEl.classList.add('hidden'); onOk && onOk(); };
    document.getElementById('modalCancel').onclick = function () { modalEl.classList.add('hidden'); };
  }
  function setFieldErr(id, on) { var el = document.getElementById(id); if (el) el.classList.toggle('err', on); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function today() { return C.dateStr(new Date()); }

  /* 单位换算（全局展示口径） */
  function wVal(v) { return state.units.weight === 'lb' ? C.kgToLb(v) : v; }
  function wUnit() { return state.units.weight === 'lb' ? 'lb' : 'kg'; }
  function eVal(v) { return state.units.energy === 'kJ' ? C.kcalToKj(v) : v; }
  function eUnit() { return state.units.energy === 'kJ' ? 'kJ' : 'kcal'; }
  function kg2input(kg) { return state.units.weight === 'lb' ? C.kgToLb(kg) : kg; }
  function input2kg(v) { return C.round1(state.units.weight === 'lb' ? v / 2.2046 : v); }

  /* ================= 汇总 ================= */
  function dayTotals(date) {
    var intake = 0, burned = 0, macros = { p: 0, c: 0, f: 0 }, missingMacro = false;
    state.diet.forEach(function (r) { if (r.date === date) { intake += r.cal * r.qty; } });
    state.training.forEach(function (r) { if (r.date === date) { burned += C.effectiveCalories(r.calories, r.override); } });
    state.diet.forEach(function (r) {
      if (r.date !== date) return;
      if (C.hasMissingMacro(r)) { missingMacro = true; return; }
      macros.p += r.protein * r.qty; macros.c += r.carbs * r.qty; macros.f += r.fat * r.qty;
    });
    return { intake: intake, burned: burned, net: intake - burned, macros: macros, missingMacro: missingMacro };
  }
  function latestWeight() {
    if (!state.weight.length) return state.profile ? state.profile.weight : null;
    var sorted = state.weight.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    return sorted[sorted.length - 1].v;
  }
  function weightByDate(date) {
    for (var i = 0; i < state.weight.length; i++) if (state.weight[i].date === date) return state.weight[i];
    return null;
  }
  /* 基础代谢（BMR）：需年龄+性别；用最近体重计算；资料不全返回 0 */
  function profileComplete() { return state.profile && state.profile.age != null && !!state.profile.gender; }
  function bmrValue() {
    if (!profileComplete()) return 0;
    var w = latestWeight() != null ? latestWeight() : state.profile.weight;
    return C.bmr(w, state.profile.height, state.profile.age, state.profile.gender);
  }
  /* 每日目标热量参考：有热量目标用目标；否则用 BMR×1.4（轻度活动维持量）作参考；无法算返回 0 */
  function targetCalories() {
    var g = kcalGoal();
    if (g) return g.value;
    var b = bmrValue();
    return b > 0 ? Math.round(b * 1.4) : 0;
  }
  /* 推荐每日宏量（g）：基于体重与目标热量 */
  function recMacros() {
    var w = latestWeight() != null ? latestWeight() : (state.profile ? state.profile.weight : 0);
    return C.recommendedMacros(w, targetCalories());
  }
  function kcalGoal() { return state.goal && state.goal.type === 'kcal' ? state.goal : null; }
  function goalCtx() {
    var dm = C.buildDailyMap(state.training, state.diet);
    var g = state.goal, start = g && g.start ? g.start : '2000-01-01', end = g && g.end ? g.end : today();
    return {
      today: today(),
      latestWeight: latestWeight(),
      periodAvgIntake: state.goal ? C.periodIntakeAvg(dm, start, end) : null
    };
  }
  function refreshGoalStatus() {
    if (!state.goal || state.goal.status !== 'active') return;
    var st = C.goalStatus(state.goal, goalCtx());
    if (st !== 'active' && st !== state.goal.status) { state.goal.status = st; save(); }
  }

  /* ================= 路由 ================= */
  var PAGES = {
    dashboard: { title: '今日看板', prd: 'PRD: F2 / F9', render: renderDashboard },
    training: { title: '记录训练', prd: 'PRD: F3 / F9 / E1 E2 E7 E9', render: renderTraining },
    diet: { title: '记录饮食', prd: 'PRD: F4 / F9 / E3 E4 E7', render: renderDiet },
    weight: { title: '记录体重', prd: 'PRD: F5 / E1 E7 / F9', render: renderWeight },
    goals: { title: '目标设定', prd: 'PRD: F6 / E10 E11', render: renderGoals },
    reports: { title: '历史报表', prd: 'PRD: F7 / E12', render: renderReports },
    settings: { title: '设置', prd: 'PRD: F8 / E5 E6 E8', render: renderSettings }
  };
  var current = 'dashboard';
  function go(page, keepPage) {
    if (!state.profile) { renderOnboarding(); return; }
    current = PAGES[page] ? page : 'dashboard';
    if (!keepPage) _pg = 1; // 切换页面回到第 1 页（翻页 re-render 时保留页码）
    if (location.hash.slice(1) !== current) {
      history.replaceState(null, '', '#' + current); // 同步 URL 与视图，不触发 hashchange
    }
    document.getElementById('pageTitle').textContent = PAGES[current].title;
    document.getElementById('prdTag').textContent = PAGES[current].prd;
    document.querySelectorAll('.nav-item,.tab').forEach(function (a) {
      a.classList.toggle('active', a.dataset.view === current);
    });
    view.innerHTML = PAGES[current].render();
    window.scrollTo(0, 0);
  }
  function route() { go(location.hash.slice(1)); }
  window.addEventListener('hashchange', route);

  /* ================= 记录管理状态（F9 编辑） ================= */
  var _edit = null;       // { type:'training'|'diet', id }
  var _editWeight = null; // { date, value(kg) }
  var _busy = false;      // E2 防重复提交

  /* ================= 通用组件 ================= */
  function itemRow(id, type, tag, title, sub, value, extra) {
    return '<div class="list-item">' +
      '<div class="li-main"><div class="li-title">' + esc(title) + ' <span class="pill ' + (type === 'training' ? 'pill-ok' : 'pill-warn') + '">' + esc(tag) + '</span></div>' +
      '<div class="li-sub">' + esc(sub) + '</div></div>' +
      '<div class="li-value">' + value + '</div>' +
      '<div class="li-actions">' +
      '<button class="btn btn-ghost btn-sm" onclick="FR.edit(\'' + type + '\',\'' + id + '\')">改</button>' +
      '<button class="btn btn-danger btn-sm" onclick="FR.del(\'' + type + '\',\'' + id + '\')">删</button>' +
      '</div></div>';
  }
  function paginate(arr, pageSize) {
    if (arr.length <= pageSize) return { rows: arr, page: 1, pages: 1 };
    var pages = Math.ceil(arr.length / pageSize);
    var page = Math.min(_pg || 1, pages);
    var start = (page - 1) * pageSize;
    return { rows: arr.slice(start, start + pageSize), page: page, pages: pages };
  }
  var _pg = 1;
  function pagerHtml(page, pages) {
    if (pages <= 1) return '';
    return '<div class="pager"><button class="btn btn-ghost btn-sm" onclick="FR.page(-1)" ' + (page <= 1 ? 'disabled' : '') + '>上一页</button>' +
      '<span>第 ' + page + ' / ' + pages + ' 页</span>' +
      '<button class="btn btn-ghost btn-sm" onclick="FR.page(1)" ' + (page >= pages ? 'disabled' : '') + '>下一页</button></div>';
  }
  function page(delta) {
    _pg = Math.max(1, (_pg || 1) + delta);
    go(current, true);
  }

  /* ================= F1 首次初始化 ================= */
  function renderOnboarding() {
    document.getElementById('pageTitle').textContent = '首次设置';
    document.getElementById('prdTag').textContent = 'PRD: F1';
    document.querySelectorAll('.nav-item,.tab').forEach(function (a) { a.classList.remove('active'); });
    view.innerHTML =
      '<div class="onboard"><div class="card">' +
      '<div class="big">欢迎使用健身记录</div>' +
      '<div class="intro">先设置身高、体重、年龄、性别，用于卡路里与基础代谢估算（首次必填）。热量目标与周期可选。</div>' +
      '<div class="row">' +
      '<div class="field" id="f-ob-h"><label>身高（cm，80–250）</label><input id="ob-h" class="input" type="number" min="80" max="250" placeholder="如 170"><div class="err-msg">身高需在 80–250cm</div></div>' +
      '<div class="field" id="f-ob-w"><label>体重（kg，20–300）</label><input id="ob-w" class="input" type="number" min="20" max="300" step="0.1" placeholder="如 70"><div class="err-msg">体重需在 20–300kg</div></div>' +
      '</div>' +
      '<div class="row">' +
      '<div class="field" id="f-ob-age"><label>年龄（岁，10–100）</label><input id="ob-age" class="input" type="number" min="10" max="100" placeholder="如 30"><div class="err-msg">年龄需在 10–100</div></div>' +
      '<div class="field" id="f-ob-gender"><label>性别（影响基础代谢）</label><select id="ob-gender" class="input"><option value="">请选择</option><option value="male">男</option><option value="female">女</option></select><div class="err-msg">请选择性别</div></div>' +
      '</div>' +
      '<div class="field" id="f-ob-g"><label>每日热量目标（可选，大卡）</label><input id="ob-g" class="input" type="number" min="0" placeholder="如 1500，留空则暂不设定"><div class="err-msg">目标值需 ≥ 0</div></div>' +
      '<div class="row">' +
      '<div class="field"><label>开始日期（可选）</label><input id="ob-s" class="input" type="date"></div>' +
      '<div class="field"><label>结束日期（可选）</label><input id="ob-e" class="input" type="date"></div>' +
      '</div>' +
      '<button class="btn btn-primary btn-block" onclick="FR.saveOnboard()">开始记录</button>' +
      '</div></div>';
  }
  function saveOnboard() {
    if (_busy) return; _busy = true;
    var h = parseFloat(document.getElementById('ob-h').value);
    var w = parseFloat(document.getElementById('ob-w').value);
    var age = parseFloat(document.getElementById('ob-age').value);
    var gender = document.getElementById('ob-gender').value;
    var g = document.getElementById('ob-g').value;
    var gv = g === '' ? NaN : parseFloat(g);
    var bad = false;
    if (C.isInvalidNumber(h, 80, 250)) { setFieldErr('f-ob-h', true); bad = true; } else setFieldErr('f-ob-h', false);
    if (C.isInvalidNumber(w, 20, 300)) { setFieldErr('f-ob-w', true); bad = true; } else setFieldErr('f-ob-w', false);
    if (C.isInvalidNumber(age, 10, 100)) { setFieldErr('f-ob-age', true); bad = true; } else setFieldErr('f-ob-age', false);
    if (!gender) { setFieldErr('f-ob-gender', true); bad = true; } else setFieldErr('f-ob-gender', false);
    if (!(g === '' || (isFinite(gv) && gv >= 0))) { setFieldErr('f-ob-g', true); bad = true; } else setFieldErr('f-ob-g', false);
    if (bad) { toast('请修正标红的字段'); _busy = false; return; }
    state.profile = { height: h, weight: w, age: age, gender: gender };
    state.units = { weight: 'kg', energy: 'kcal' };
    if (g !== '' && gv > 0) {
      state.goal = { type: 'kcal', value: gv, start: document.getElementById('ob-s').value || null, end: document.getElementById('ob-e').value || null, status: 'active' };
    } else {
      state.goal = null;
    }
    save();
    toast('资料已保存，开始记录吧');
    _busy = false;
    go('dashboard');
  }

  /* ================= F2 今日看板 ================= */
  function renderDashboard() {
    refreshGoalStatus();
    var t = today();
    var tot = dayTotals(t);
    var bmrV = bmrValue();
    var totalBurned = tot.burned + bmrV;
    var net = tot.intake - totalBurned;
    var g = state.goal;
    var gap = (g && g.type === 'kcal') ? g.value - tot.intake : null;
    var lw = latestWeight();
    var lwDate = state.weight.length ? state.weight.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; })[state.weight.length - 1].date : '--';

    var items = [];
    state.training.forEach(function (r) {
      if (r.date !== t) return;
      var sub = r.sets ? (r.sets + '组 × ' + (r.weight != null ? C.fmt(r.weight, 1) + 'kg' : '--') + ' · ' + r.duration + 'min') : (r.duration + 'min');
      items.push(itemRow(r.id, 'training', '训练', r.exercise, sub, fmtK(eVal(C.effectiveCalories(r.calories, r.override))) + ' ' + eUnit()));
    });
    state.diet.forEach(function (r) {
      if (r.date !== t) return;
      var sub = r.qty + r.unit + (C.hasMissingMacro(r) ? ' · 宏量未知' : '');
      items.push(itemRow(r.id, 'diet', '饮食·' + r.meal, r.name, sub, fmtK(eVal(r.cal * r.qty)) + ' ' + eUnit()));
    });
    var pg = paginate(items, 50);
    var listHtml = items.length
      ? pg.rows.join('') + pagerHtml(pg.page, pg.pages)
      : '<div class="empty"><div class="big">--</div><p>今天还没有记录<br>记录你的第一次训练 / 饮食</p></div>';

    var goalHtml;
    if (g && g.type === 'kcal') {
      var stPill = g.status === 'active' ? '<span class="pill pill-ok">进行中</span>' : g.status === 'done' ? '<span class="pill pill-warn">达成</span>' : '<span class="pill pill-danger">过期</span>';
      if (g.status === 'active') {
        goalHtml = '<div class="goal-banner">热量目标 <b>' + fmtK(eVal(g.value)) + '</b> ' + eUnit() + '/日 · ' + stPill + ' · ' +
          (gap >= 0 ? '还差 <b>' + fmtK(eVal(gap)) + '</b> ' + eUnit() : '已超出 <b>' + fmtK(eVal(-gap)) + '</b> ' + eUnit()) + '</div>';
      } else {
        goalHtml = '<div class="goal-banner muted">热量目标 ' + fmtK(eVal(g.value)) + ' ' + eUnit() + '/日 · ' + stPill + '（去「目标设定」重置）</div>';
      }
    } else {
      goalHtml = '<div class="goal-banner muted">未设定热量目标（去「目标设定」设置后显示差距）</div>';
    }

    var rec = recMacros();
    var hasGoal = !!kcalGoal();
    var macroBar = function (label, v, target, color) {
      if (!rec.valid) {
        return '<div><div class="macro-bar"><i style="width:0%;background:' + color + '"></i></div><div class="m">' + label + ' ' + fmtK(v) + 'g</div></div>';
      }
      var ratio = target > 0 ? v / target : 0;
      var pct = Math.min(100, ratio * 100);
      var barColor = ratio > 1.2 ? '#B91C1C' : (ratio > 1 ? '#B45309' : color);
      return '<div><div class="macro-bar"><i style="width:' + pct + '%;background:' + barColor + '"></i></div>' +
        '<div class="m">' + label + ' ' + fmtK(v) + 'g / 推荐 ' + target + 'g</div></div>';
    };
    var m = tot.macros;
    var recHint = rec.valid
      ? '<div class="hint">推荐量基于体重 ' + fmtW(wVal(latestWeight() != null ? latestWeight() : state.profile.weight)) + wUnit() +
        ' 与' + (hasGoal ? '热量目标' : 'BMR×1.4 估算维持量') + ' ' + fmtK(eVal(targetCalories())) + ' ' + eUnit() +
        '（蛋白1.6g/kg · 脂肪1.0g/kg · 碳水为余量）。进度条满=达标，超 120% 变红。</div>'
      : '<div class="hint">补全年龄/性别（设置）后显示推荐摄入量对比。</div>';

    return '' +
      '<div class="grid">' +
      '<div class="stat primary"><div class="label">摄入</div><div class="value">' + fmtK(eVal(tot.intake)) + '</div><div class="sub">' + eUnit() + '</div></div>' +
      '<div class="stat primary"><div class="label">消耗</div><div class="value">' + fmtK(eVal(totalBurned)) + '</div><div class="sub">' + eUnit() + (bmrV > 0 ? ' · 含基础代谢 ' + fmtK(eVal(bmrV)) : ' · 训练估算（去设置补年龄/性别算BMR）') + '</div></div>' +
      '<div class="stat ' + (net > 0 ? 'danger' : 'primary') + '"><div class="label">收支差</div><div class="value">' + fmtK(eVal(Math.abs(net))) + '</div><div class="sub">' + (net > 0 ? '盈余（摄入多）' : '缺口（消耗多）') + ' · ' + eUnit() + '</div></div>' +
      '<div class="stat"><div class="label">体重</div><div class="value">' + (lw == null ? '--' : fmtW(wVal(lw))) + '</div><div class="sub">' + wUnit() + ' · ' + lwDate + '</div></div>' +
      '</div>' +
      '<div class="grid-2" style="margin-top:14px">' +
      '<div class="card"><h3>营养拆分（今日）</h3>' +
      '<div class="macro">' + macroBar('蛋白', m.p, rec.p, '#2F6F4F') + macroBar('碳水', m.c, rec.c, '#B45309') + macroBar('脂肪', m.f, rec.f, '#2563EB') + '</div>' +
      recHint +
      (tot.missingMacro ? '<div class="hint">部分食物未填宏量，已显示"未知"（E4）</div>' : '') +
      goalHtml + '</div>' +
      '<div class="card"><h3>今日记录（' + items.length + ' 条）</h3>' + listHtml + '</div>' +
      '</div>' +
      '<div class="grid-3" style="margin-top:14px">' +
      '<button class="btn btn-primary btn-block" onclick="FR.go2(\'training\')">+ 记录训练</button>' +
      '<button class="btn btn-primary btn-block" onclick="FR.go2(\'diet\')">+ 记录饮食</button>' +
      '<button class="btn btn-primary btn-block" onclick="FR.go2(\'weight\')">+ 记录体重</button>' +
      '</div>';
  }

  /* ================= F3 训练记录 ================= */
  function renderTraining() {
    var exOpts = D.EXERCISES.map(function (e) {
      return '<option value="' + esc(e.name) + '" data-met="' + e.met + '">' + esc(e.name) + ' · MET ' + e.met + '</option>';
    }).join('');
    var rec = null;
    if (_edit && _edit.type === 'training') {
      state.training.forEach(function (r) { if (r.id === _edit.id) rec = r; });
    }
    var exSel = rec ? '<option value="' + esc(rec.exercise) + '" data-met="' + rec.met + '">' + esc(rec.exercise) + ' · MET ' + rec.met + '</option>' : '';
    var title = rec ? '编辑训练记录' : '新增训练记录';
    var wShow = rec && rec.weight != null ? kg2input(rec.weight) : '';
    return '<div class="card" style="max-width:560px">' +
      '<h3>' + title + (rec ? ' <span class="pill pill-warn">编辑中</span>' : '') + '</h3>' +
      '<div class="field"><label>动作（含 MET 值）</label>' +
      '<select id="tr-ex" class="input" onchange="FR.est()">' + exSel + exOpts + '</select></div>' +
      '<div class="row">' +
      '<div class="field" id="f-tr-sets"><label>组数</label><input id="tr-sets" class="input" type="number" min="1" placeholder="如 4" value="' + (rec ? rec.sets : '') + '" oninput="FR.est()"><div class="err-msg">组数需 ≥ 1</div></div>' +
      '<div class="field" id="f-tr-w"><label>重量（' + wUnit() + '，可留空）</label><input id="tr-w" class="input" type="number" min="0" placeholder="如 60" value="' + (wShow === '' ? '' : wShow) + '" oninput="FR.est()"><div class="err-msg">重量超出合理范围（>500kg）</div></div>' +
      '<div class="field" id="f-tr-d"><label>时长（分钟）</label><input id="tr-d" class="input" type="number" min="1" placeholder="如 40" value="' + (rec ? rec.duration : '') + '" oninput="FR.est()"><div class="err-msg">时长需 ≥ 1</div></div>' +
      '</div>' +
      '<div class="field" id="f-tr-c"><label>估算消耗（MET × 体重 × 时长）</label>' +
      '<input id="tr-c" class="input" type="number" readonly placeholder="输入时长后自动估算"><div class="hint">公式：消耗 = MET值 × 体重(' + wVal(state.profile.weight) + wUnit() + ') × 时长(h)。可手动覆盖估算值。</div></div>' +
      '<div class="field"><label>手动修正（可选，优先于公式）</label><input id="tr-override" class="input" type="number" placeholder="留空则用公式值" value="' + (rec && rec.override != null ? rec.override : '') + '"></div>' +
      '<div class="field"><label>日期（可补录）</label><input id="tr-date" class="input" type="date" value="' + (rec ? rec.date : today()) + '" max="' + today() + '"></div>' +
      '<button class="btn btn-primary btn-block" onclick="FR.saveTraining()">保存训练记录</button>' +
      (rec ? '<button class="btn btn-ghost btn-block" style="margin-top:8px" onclick="FR.cancelEdit()">取消编辑</button>' : '') +
      '</div>' +
      trainingHistoryHtml();
  }
  /* 训练历史列表：按范围（近7天/近30天/全部）展示，可编辑/删除 */
  var _trSpan = 7;
  function trainingHistoryHtml() {
    var span = _trSpan;
    var list = state.training.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    if (span === 7) list = list.filter(function (r) { return r.date >= C.addDays(today(), -6); });
    else if (span === 30) list = list.filter(function (r) { return r.date >= C.addDays(today(), -29); });
    var totalBurned = list.reduce(function (s, r) { return s + C.effectiveCalories(r.calories, r.override); }, 0);
    var totalMin = list.reduce(function (s, r) { return s + (r.duration || 0); }, 0);
    var rows = list.length
      ? list.map(function (r) {
        var sub = (r.sets ? r.sets + '组 × ' + (r.weight != null ? C.fmt(r.weight, 1) + 'kg' : '--') + ' · ' : '') + r.duration + 'min' + (r.override != null ? ' · 修正' + r.override : '');
        var tag = r.date === today() ? '今天' : r.date.slice(5);
        return itemRow(r.id, 'training', tag, r.exercise, sub, fmtK(eVal(C.effectiveCalories(r.calories, r.override))) + ' ' + eUnit());
      }).join('')
      : '<div class="empty"><p>该范围内暂无训练记录</p></div>';
    return '<div class="card" style="max-width:560px;margin-top:14px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
      '<h3 style="margin:0">训练历史</h3>' +
      '<div class="tabs" style="margin:0;width:auto">' +
      '<button class="tab-pill ' + (span === 7 ? 'active' : '') + '" onclick="FR.setTrSpan(7)">7天</button>' +
      '<button class="tab-pill ' + (span === 30 ? 'active' : '') + '" onclick="FR.setTrSpan(30)">30天</button>' +
      '<button class="tab-pill ' + (span === 0 ? 'active' : '') + '" onclick="FR.setTrSpan(0)">全部</button>' +
      '</div></div>' +
      '<div class="hint" style="margin-bottom:8px">共 ' + list.length + ' 条 · 合计 ' + totalMin + ' 分钟 · 消耗 ' + fmtK(eVal(totalBurned)) + ' ' + eUnit() + '</div>' +
      rows + '</div>';
  }
  function setTrSpan(s) { _trSpan = s; go('training'); }
  function est() {
    var sel = document.getElementById('tr-ex');
    if (!sel) return;
    var met = parseFloat(sel.options[sel.selectedIndex].dataset.met);
    var d = parseFloat(document.getElementById('tr-d').value);
    var c = document.getElementById('tr-c');
    if (c) c.value = (met > 0 && d > 0) ? C.burnCalories(met, state.profile.weight, d) : '';
  }
  function saveTraining() {
    if (_busy) return; _busy = true;
    var sets = parseFloat(document.getElementById('tr-sets').value);
    var wRaw = document.getElementById('tr-w').value;
    var w = wRaw === '' ? null : parseFloat(wRaw);
    var d = parseFloat(document.getElementById('tr-d').value);
    var sel = document.getElementById('tr-ex');
    var ex = sel.options[sel.selectedIndex];
    var met = parseFloat(ex.dataset.met);
    var date = document.getElementById('tr-date').value || today();
    var ovRaw = document.getElementById('tr-override').value;
    var override = ovRaw === '' ? null : parseFloat(ovRaw);

    var bad = false;
    if (!(sets >= 1)) { setFieldErr('f-tr-sets', true); bad = true; } else setFieldErr('f-tr-sets', false);
    if (!(d >= 1)) { setFieldErr('f-tr-d', true); bad = true; } else setFieldErr('f-tr-d', false);
    if (w != null && w < 0) { setFieldErr('f-tr-w', true); bad = true; } else setFieldErr('f-tr-w', false);
    if (bad) { toast('请修正标红的字段（组数/时长需 ≥ 1）'); _busy = false; return; }

    var wKg = w == null ? null : input2kg(w);
    var overWeight = wKg != null && wKg > 500;
    var cal = C.burnCalories(met, state.profile.weight, d);

    var doSave = function () {
      var rec = {
        id: (_edit && _edit.type === 'training') ? _edit.id : ('t' + Date.now()),
        date: date, exercise: ex.value, met: met, sets: sets, weight: wKg, duration: d,
        calories: cal, override: (override != null && override >= 0) ? override : null
      };
      if (_edit && _edit.type === 'training') {
        state.training = state.training.map(function (r) { return r.id === rec.id ? rec : r; });
      } else {
        state.training.push(rec);
      }
      _edit = null;
      save();
      toast('训练已保存，消耗 ' + fmtK(eVal(C.effectiveCalories(cal, rec.override))) + ' ' + eUnit());
      _busy = false;
      go('dashboard');
    };
    if (overWeight) {
      setFieldErr('f-tr-w', true);
      confirmModal('重量超出合理范围', '该重量（' + w + wUnit() + '）超过 500kg 合理范围。确认仍要保存吗？（E1）', doSave, '仍要保存');
      _busy = false;
      return;
    }
    doSave();
  }

  /* ================= F4 饮食记录 ================= */
  var _meal = '早餐';
  var _picked = null; // 选中的食物（含自定义）
  function renderDiet() {
    var editing = _edit && _edit.type === 'diet';
    var rec = null;
    if (editing) { state.diet.forEach(function (r) { if (r.id === _edit.id) rec = r; }); }
    if (editing && rec) { _meal = rec.meal; _picked = { name: rec.name, unit: rec.unit, cal: rec.cal, protein: rec.protein, carbs: rec.carbs, fat: rec.fat }; }
    var qtyVal = (editing && rec) ? rec.qty : '';
    var dateVal = (editing && rec) ? rec.date : today();
    var pickedHtml = _picked
      ? '<div class="list-item"><div class="li-main"><div class="li-title">' + esc(_picked.name) + '</div><div class="li-sub">已选 · 单位 ' + esc(_picked.unit) + ' · ' + _picked.cal + ' kcal/' + esc(_picked.unit) + '</div></div></div>'
      : '';
    var meals = ['早餐', '午餐', '晚餐', '加餐'].map(function (m, i) {
      return '<button class="tab-pill ' + (_meal === m ? 'active' : '') + '" data-meal="' + m + '" onclick="FR.setMeal(this)">' + m + '</button>';
    }).join('');

    var todayList = '';
    var todays = state.diet.filter(function (r) { return r.date === today(); });
    if (todays.length) {
      var pg2 = paginate(todays, 50);
      todayList = pg2.rows.map(function (r) {
        return itemRow(r.id, 'diet', '饮食·' + r.meal, r.name, r.qty + r.unit + (C.hasMissingMacro(r) ? ' · 宏量未知' : ''), fmtK(eVal(r.cal * r.qty)) + ' ' + eUnit());
      }).join('') + pagerHtml(pg2.page, pg2.pages);
    } else {
      todayList = '<div class="empty"><p>暂无记录</p></div>';
    }

    return '<div class="card" style="max-width:640px">' +
      '<h3>' + (editing ? '编辑饮食记录' : '新增饮食记录') + (editing ? ' <span class="pill pill-warn">编辑中</span>' : '') + '</h3>' +
      '<div class="tabs" id="meal-tabs">' + meals + '</div>' +
      '<div class="field"><label>搜索食物（输入关键字）</label><input id="food-q" class="input" type="text" placeholder="如：鸡胸肉" value="' + ((editing && rec) ? rec.name : '') + '" oninput="FR.searchFood()"></div>' +
      '<div id="food-list"></div>' +
      '<div id="food-picked" class="field" style="margin-top:10px">' + pickedHtml + '</div>' +
      '<div class="row">' +
      '<div class="field" id="f-food-qty"><label>份量（' + (_picked ? esc(_picked.unit) : '--') + '）</label><input id="food-qty" class="input" type="number" min="0" placeholder="份量" value="' + qtyVal + '"><div class="err-msg">份量需 &gt; 0（仍要保存需确认，E1）</div></div>' +
      '<div class="field" style="flex:2"><label>&nbsp;</label><button class="btn btn-primary btn-block" onclick="FR.saveDiet()">保存饮食记录</button></div>' +
      '</div>' +
      '<div class="field"><label>日期（可补录）</label><input id="food-date" class="input" type="date" value="' + dateVal + '" max="' + today() + '"></div>' +
      '<div style="margin-top:8px;font-size:13px">' +
      '<button class="btn btn-ghost btn-sm" onclick="FR.customFood()">+ 未找到？添加自定义食物</button>' +
      (editing ? ' <button class="btn btn-ghost btn-sm" onclick="FR.cancelEdit()">取消编辑</button>' : '') +
      '</div>' +
      '</div>' +
      '<div class="card" style="max-width:640px;margin-top:14px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0">今日饮食明细</h3><div style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" onclick="FR.exportDiet()">导出 JSON</button><button class="btn btn-ghost btn-sm" onclick="FR.importDiet()">导入 JSON</button><button class="btn btn-ghost btn-sm" onclick="FR.importDietText()">粘贴 JSON</button></div></div>' + todayList + '<div class="hint" style="margin-top:8px">导出全部饮食记录到文件或粘贴 JSON 数组导入，换设备/浏览器时导入可迁移数据（按 id 合并，不覆盖现有记录）。</div></div>';
  }
  /* 饮食记录导入导出 */
  function exportDiet() {
    var data = JSON.stringify(state.diet, null, 2);
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'diet-records-' + today() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('已导出 ' + state.diet.length + ' 条饮食记录');
  }
  function mergeDietArray(arr) {
    var existingIds = {};
    state.diet.forEach(function (r) { existingIds[r.id] = true; });
    var added = 0, skipped = 0;
    arr.forEach(function (r) {
      if (!r || !r.id || !r.date || !r.name) { skipped++; return; }
      if (existingIds[r.id]) { skipped++; return; }
      state.diet.push({
        id: r.id, date: r.date, meal: r.meal || '加餐', name: r.name,
        qty: r.qty || 1, unit: r.unit || '份', cal: r.cal || 0,
        protein: r.protein == null ? null : r.protein,
        carbs: r.carbs == null ? null : r.carbs,
        fat: r.fat == null ? null : r.fat
      });
      existingIds[r.id] = true;
      added++;
    });
    save();
    return { added: added, skipped: skipped };
  }
  function importDiet() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = function () {
      var file = input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var arr = JSON.parse(reader.result);
          if (!Array.isArray(arr)) { toast('导入失败：文件应为饮食记录数组'); return; }
          var r = mergeDietArray(arr);
          toast('已导入 ' + r.added + ' 条（跳过 ' + r.skipped + ' 条重复/无效）');
          go('diet');
        } catch (e) {
          toast('导入失败：JSON 解析错误');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }
  function importDietText() {
    confirmModal('粘贴导入饮食记录',
      '<textarea id="diet-paste-text" class="input" style="width:100%;min-height:200px;font-family:monospace;font-size:13px;resize:vertical" placeholder=\'[{"id":"x1","date":"2026-09-08","meal":"早餐","name":"燕麦","qty":40,"unit":"g","cal":150,"protein":5,"carbs":27,"fat":3}]\'></textarea>' +
      '<div class="hint" style="margin-top:8px">粘贴饮食记录 JSON 数组，按 id 合并，不覆盖已有记录。格式与"导出 JSON"一致。</div>',
      function () {
        var raw = (document.getElementById('diet-paste-text') || {}).value || '';
        if (!raw.trim()) { toast('导入失败：文本框为空'); return; }
        try {
          var arr = JSON.parse(raw);
          if (!Array.isArray(arr)) { toast('导入失败：应为饮食记录数组'); return; }
          var r = mergeDietArray(arr);
          toast('已导入 ' + r.added + ' 条（跳过 ' + r.skipped + ' 条重复/无效）');
          go('diet');
        } catch (e) {
          toast('导入失败：JSON 解析错误');
        }
      }, '导入');
  }
  function setMeal(el) { _meal = el.dataset.meal; document.querySelectorAll('#meal-tabs .tab-pill').forEach(function (b) { b.classList.toggle('active', b === el); }); }
  /* 合并食物库：自定义库 + 预置库，同名时自定义覆盖预置 */
  function mergedFoods() {
    var map = {};
    var order = [];
    D.FOODS.forEach(function (f) { if (!map[f.name]) { map[f.name] = Object.assign({}, f, { custom: false }); order.push(f.name); } });
    state.customFoods.forEach(function (f) {
      if (!map[f.name]) order.push(f.name);
      map[f.name] = Object.assign({}, f, { custom: true });
    });
    return order.map(function (n) { return map[n]; });
  }
  function searchFood() {
    var q = (document.getElementById('food-q').value || '').trim();
    var list = mergedFoods().filter(function (f) { return !q || f.name.indexOf(q) >= 0; });
    document.getElementById('food-list').innerHTML = list.length
      ? list.map(function (f) {
        var tag = f.custom ? ' <span class="pill pill-ok">我的</span>' : '';
        return '<div class="list-item"><div class="li-main"><div class="li-title">' + esc(f.name) + tag + '</div><div class="li-sub">' + f.cal + ' kcal/' + esc(f.unit) + ' · 蛋' + (f.protein == null ? '未知' : f.protein) + ' 碳' + (f.carbs == null ? '未知' : f.carbs) + ' 脂' + (f.fat == null ? '未知' : f.fat) + '</div></div>' +
          '<button class="btn btn-primary btn-sm" onclick="FR.pick(\'' + esc(f.name) + '\')">选择</button></div>';
      }).join('')
      : '<div class="empty"><p>未找到该食物，点下方「自定义食物」添加（E3）</p></div>';
  }
  function pick(name) {
    var f = null;
    mergedFoods().forEach(function (x) { if (x.name === name) f = x; });
    if (!f) return;
    _picked = f;
    _edit = null; // 切换食物后退出编辑态，按新增保存
    var q = document.getElementById('food-q');
    var fl = document.getElementById('food-list');
    var ql = document.getElementById('food-qty');
    var dl = document.getElementById('food-date');
    if (q) q.value = '';        // 收起搜索结果
    if (fl) fl.innerHTML = '';  // 清空下拉列表
    if (ql) { ql.value = ''; document.querySelector('#f-food-qty label').textContent = '份量（' + f.unit + '）'; }
    if (dl) dl.value = today();
    document.getElementById('food-picked').innerHTML =
      '<div class="list-item"><div class="li-main"><div class="li-title">' + esc(f.name) + '</div><div class="li-sub">已选 · 单位 ' + esc(f.unit) + ' · ' + f.cal + ' kcal/' + esc(f.unit) + '</div></div></div>';
  }
  function saveDiet() {
    if (_busy) return; _busy = true;
    if (!_picked) { toast('请先选择食物'); _busy = false; return; }
    var qty = parseFloat(document.getElementById('food-qty').value);
    var date = document.getElementById('food-date').value || today();
    var bad = false;
    if (isNaN(qty)) { setFieldErr('f-food-qty', true); bad = true; } else setFieldErr('f-food-qty', false);
    if (bad) { toast('请输入有效份量'); _busy = false; return; }

    var doSave = function () {
      var editing = _edit && _edit.type === 'diet';
      var rec = {
        id: editing ? _edit.id : ('d' + Date.now()),
        date: date, meal: _meal, name: _picked.name, qty: qty, unit: _picked.unit,
        cal: _picked.cal, protein: _picked.protein, carbs: _picked.carbs, fat: _picked.fat
      };
      if (editing) {
        state.diet = state.diet.map(function (r) { return r.id === rec.id ? rec : r; });
      } else {
        state.diet.push(rec);
      }
      _edit = null; _picked = null;
      save();
      toast('饮食已保存，摄入 ' + fmtK(eVal(rec.cal * rec.qty)) + ' ' + eUnit());
      _busy = false;
      go('diet'); // 保存后留在饮食页，方便连续记录或继续修改
    };
    if (qty <= 0) {
      setFieldErr('f-food-qty', true);
      confirmModal('份量异常', '份量需大于 0。确认仍要保存吗？（E1）', doSave, '仍要保存');
      _busy = false;
      return;
    }
    doSave();
  }
  function customFood() {
    confirmModal('自定义食物', '' +
      '<div class="field" id="f-cf-name"><label>食物名称 *</label><input id="cf-name" class="input" placeholder="如：自制沙拉"><div class="err-msg">请输入名称</div></div>' +
      '<div class="row">' +
      '<div class="field" id="f-cf-cal"><label>每单位热量（kcal）*</label><input id="cf-cal" class="input" type="number" min="0" placeholder="如 120"><div class="err-msg">请输入有效热量（≥0）</div></div>' +
      '<div class="field"><label>份量单位</label><input id="cf-unit" class="input" placeholder="份 / g / 个"></div>' +
      '</div>' +
      '<div class="row">' +
      '<div class="field"><label>蛋白 g/单位（可选）</label><input id="cf-p" class="input" type="number" min="0" placeholder="0"></div>' +
      '<div class="field"><label>碳水 g/单位（可选）</label><input id="cf-c" class="input" type="number" min="0" placeholder="0"></div>' +
      '<div class="field"><label>脂肪 g/单位（可选）</label><input id="cf-f" class="input" type="number" min="0" placeholder="0"></div>' +
      '</div>' +
      '<div class="hint">宏量留空时，营养拆分中该项显示"未知"（E4，不影响热量累计）。保存后以 1 单位计入当前餐次，并保存到「我的食物库」供下次搜索直接选用。</div>',
      function () {
        var name = (document.getElementById('cf-name').value || '').trim();
        var cal = parseFloat(document.getElementById('cf-cal').value);
        var bad = false;
        if (!name) { setFieldErr('f-cf-name', true); bad = true; } else setFieldErr('f-cf-name', false);
        if (!isFinite(cal) || cal < 0) { setFieldErr('f-cf-cal', true); bad = true; } else setFieldErr('f-cf-cal', false);
        if (bad) return;
        var unit = (document.getElementById('cf-unit').value || '份').trim();
        var num = function (v) { var n = parseFloat(v); return isFinite(n) ? n : null; };
        var food = { name: name, unit: unit, cal: cal, protein: num(document.getElementById('cf-p').value), carbs: num(document.getElementById('cf-c').value), fat: num(document.getElementById('cf-f').value) };
        _picked = food;
        _edit = null;
        // 检查是否已存在（预置库或自定义库）
        var inPreset = D.FOODS.some(function (f) { return f.name === name; });
        var existCustom = state.customFoods.some(function (f) { return f.name === name; });
        var upsertCustom = function () {
          state.customFoods = state.customFoods.filter(function (f) { return f.name !== name; });
          state.customFoods.push(food);
          save();
          toast('已选并保存到「我的食物库」：' + name);
          go('diet');
        };
        if (inPreset || existCustom) {
          var where = existCustom ? '我的食物库' : '预置库';
          confirmModal('食物已存在', '「' + name + '」在' + where + '中已存在。是否用你填写的数据覆盖？\n（预置库不会被修改，仅在「我的食物库」中以你的版本覆盖，搜索时优先显示你的版本。）', upsertCustom, '覆盖保存');
        } else {
          upsertCustom();
        }
      }, '添加');
  }
  /* 我的食物库：删除自定义食物条目（不影响已保存的饮食记录） */
  function delCustomFood(name) {
    confirmModal('删除自定义食物', '从「我的食物库」删除「' + name + '」？\n已保存的饮食记录不受影响（记录存的是当时的热量快照）。', function () {
      state.customFoods = state.customFoods.filter(function (f) { return f.name !== name; });
      save();
      toast('已从我的食物库删除：' + name);
      go('settings');
    });
  }

  /* ================= F5 体重记录 ================= */
  var _wSpan = 7; // 7 / 30 / 0=历史
  function renderWeight() {
    var editW = _editWeight;
    var vShow = editW ? wVal(editW.value) : '';
    var dShow = editW ? editW.date : today();
    var form = '' +
      '<div class="card"><h3>' + (editW ? '编辑体重记录' : '记录今日体重') + '</h3>' +
      '<div class="field" id="f-wt"><label>体重（' + wUnit() + '，范围 20–300' + wUnit() + '）</label><input id="wt-v" class="input" type="number" step="0.1" placeholder="如 67.5" value="' + vShow + '"><div class="err-msg">超出合理范围（20–300' + wUnit() + '）</div></div>' +
      '<div class="field"><label>日期</label><input id="wt-date" class="input" type="date" value="' + dShow + '" max="' + today() + '"></div>' +
      '<div class="form-actions">' +
      '<button class="btn btn-primary btn-block" onclick="FR.saveWeight()">保存体重</button>' +
      (editW ? '<button class="btn btn-ghost" onclick="FR.cancelEdit()">取消</button>' : '') +
      '</div></div>';

    if (!state.weight.length) {
      return '<div style="max-width:420px">' + form + '</div>' +
        '<div class="card" style="max-width:420px;margin-top:14px"><h3>体重趋势</h3><div class="empty"><p>暂无体重记录，先记录一次吧</p></div></div>';
    }

    var sorted = state.weight.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var win = _wSpan === 7 ? sorted.slice(-7) : _wSpan === 30 ? sorted.slice(-30) : sorted;
    var vals = win.map(function (w) { return w.v; });
    var maxV = Math.max.apply(null, vals);
    var minV = Math.min.apply(null, vals);
    var yMax = Math.round((Math.ceil((maxV + 0.4) * 10) / 10) * 10) / 10;
    var yMin = Math.round((Math.floor((minV - 0.4) * 10) / 10) * 10) / 10;
    var yMid = Math.round((yMax + yMin) / 2 * 10) / 10;
    var range = (yMax - yMin) || 1;
    var labelStep = _wSpan === 7 ? 1 : _wSpan === 30 ? 5 : 10;

    var bars = win.map(function (w, i) {
      var h = ((w.v - yMin) / range) * 78 + 8;
      var showVal = _wSpan === 7;
      var showDate = _wSpan === 7 || i % labelStep === 0 || i === win.length - 1;
      return '<div class="bar' + (i === win.length - 1 ? ' latest' : '') + '" style="height:' + h + '%" title="' + w.date + ' · ' + w.v + ' ' + wUnit() + '">' +
        (showVal ? '<span class="val">' + w.v + '</span>' : '') +
        (showDate ? '<span class="date">' + w.date.slice(5) + '</span>' : '') +
        '</div>';
    }).join('');

    var hist = sorted.slice(0).reverse().slice(0, 10).map(function (w) {
      return '<div class="list-item"><div class="li-main"><div class="li-title">' + w.date + '</div></div>' +
        '<div class="li-value">' + fmtW(wVal(w.v)) + ' ' + wUnit() + '</div>' +
        '<div class="li-actions"><button class="btn btn-danger btn-sm" onclick="FR.del(\'weight\',\'' + w.date + '\')">删</button></div></div>';
    }).join('');

    return '<div class="grid-2">' + form +
      '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
      '<h3 style="margin:0">体重趋势</h3>' +
      '<div class="tabs" style="margin:0;width:auto">' +
      '<button class="tab-pill ' + (_wSpan === 7 ? 'active' : '') + '" onclick="FR.setWeightSpan(7)">7天</button>' +
      '<button class="tab-pill ' + (_wSpan === 30 ? 'active' : '') + '" onclick="FR.setWeightSpan(30)">30天</button>' +
      '<button class="tab-pill ' + (_wSpan === 0 ? 'active' : '') + '" onclick="FR.setWeightSpan(0)">历史</button>' +
      '</div></div>' +
      '<div class="trend-wrap">' +
      '<div class="trend-y"><span>' + yMax + '</span><span>' + yMid + '</span><span>' + yMin + '</span></div>' +
      '<div class="trend-box"><div class="trend-grid"><i></i><i></i><i></i></div><div class="trend">' + bars + '</div></div>' +
      '</div>' +
      '<div class="hint">悬停柱子可查看每天数值 · 最新 ' + fmtW(wVal(sorted[sorted.length - 1].v)) + ' ' + wUnit() + '（' + sorted[sorted.length - 1].date + '）</div>' +
      '</div></div>' +
      '<div class="card" style="margin-top:14px"><h3>最近体重记录（最近 10 条）</h3>' + hist + '</div>';
  }
  function saveWeight() {
    if (_busy) return; _busy = true;
    var vRaw = parseFloat(document.getElementById('wt-v').value);
    var date = document.getElementById('wt-date').value || today();
    if (isNaN(vRaw)) { setFieldErr('f-wt', true); toast('请输入有效体重'); _busy = false; return; }
    var vkg = Math.round(input2kg(vRaw) * 10) / 10;
    var inRange = vkg >= 20 && vkg <= 300;
    var doSave = function () {
      var existing = weightByDate(date);
      if (existing) { existing.v = vkg; toast('已更新 ' + date + ' 的体重（同日不叠加）'); }
      else { state.weight.push({ date: date, v: vkg }); toast('体重已保存'); }
      _editWeight = null;
      save();
      _busy = false;
      go('weight');
    };
    if (!inRange) {
      setFieldErr('f-wt', true);
      confirmModal('体重超出合理范围', '体重 ' + vRaw + wUnit() + ' 超出 20–300kg 范围。确认仍要保存吗？（E1）', doSave, '仍要保存');
      _busy = false;
      return;
    }
    doSave();
  }
  function setWeightSpan(s) { _wSpan = s; go('weight'); }

  /* ================= F6 目标设定 ================= */
  var _goalType = null; // null=首次按当前目标类型初始化；用户显式切换后保持
  function renderGoals() {
    refreshGoalStatus();
    if (_goalType === null) {
      _goalType = state.goal ? state.goal.type : 'kcal';
    }
    var isKcal = _goalType === 'kcal';
    var g = state.goal;
    var ctx = goalCtx();
    var status = g ? C.goalStatus(g, ctx) : 'inactive';
    var statusPill = status === 'active' ? '<span class="pill pill-ok">进行中</span>' : status === 'done' ? '<span class="pill pill-warn">达成</span>' : status === 'expired' ? '<span class="pill pill-danger">过期</span>' : '<span class="pill pill-neutral">未设定</span>';
    var tot = dayTotals(today());
    var hint = isKcal
      ? (g ? '今日摄入 ' + fmtK(eVal(tot.intake)) + ' ' + eUnit() + '，' + (g.status === 'active' ? '还差 ' + fmtK(eVal(Math.max(0, g.value - tot.intake))) + ' ' + eUnit() : '目标周期已结束') : '设置每日热量目标后，看板显示差距')
      : '当前体重 ' + (latestWeight() == null ? '--' : fmtW(wVal(latestWeight()))) + ' ' + wUnit();
    var vVal = g ? kg2input(g.value) : (isKcal ? 1500 : '');
    return '<div class="card" style="max-width:560px">' +
      '<h3>目标设定 ' + statusPill + '</h3>' +
      '<div class="tabs">' +
      '<button class="tab-pill ' + (isKcal ? 'active' : '') + '" onclick="FR.setGoalType(\'kcal\')">热量目标</button>' +
      '<button class="tab-pill ' + (!isKcal ? 'active' : '') + '" onclick="FR.setGoalType(\'weight\')">体重目标</button>' +
      '</div>' +
      (isKcal
        ? '<div class="field"><label>每日热量目标（' + eUnit() + '）</label><input id="goal-v" class="input" type="number" min="1" value="' + (g && g.type === 'kcal' ? g.value : '1500') + '"><div class="hint">' + hint + '</div></div>'
        : '<div class="field"><label>目标体重（' + wUnit() + '）</label><input id="goal-v" class="input" type="number" min="1" step="0.1" value="' + (g && g.type === 'weight' ? vVal : '') + '"><div class="hint">' + hint + '</div></div>') +
      '<div class="row">' +
      '<div class="field"><label>开始日期</label><input id="goal-s" class="input" type="date" value="' + (g ? g.start || '' : '') + '"></div>' +
      '<div class="field"><label>结束日期</label><input id="goal-e" class="input" type="date" value="' + (g ? g.end || '' : '') + '"></div>' +
      '</div>' +
      '<div class="form-actions">' +
      '<button class="btn btn-primary" style="flex:1" onclick="FR.saveGoal()">保存目标</button>' +
      (g && g.status !== 'active' ? '<button class="btn btn-ghost" onclick="FR.resetGoal()">重新设定</button>' : '') +
      '</div>' +
      (status === 'done' || status === 'expired' ? '<div class="hint" style="margin-top:8px">目标周期已结束，判定为「' + (status === 'done' ? '达成' : '过期') + '」（E10），可重新设定。</div>' : '') +
      '</div>';
  }
  function setGoalType(t) { _goalType = t; go('goals'); }
  function saveGoal() {
    if (_busy) return; _busy = true;
    var v = parseFloat(document.getElementById('goal-v').value);
    if (!(v > 0)) { toast('请输入有效目标值'); _busy = false; return; }
    var val = _goalType === 'weight' ? input2kg(v) : v;
    state.goal = {
      type: _goalType, value: val,
      start: document.getElementById('goal-s').value || null,
      end: document.getElementById('goal-e').value || null,
      status: 'active'
    };
    save();
    toast('目标已保存');
    _busy = false;
    go('dashboard');
  }
  function resetGoal() { state.goal = null; save(); toast('已清除目标，请重新设定'); go('goals'); }

  /* ================= F7 历史报表 ================= */
  var _dim = 'week';
  function renderReports() {
    var dm = C.buildDailyMap(state.training, state.diet);
    var hasAny = state.training.length || state.diet.length;
    if (!hasAny) {
      return '<div class="card"><h3>历史报表</h3><div class="empty"><p>暂无数据（E12）<br>先记录训练或饮食后再查看报表</p></div></div>';
    }
    var g = kcalGoal();
    var goalV = g ? g.value : null;
    var e = eUnit();
    var bmrV = bmrValue();
    /* 有记录的日期集合（训练或饮食任一） */
    var recordedDates = {};
    state.training.forEach(function (r) { recordedDates[r.date] = true; });
    state.diet.forEach(function (r) { recordedDates[r.date] = true; });
    var recDays = Object.keys(recordedDates).sort();
    var firstRec = recDays[0];

    var rows = [], head;
    if (_dim === 'day') {
      head = ['日期', '摄入(' + e + ')', '训练(' + e + ')', '消耗(' + e + ')', goalV != null ? '缺口(' + e + ')' : '收支差(' + e + ')', '状态'];
      rows = recDays.map(function (d) {
        var t = dayTotals(d);
        var burned = t.burned + bmrV;
        var diff = goalV != null ? goalV - t.intake : burned - t.intake;
        return [d, fmtK(eVal(t.intake)), fmtK(eVal(t.burned)), fmtK(eVal(burned)), diff, diff >= 0 ? '达标' : '超标', diff];
      }).reverse(); // 最近在前
    } else if (_dim === 'week') {
      head = ['周期', '日均摄入(' + e + ')', '日均训练(' + e + ')', '日均消耗(' + e + ')', goalV != null ? '日均缺口(' + e + ')' : '日均收支差(' + e + ')', '趋势'];
      /* 按有记录日期所在的周去重，仅展示有记录的周 */
      var weekSet = {};
      recDays.forEach(function (d) { weekSet[C.weekStart(d)] = true; });
      var weeks = Object.keys(weekSet).sort();
      rows = weeks.map(function (ws) {
        var wEnd = C.addDays(ws, 6);
        if (wEnd > today()) wEnd = today();
        var aI = C.periodIntakeAvg(dm, ws, wEnd);
        var aTr = C.periodBurnedAvg(dm, ws, wEnd);
        var aB = aTr + bmrV;
        var diff = goalV != null ? goalV - aI : aB - aI;
        return [ws.slice(5) + ' ~ ' + (wEnd > today() ? today() : wEnd).slice(5), fmtK(eVal(aI)), fmtK(eVal(aTr)), fmtK(eVal(aB)), diff, diff >= 0 ? '达标' : '超标', diff];
      }).reverse();
    } else {
      head = ['月份', '日均摄入(' + e + ')', '日均训练(' + e + ')', '日均消耗(' + e + ')', goalV != null ? '日均缺口(' + e + ')' : '日均收支差(' + e + ')', '趋势'];
      var monthSet = {};
      recDays.forEach(function (d) { monthSet[d.slice(0, 7)] = true; });
      var months = Object.keys(monthSet).sort();
      rows = months.map(function (mk) {
        var start = mk + '-01';
        var end = C.dateStr(new Date(+mk.slice(0, 4), +mk.slice(5, 7), 0));
        if (mk === today().slice(0, 7)) end = today();
        var aI = C.periodIntakeAvg(dm, start, end);
        var aTr = C.periodBurnedAvg(dm, start, end);
        var aB = aTr + bmrV;
        var diff = goalV != null ? goalV - aI : aB - aI;
        return [mk, fmtK(eVal(aI)), fmtK(eVal(aTr)), fmtK(eVal(aB)), diff, diff >= 0 ? '达标' : '超标', diff];
      }).reverse();
    }
    var body = rows.map(function (r) {
      var diff = r[4];
      var diffTxt = diff >= 0 ? '−' + fmtK(eVal(diff)) : '+' + fmtK(eVal(-diff));
      return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td><td>' + r[3] + '</td>' +
        '<td style="color:' + (diff >= 0 ? 'var(--primary)' : 'var(--danger)') + '">' + diffTxt + '</td>' +
        '<td>' + (diff >= 0 ? '▲ 缺口内' : '▼ 超标') + '</td></tr>';
    }).join('');
    var dims = [['day', '日'], ['week', '周'], ['month', '月']];
    return '<div class="card">' +
      '<div class="tabs">' + dims.map(function (d) {
        return '<button class="tab-pill ' + (_dim === d[0] ? 'active' : '') + '" onclick="FR.setDim(\'' + d[0] + '\')">按' + d[1] + '</button>';
      }).join('') + '</div>' +
      '<table><tr>' + head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr>' + body + '</table>' +
      '<div class="hint" style="margin-top:8px">' +
      (goalV != null ? '缺口 = 目标(' + fmtK(eVal(goalV)) + ' ' + e + ') − 摄入；' : '未设热量目标，收支差 = 消耗 − 摄入；') +
      '消耗 = 训练 + 基础代谢' + (bmrV > 0 ? '（' + fmtK(eVal(bmrV)) + ' ' + e + '/日）' : '（去设置补年龄/性别）') + '；仅展示有记录的' + (_dim === 'day' ? '日期' : _dim === 'week' ? '周期' : '月份') + '，周/月为周期自然日日均。</div>' +
      '</div>';
  }
  function setDim(d) { _dim = d; go('reports'); }

  /* ================= F8 设置 ================= */
  function renderSettings() {
    var customList = state.customFoods.length
      ? state.customFoods.map(function (f) {
        return '<div class="list-item"><div class="li-main"><div class="li-title">' + esc(f.name) + ' <span class="pill pill-ok">我的</span></div><div class="li-sub">' + f.cal + ' kcal/' + esc(f.unit) + ' · 蛋' + (f.protein == null ? '未知' : f.protein) + ' 碳' + (f.carbs == null ? '未知' : f.carbs) + ' 脂' + (f.fat == null ? '未知' : f.fat) + '</div></div>' +
          '<div class="li-actions"><button class="btn btn-danger btn-sm" onclick="FR.delCustomFood(\'' + esc(f.name) + '\')">删</button></div></div>';
      }).join('')
      : '<div class="empty"><p>暂无自定义食物<br>在「记录饮食」中添加自定义食物后会保存在这里</p></div>';
    return '<div class="grid">' +
      '<div class="grid-2">' +
      '<div class="card"><h3>单位</h3>' +
      '<div class="field"><label>体重单位</label>' +
      '<div class="tabs"><button class="tab-pill ' + (state.units.weight === 'kg' ? 'active' : '') + '" onclick="FR.setUnit(\'weight\',\'kg\')">kg</button><button class="tab-pill ' + (state.units.weight === 'lb' ? 'active' : '') + '" onclick="FR.setUnit(\'weight\',\'lb\')">lb</button></div></div>' +
      '<div class="field"><label>能量单位</label>' +
      '<div class="tabs"><button class="tab-pill ' + (state.units.energy === 'kcal' ? 'active' : '') + '" onclick="FR.setUnit(\'energy\',\'kcal\')">大卡 kcal</button><button class="tab-pill ' + (state.units.energy === 'kJ' ? 'active' : '') + '" onclick="FR.setUnit(\'energy\',\'kJ\')">千焦 kJ</button></div></div>' +
      '<div class="hint">切换后全站即时换算（1kg≈2.2046lb，1kcal≈4.184kJ），历史数据同口径（E8）。</div></div>' +
      '<div class="card"><h3>个人资料（影响估算）</h3>' +
      '<div class="row">' +
      '<div class="field" id="f-set-h"><label>身高（cm）</label><input id="set-h" class="input" type="number" value="' + state.profile.height + '"><div class="err-msg">身高需在 80–250cm</div></div>' +
      '<div class="field" id="f-set-w"><label>体重（' + wUnit() + '）</label><input id="set-w" class="input" type="number" step="0.1" value="' + fmtW(wVal(state.profile.weight)) + '"><div class="err-msg">体重需在 20–300' + wUnit() + '</div></div>' +
      '</div>' +
      '<div class="row">' +
      '<div class="field" id="f-set-age"><label>年龄（岁，10–100）</label><input id="set-age" class="input" type="number" min="10" max="100" value="' + (state.profile.age != null ? state.profile.age : '') + '"><div class="err-msg">年龄需在 10–100</div></div>' +
      '<div class="field" id="f-set-gender"><label>性别（影响基础代谢）</label><select id="set-gender" class="input"><option value="">请选择</option><option value="male"' + (state.profile.gender === 'male' ? ' selected' : '') + '>男</option><option value="female"' + (state.profile.gender === 'female' ? ' selected' : '') + '>女</option></select><div class="err-msg">请选择性别</div></div>' +
      '</div>' +
      '<button class="btn btn-primary btn-block" onclick="FR.saveProfile()">保存资料</button>' +
      '<div style="margin-top:18px;border-top:1px solid var(--line);padding-top:14px">' +
      '<button class="btn btn-danger btn-block" onclick="FR.clearAll()">清除全部本地数据</button>' +
      '</div></div>' +
      '</div>' +
      '<div class="card" style="margin-top:14px"><h3>我的食物库（' + state.customFoods.length + ' 条）</h3>' + customList +
      '<div class="hint" style="margin-top:8px">自定义食物保存在此，搜索时优先于预置库。删除条目不影响已保存的饮食记录。</div></div>' +
      '</div>';
  }
  function setUnit(kind, val) { state.units[kind] = val; save(); toast('已切换单位'); go('settings'); }
  function saveProfile() {
    if (_busy) return; _busy = true;
    var h = parseFloat(document.getElementById('set-h').value);
    var w = parseFloat(document.getElementById('set-w').value);
    var age = parseFloat(document.getElementById('set-age').value);
    var gender = document.getElementById('set-gender').value;
    var bad = false;
    if (C.isInvalidNumber(h, 80, 250)) { setFieldErr('f-set-h', true); bad = true; } else setFieldErr('f-set-h', false);
    if (C.isInvalidNumber(w, 20, 300)) { setFieldErr('f-set-w', true); bad = true; } else setFieldErr('f-set-w', false);
    if (C.isInvalidNumber(age, 10, 100)) { setFieldErr('f-set-age', true); bad = true; } else setFieldErr('f-set-age', false);
    if (!gender) { setFieldErr('f-set-gender', true); bad = true; } else setFieldErr('f-set-gender', false);
    if (bad) { toast('请修正标红的字段'); _busy = false; return; }
    var doSave = function () {
      state.profile.height = h;
      state.profile.weight = input2kg(w);
      state.profile.age = age;
      state.profile.gender = gender;
      save();
      toast('资料已保存，估算将按新体重与基础代谢计算');
      _busy = false;
      go('settings');
    };
    var wkg = input2kg(w);
    if (wkg < 20 || wkg > 300) {
      setFieldErr('f-set-w', true);
      confirmModal('体重超出合理范围', '体重 ' + w + wUnit() + '（' + wkg + 'kg）超出 20–300kg。确认仍要保存吗？（E1）', doSave, '仍要保存');
      _busy = false;
      return;
    }
    if (h > 250) {
      setFieldErr('f-set-h', true);
      confirmModal('身高超出合理范围', '身高 ' + h + 'cm 超出 80–250cm。确认仍要保存吗？（E1）', doSave, '仍要保存');
      _busy = false;
      return;
    }
    doSave();
  }
  function clearAll() {
    confirmModal('清除数据', '将删除本机全部记录与资料，不可恢复（E6）。确认？', function () {
      clearAllData();
      toast('已清空全部本地数据');
      renderOnboarding();
    }, '确认清除');
  }

  /* ================= F9 记录管理：编辑 / 删除 ================= */
  function edit(type, id) {
    if (type === 'weight') {
      var w = weightByDate(id);
      if (w) _editWeight = { date: id, value: w.v };
      go('weight');
      return;
    }
    _edit = { type: type, id: id };
    if (type === 'training') go('training');
    else go('diet');
  }
  function cancelEdit() { _edit = null; _editWeight = null; _picked = null; go('dashboard'); }
  function del(type, id) {
    var label = type === 'training' ? '训练' : type === 'diet' ? '饮食' : '体重';
    confirmModal('删除记录', '删除后不可恢复，确认删除这条' + label + '记录？', function () {
      if (type === 'weight') { state.weight = state.weight.filter(function (r) { return r.date !== id; }); }
      else if (type === 'training') { state.training = state.training.filter(function (r) { return r.id !== id; }); }
      else { state.diet = state.diet.filter(function (r) { return r.id !== id; }); }
      save();
      toast('已删除');
      go(current);
    });
  }

  /* ================= 格式工具 ================= */
  function fmtK(v) { return C.fmt(v, 0); }
  function fmtW(v) { return C.fmt(v, 1); }

  window.FR = {
    go2: go,
    page: page,
    edit: edit, cancelEdit: cancelEdit, del: del,
    saveOnboard: saveOnboard,
    est: est, saveTraining: saveTraining,
    setTrSpan: setTrSpan,
    setMeal: setMeal, searchFood: searchFood, pick: pick, saveDiet: saveDiet, customFood: customFood,
    delCustomFood: delCustomFood,
    exportDiet: exportDiet, importDiet: importDiet, importDietText: importDietText,
    saveWeight: saveWeight, setWeightSpan: setWeightSpan,
    setGoalType: setGoalType, saveGoal: saveGoal, resetGoal: resetGoal,
    setDim: setDim,
    setUnit: setUnit, saveProfile: saveProfile, clearAll: clearAll,
    /* 测试钩子 */
    _test: { getState: function () { return state; }, reset: function () { clearAllData(); } }
  };

  /* 启动 */
  refreshGoalStatus();
  route();
})();
