(function () {
  'use strict';

  const { TEAMS, GROUPS, GROUP_NAMES, MATCHES } = window.WC_DATA;
  const MATCH_BY_ID = {};
  MATCHES.forEach(m => { MATCH_BY_ID[m.id] = m; });

  // 收集所有"最佳第三名"槽位（按官方场次号排序），用于晋级分配
  const THIRD_SLOTS = [];
  MATCHES.forEach(m => {
    [m.homeSlot, m.awaySlot].forEach(s => {
      if (s && s.kind === 'third') THIRD_SLOTS.push({ match: s.match, candidates: s.candidates });
    });
  });
  THIRD_SLOTS.sort((a, b) => (MATCH_BY_ID[a.match].bi) - (MATCH_BY_ID[b.match].bi));

  // ---------- 存储 ----------
  const LS = {
    users: 'wc_users',        // [{username, password, followed:[], bets:{matchId:'home'|'draw'|'away'}}]
    session: 'wc_session',    // username
    results: 'wc_results',    // {matchId:{home,away}} 录入的真实比分（覆盖演示比分）
    guestFollows: 'wc_guest_follows', // 未登录时关注的球队
  };
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  // ---------- 状态 ----------
  let state = {
    tab: 'schedule',
    scheduleFilter: 'all', // all | group | knockout | upcoming | mine
    scheduleView: 'list',  // list | bracket（赛程：列表 / 对阵图）
    bracketZoom: 0.5,      // 对阵图缩放比例
    teamGroupFilter: 'all',
    followView: null,      // schedule | teams（null 时按是否已关注自动决定）
    scheduleViewMode: 'list', // list | calendar（我的赛程）
    selectedDay: null,     // 月历选中的日期 key
    rankView: 'teams',     // teams | users
    betView: 'wdl',        // wdl | score | goals | champion（竞猜栏目）
    authMode: 'login',     // login | register
    authError: '',
    adminOpen: false,
  };

  // ---------- 工具 ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const now = () => new Date();
  const flag = name => (TEAMS[name] && TEAMS[name].flag) || '🏳️';
  const MATCH_DURATION_MS = 105 * 60 * 1000;

  function fmtDateKey(iso) { return iso.slice(0, 10); }
  function fmtDateLabel(key) {
    const d = new Date(key + 'T00:00:00');
    const dow = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    return { main: `${d.getMonth() + 1}月${d.getDate()}日`, dow };
  }
  function fmtTime(iso) { return iso.slice(11, 16); }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ---------- 比赛状态 / 结果 ----------
  function matchStatus(m) {
    const start = new Date(m.kickoff).getTime();
    const t = now().getTime();
    if (t < start) return 'upcoming';
    if (t < start + MATCH_DURATION_MS) return 'live';
    return 'finished';
  }
  function getResults() { return load(LS.results, {}); }
  function hasManual(m) { return !!getResults()[m.id]; }
  // 比分优先级：手动录入 > 官方已赛 > 模拟
  function getMatchResult(m) {
    const man = getResults()[m.id];
    if (man) return { home: man.home, away: man.away, source: 'manual' };
    return { home: m.result.home, away: m.result.away, source: m.official ? 'official' : 'sim' };
  }
  const RESULT_TAG = { manual: '录入比分', official: '官方比分', sim: '模拟比分' };
  // 是否已结算：录入了真实比分，或已踢完
  function isSettled(m) { return hasManual(m) || matchStatus(m) === 'finished'; }
  // 是否展示比分（已开赛 / 已结算）
  function showsScore(m) { return hasManual(m) || matchStatus(m) !== 'upcoming'; }

  function matchOutcome(m) {
    const r = getMatchResult(m);
    if (r.home > r.away) return 'home';
    if (r.home < r.away) return 'away';
    return 'draw';
  }

  // ---------- 槽位解析（淘汰赛对阵） ----------
  function slotLabel(slot) {
    if (slot.kind === 'group') return `${slot.group}组第${slot.rank}`;
    if (slot.kind === 'third') return slot.label; // 例如 A3/B3/C3/D3/F3
    const pm = MATCH_BY_ID[slot.match];
    const tag = slot.kind === 'winner' ? '胜者' : '负者';
    return pm ? `${pm.bn}-${pm.bi}${tag}` : tag;
  }

  function resolveSlot(slot) {
    const label = slotLabel(slot);
    if (slot.kind === 'group') {
      const standing = groupStanding(slot.group);
      if (!standing) return { name: null, label };
      return { name: standing[slot.rank - 1] || null, label };
    }
    if (slot.kind === 'third') {
      const map = assignThirds();
      if (!map || !map[slot.match]) return { name: null, label };
      return { name: map[slot.match], label };
    }
    const pm = MATCH_BY_ID[slot.match];
    if (!pm) return { name: null, label };
    const wl = winnerLoserOf(pm);
    if (!wl) return { name: null, label };
    return { name: slot.kind === 'winner' ? wl.win : wl.lose, label };
  }

  function teamsOf(m) {
    if (!m.knockout) {
      return { home: { name: m.home, label: m.home }, away: { name: m.away, label: m.away } };
    }
    return { home: resolveSlot(m.homeSlot), away: resolveSlot(m.awaySlot) };
  }

  function winnerLoserOf(m) {
    const t = teamsOf(m);
    if (!t.home.name || !t.away.name) return null;
    if (!isSettled(m)) return null;
    const o = matchOutcome(m);
    if (o === 'draw') return null;
    return o === 'home'
      ? { win: t.home.name, lose: t.away.name }
      : { win: t.away.name, lose: t.home.name };
  }

  // 小组积分表：所有 6 场均已结算才返回（[{team,pts,gd,gf}] 排名序），否则 null
  function groupTable(groupName) {
    const grp = GROUPS.find(x => x.name === groupName);
    if (!grp) return null;
    const ms = MATCHES.filter(m => !m.knockout && m.group === groupName);
    if (ms.length === 0 || !ms.every(isSettled)) return null;
    const tbl = {};
    grp.teams.forEach(t => { tbl[t] = { team: t, pts: 0, gd: 0, gf: 0 }; });
    ms.forEach(m => {
      const r = getMatchResult(m);
      tbl[m.home].gf += r.home; tbl[m.away].gf += r.away;
      tbl[m.home].gd += r.home - r.away; tbl[m.away].gd += r.away - r.home;
      if (r.home > r.away) tbl[m.home].pts += 3;
      else if (r.home < r.away) tbl[m.away].pts += 3;
      else { tbl[m.home].pts += 1; tbl[m.away].pts += 1; }
    });
    return Object.values(tbl)
      .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team));
  }
  function groupStanding(groupName) {
    const t = groupTable(groupName);
    return t ? t.map(x => x.team) : null;
  }

  // 实时小组积分榜：按目前已结算的比赛统计（未踢完也返回）
  function liveGroupTable(groupName) {
    const grp = GROUPS.find(x => x.name === groupName);
    if (!grp) return [];
    const ms = MATCHES.filter(m => !m.knockout && m.group === groupName);
    const tbl = {};
    grp.teams.forEach(t => { tbl[t] = { team: t, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 }; });
    ms.forEach(m => {
      if (!isSettled(m)) return;
      const r = getMatchResult(m), H = tbl[m.home], A = tbl[m.away];
      H.played++; A.played++; H.gf += r.home; H.ga += r.away; A.gf += r.away; A.ga += r.home;
      H.gd = H.gf - H.ga; A.gd = A.gf - A.ga;
      if (r.home > r.away) { H.w++; A.l++; H.pts += 3; }
      else if (r.home < r.away) { A.w++; H.l++; A.pts += 3; }
      else { H.d++; A.d++; H.pts++; A.pts++; }
    });
    return Object.values(tbl).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team));
  }

  // 12 个小组第三名排名（全部小组结算后才返回），前 8 名晋级
  function thirdsRanking() {
    if (!GROUP_NAMES.every(gn => groupTable(gn))) return null;
    return GROUP_NAMES.map(gn => {
      const row = groupTable(gn)[2];
      return { group: gn, team: row.team, pts: row.pts, gd: row.gd, gf: row.gf };
    }).sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.group.localeCompare(b.group));
  }
  // 将晋级的 8 个最佳第三名分配到 8 个淘汰赛槽位（候选组约束下的完美匹配，Kuhn 算法）
  function assignThirds() {
    const ranking = thirdsRanking();
    if (!ranking) return null;
    const qSet = new Set(ranking.slice(0, 8).map(x => x.group));
    const teamByGroup = {}, rankIndex = {};
    ranking.forEach((x, i) => { teamByGroup[x.group] = x.team; rankIndex[x.group] = i; });
    // 每个槽位的可选组（仅限晋级的第三名），按排名排序以保证确定性
    const slotCands = THIRD_SLOTS.map(s =>
      s.candidates.filter(gn => qSet.has(gn)).sort((a, b) => rankIndex[a] - rankIndex[b]));
    const groupToSlot = {};
    const tryKuhn = (si, visited) => {
      for (const gn of slotCands[si]) {
        if (visited.has(gn)) continue;
        visited.add(gn);
        if (groupToSlot[gn] === undefined || tryKuhn(groupToSlot[gn], visited)) {
          groupToSlot[gn] = si; return true;
        }
      }
      return false;
    };
    for (let si = 0; si < THIRD_SLOTS.length; si++) tryKuhn(si, new Set());
    const map = {};
    Object.keys(groupToSlot).forEach(gn => { map[THIRD_SLOTS[groupToSlot[gn]].match] = teamByGroup[gn]; });
    return map;
  }

  // ---------- 用户 ----------
  function getUsers() { return load(LS.users, []); }
  function setUsers(u) { save(LS.users, u); }
  function currentUsername() { return load(LS.session, null); }
  function currentUser() {
    const name = currentUsername();
    if (!name) return null;
    return getUsers().find(u => u.username === name) || null;
  }
  function updateCurrentUser(mutator) {
    const users = getUsers();
    const u = users.find(x => x.username === currentUsername());
    if (!u) return;
    mutator(u);
    setUsers(users);
  }
  // 当前关注的球队（已登录用账号，未登录用游客本地存储）
  function currentFollowed() {
    const u = currentUser();
    return u ? u.followed : load(LS.guestFollows, []);
  }

  // ---------- 积分 ----------
  const POINTS_CORRECT = 3;                 // 胜平负
  const POINTS = { wdl: 3, score: 5, goals: 2, champion: 30 };
  function totalGoals(m) { const r = getMatchResult(m); return r.home + r.away; }
  function goalsHit(pick, total) { return pick >= 6 ? total >= 6 : pick === total; }
  // 最终冠军（决赛结算后才确定）
  function finalChampion() {
    const f = MATCH_BY_ID['FINAL'];
    if (!f) return null;
    const wl = winnerLoserOf(f);
    return wl ? wl.win : null;
  }
  // 淘汰赛最早开球时间（小组赛结束、冠军竞猜截止的分界）
  const KNOCKOUT_START = (() => {
    const ks = MATCHES.filter(m => m.knockout).map(m => new Date(m.kickoff).getTime());
    return ks.length ? Math.min(...ks) : Infinity;
  })();
  // 冠军竞猜是否开放：仅小组赛期间（淘汰赛开始前）可猜
  function championBetOpen() { return now().getTime() < KNOCKOUT_START; }
  function userStats(user) {
    const bets = user.bets || {}, sb = user.scoreBets || {}, gb = user.goalBets || {};
    let points = 0;
    const wdl = { correct: 0, settled: 0, total: 0 };
    const score = { correct: 0, settled: 0, total: 0 };
    const goals = { correct: 0, settled: 0, total: 0 };
    MATCHES.forEach(m => {
      const done = isSettled(m);
      if (bets[m.id] != null) {
        wdl.total++;
        if (done) { wdl.settled++; if (bets[m.id] === matchOutcome(m)) { wdl.correct++; points += POINTS.wdl; } }
      }
      if (sb[m.id] != null) {
        score.total++;
        if (done) {
          score.settled++; const r = getMatchResult(m);
          if (sb[m.id].home === r.home && sb[m.id].away === r.away) { score.correct++; points += POINTS.score; }
        }
      }
      if (gb[m.id] != null) {
        goals.total++;
        if (done) { goals.settled++; if (goalsHit(gb[m.id], totalGoals(m))) { goals.correct++; points += POINTS.goals; } }
      }
    });
    const champion = { picked: user.championBet || null, correct: false, settled: false };
    const champ = finalChampion();
    if (champion.picked && champ) {
      champion.settled = true;
      if (champion.picked === champ) { champion.correct = true; points += POINTS.champion; }
    }
    return {
      points,
      correct: wdl.correct, settled: wdl.settled, totalBets: wdl.total, pending: wdl.total - wdl.settled,
      wdl, score, goals, champion,
    };
  }
  function leaderboard() {
    return getUsers()
      .map(u => ({ username: u.username, ...userStats(u) }))
      .sort((a, b) => b.points - a.points || b.correct - a.correct || a.username.localeCompare(b.username));
  }

  // ---------- 演示用户 ----------
  function seedDemoUsers() {
    if (getUsers().length > 0) return;
    const picks = ['home', 'draw', 'away'];
    const users = [];
    // 榜首玩家：罗莉（各类竞猜全部命中，稳居第一）
    const loriBets = {}, loriScore = {}, loriGoals = {};
    MATCHES.forEach(m => {
      if (m.knockout) return;
      const r = getMatchResult(m);
      loriBets[m.id] = matchOutcome(m);
      loriScore[m.id] = { home: r.home, away: r.away };
      loriGoals[m.id] = Math.min(6, r.home + r.away);
    });
    users.push({
      username: '罗莉', password: 'demo123', followed: [],
      bets: loriBets, scoreBets: loriScore, goalBets: loriGoals,
      championBet: finalChampion() || '巴西',
    });
    // 其余演示用户
    const others = ['老王看球', '足球小将', '冷门收割机', '客厅解说员'];
    others.forEach((name, i) => {
      const bets = {};
      MATCHES.forEach((m, idx) => {
        if (m.knockout) return; // 演示投注只覆盖小组赛
        if ((idx + i) % 4 !== 0) bets[m.id] = picks[(idx * 7 + i * 3) % 3];
      });
      users.push({ username: name, password: 'demo123', followed: [], bets });
    });
    setUsers(users);
  }

  // ---------- 渲染：赛程 ----------
  function renderSchedule() {
    const mode = state.scheduleView || 'list';
    const modeBar = `<div class="filter-bar">
      <button class="chip ${mode === 'list' ? 'active' : ''}" data-schedmode="list">📋 赛程列表</button>
      <button class="chip ${mode === 'bracket' ? 'active' : ''}" data-schedmode="bracket">🏆 对阵图</button>
      <button class="chip ${mode === 'groups' ? 'active' : ''}" data-schedmode="groups">🌍 小组球队</button></div>`;
    if (mode === 'bracket') return modeBar + renderBracket();
    if (mode === 'groups') return modeBar + renderBracketGroups();

    const user = currentUser();
    const followed = new Set(currentFollowed());
    const filters = [
      { k: 'all', label: '全部' },
      { k: 'group', label: '小组赛' },
      { k: 'knockout', label: '淘汰赛' },
      { k: 'upcoming', label: '未开赛' },
      { k: 'mine', label: '我关注的' },
    ];
    let list = MATCHES.slice();
    if (state.scheduleFilter === 'group') list = list.filter(m => !m.knockout);
    if (state.scheduleFilter === 'knockout') list = list.filter(m => m.knockout);
    if (state.scheduleFilter === 'upcoming') list = list.filter(m => matchStatus(m) === 'upcoming');
    if (state.scheduleFilter === 'mine') list = list.filter(m => followsMatch(m, followed));

    const bar = `<div class="filter-bar">${filters.map(f =>
      `<button class="chip ${state.scheduleFilter === f.k ? 'active' : ''}" data-sfilter="${f.k}">${f.label}</button>`
    ).join('')}</div>
    <div style="font-size:11px;color:var(--muted);margin:0 2px 6px">🕐 北京时间 · 共 ${MATCHES.length} 场（72 小组赛 + 32 淘汰赛）</div>`;

    if (list.length === 0) {
      return modeBar + bar + emptyBlock('🗓️', state.scheduleFilter === 'mine'
        ? '你还没有关注球队<br/>去「关注」页选择喜欢的球队吧' : '暂无比赛');
    }
    const byDate = {};
    list.forEach(m => { const k = fmtDateKey(m.kickoff); (byDate[k] = byDate[k] || []).push(m); });
    let html = modeBar + bar;
    Object.keys(byDate).sort().forEach(dateKey => {
      const { main, dow } = fmtDateLabel(dateKey);
      html += `<div class="date-head">${main}<span class="dow">${dow}</span></div>`;
      byDate[dateKey].forEach(m => { html += matchCard(m, user, followed, true); });
    });
    return html;
  }

  function followsMatch(m, followedSet) {
    const t = teamsOf(m);
    return (t.home.name && followedSet.has(t.home.name)) || (t.away.name && followedSet.has(t.away.name));
  }

  // ---------- 渲染：全局对阵图（淘汰赛） ----------
  // 两侧对称对阵图的轮次构成（按官方对阵树推导，自上而下）
  const BRACKET = {
    left: {
      r32: ['R32-3', 'R32-6', 'R32-1', 'R32-4', 'R32-12', 'R32-11', 'R32-10', 'R32-9'],
      r16: ['R16-1', 'R16-2', 'R16-5', 'R16-6'],
      qf: ['QF-1', 'QF-2'],
      sf: ['SF-1'],
    },
    right: {
      r32: ['R32-2', 'R32-5', 'R32-7', 'R32-8', 'R32-15', 'R32-14', 'R32-13', 'R32-16'],
      r16: ['R16-3', 'R16-4', 'R16-7', 'R16-8'],
      qf: ['QF-3', 'QF-4'],
      sf: ['SF-2'],
    },
  };

  // 槽位的紧凑代号（未定球队时显示），如 1E / 2A / 3·ABCDF
  function slotCode(slot) {
    if (!slot) return '—';
    if (slot.kind === 'group') return `${slot.rank}${slot.group}`;
    if (slot.kind === 'third') return `3·${slot.candidates.join('')}`;
    return '—'; // 胜/负者：由连线表达，未定时留空
  }
  function mdTime(iso) { return `${iso.slice(5, 10).replace('-', '/')} ${iso.slice(11, 16)}`; }

  function renderBracket() {
    const z = state.bracketZoom || 0.5;
    const champ = finalChampion();
    const champBanner = `<div class="bk-champ">🏆 预测/产生冠军：<b>${champ ? `${flag(champ)} ${champ}` : '待决赛产生'}</b></div>`;
    const FINAL = MATCH_BY_ID['FINAL'], THIRD = MATCH_BY_ID['3RD'];
    const center = `
      <div class="bk-center">
        <div class="bk-trophy">🏆<span>FINAL</span><small>${FINAL ? mdTime(FINAL.kickoff) + ' 北京时间' : ''}</small></div>
        <div class="bk-final-cell">${FINAL ? bracketNode(FINAL) : ''}</div>
        ${THIRD ? `<div class="bk-third"><div class="bk-third-h">季军赛 · ${mdTime(THIRD.kickoff)}</div>${bracketNode(THIRD)}</div>` : ''}
      </div>`;
    return `
      <div class="bracket-wrap">
        ${champBanner}
        <div class="bracket-ctrl">
          <button class="bk-zbtn" data-zoom="out">－</button>
          <button class="bk-zbtn bk-zlabel" data-zoom="reset">${Math.round(z * 100)}%</button>
          <button class="bk-zbtn" data-zoom="in">＋</button>
          <span class="bk-tip">拖动浏览 · 双指/按钮缩放 · 北京时间</span>
        </div>
        <div class="bracket-stage" id="bracketStage">
          <div class="bracket-zoom" id="bracketZoom" style="zoom:${z}">
            <div class="bracket-board">
              ${bracketSide('left')}
              ${center}
              ${bracketSide('right')}
            </div>
          </div>
        </div>
      </div>`;
  }

  // 各小组球队一览（含官方排名提示）
  function renderBracketGroups() {
    const followed = new Set(currentFollowed());
    let html = `<div class="bk-groups">
      <div class="bk-groups-h">📋 小组球队一览<span class="bk-groups-sub">前两名直接晋级，8 个最佳小组第三名也可出线</span></div>
      <div class="bk-groups-grid">`;
    GROUPS.forEach(g => {
      const table = liveGroupTable(g.name); // 已按名次排序的队伍
      const ranked = table && table.length ? table.map(r => r.team) : g.teams.slice();
      html += `<div class="bk-grp-card"><div class="bk-grp-name">${g.name} 组</div>`;
      ranked.forEach((team, i) => {
        const zone = i < 2 ? 'q1' : (i === 2 ? 'q3' : '');
        const mine = followed.has(team) ? 'mine' : '';
        html += `<div class="bk-grp-row ${zone} ${mine}">
          <span class="bk-grp-rk">${i + 1}</span>
          <span class="bk-grp-flag">${flag(team)}</span>
          <span class="bk-grp-tm">${team}</span></div>`;
      });
      html += `</div>`;
    });
    html += `</div>
      <div class="bk-groups-legend">
        <span><i class="lg q1"></i>前两名（直接晋级）</span>
        <span><i class="lg q3"></i>小组第三（争最佳第三）</span>
        <span><i class="lg mine"></i>我关注的球队</span>
      </div></div>`;
    return html;
  }

  function bracketSide(side) {
    const cfg = BRACKET[side];
    // 左侧：外→内（R32→SF）；右侧：内→外（SF→R32）以朝中间收拢
    const rounds = side === 'left'
      ? [['R32', cfg.r32], ['R16', cfg.r16], ['QF', cfg.qf], ['SF', cfg.sf]]
      : [['SF', cfg.sf], ['QF', cfg.qf], ['R16', cfg.r16], ['R32', cfg.r32]];
    const cols = rounds.map(([key, ids]) =>
      `<div class="bk-round bk-r-${key}">${ids.map(id =>
        `<div class="bk-cell">${bracketNode(MATCH_BY_ID[id])}</div>`).join('')}</div>`
    ).join('');
    return `<div class="bk-side ${side}">${cols}</div>`;
  }

  function bracketNode(m) {
    if (!m) return '';
    const t = teamsOf(m);
    const r = getMatchResult(m);
    const show = showsScore(m);
    const settled = isSettled(m);
    const teamRow = (side, info, slot) => {
      const known = !!info.name;
      const nm = known ? `${flag(info.name)} ${info.name}` : `<span class="bk-code">${slotCode(slot)}</span>`;
      const sc = show ? `<b class="bk-sc">${side === 'home' ? r.home : r.away}</b>` : '';
      const isWin = show && settled && known && matchOutcome(m) === side;
      return `<div class="bk-team ${isWin ? 'bk-win' : ''}">${nm}${sc}</div>`;
    };
    return `<div class="bk-node">
      <div class="bk-node-h">${mdTime(m.kickoff)} · ${m.venue}</div>
      ${teamRow('home', t.home, m.homeSlot)}
      ${teamRow('away', t.away, m.awaySlot)}
    </div>`;
  }

  function adjustZoom(dir) {
    let z = state.bracketZoom || 0.5;
    if (dir === 'in') z = Math.min(1.8, +(z + 0.15).toFixed(2));
    else if (dir === 'out') z = Math.max(0.3, +(z - 0.15).toFixed(2));
    else z = 0.5;
    state.bracketZoom = z;
    const el = document.getElementById('bracketZoom');
    if (el) el.style.zoom = z;
    const lbl = document.querySelector('.bk-zlabel');
    if (lbl) lbl.textContent = Math.round(z * 100) + '%';
  }

  // 对阵图手势：拖动平移 + 双指/ctrl 滚轮缩放
  let bkDrag = null;      // 拖动状态（窗口级监听只绑定一次）
  let bkPinchBase = 0, bkZoomBase = 0.62;
  function setupBracketGestures() {
    const stage = document.getElementById('bracketStage');
    if (!stage) return;
    stage.addEventListener('mousedown', e => {
      bkDrag = { stage, sx: e.pageX, sy: e.pageY, sl: stage.scrollLeft, st: stage.scrollTop };
      stage.classList.add('grabbing');
    });
    stage.addEventListener('wheel', e => {
      if (!e.ctrlKey) return;
      e.preventDefault(); adjustZoom(e.deltaY < 0 ? 'in' : 'out');
    }, { passive: false });
    stage.addEventListener('touchstart', e => {
      if (e.touches.length === 2) { bkPinchBase = touchDist(e.touches); bkZoomBase = state.bracketZoom || 0.62; }
    }, { passive: true });
    stage.addEventListener('touchmove', e => {
      if (e.touches.length === 2 && bkPinchBase) {
        const z = Math.max(0.35, Math.min(1.8, bkZoomBase * (touchDist(e.touches) / bkPinchBase)));
        state.bracketZoom = +z.toFixed(2);
        const el = document.getElementById('bracketZoom');
        if (el) el.style.zoom = state.bracketZoom;
        const lbl = document.querySelector('.bk-zlabel');
        if (lbl) lbl.textContent = Math.round(state.bracketZoom * 100) + '%';
      }
    }, { passive: true });
  }
  function bindBracketWindowEvents() {
    window.addEventListener('mousemove', e => {
      if (!bkDrag) return;
      bkDrag.stage.scrollLeft = bkDrag.sl - (e.pageX - bkDrag.sx);
      bkDrag.stage.scrollTop = bkDrag.st - (e.pageY - bkDrag.sy);
    });
    window.addEventListener('mouseup', () => {
      if (bkDrag) { bkDrag.stage.classList.remove('grabbing'); bkDrag = null; }
    });
  }
  function touchDist(touches) {
    const dx = touches[0].pageX - touches[1].pageX, dy = touches[0].pageY - touches[1].pageY;
    return Math.hypot(dx, dy);
  }

  function statusBadge(m) {
    const st = matchStatus(m);
    if (hasManual(m)) return '<span class="badge fin">已结束</span>';
    if (st === 'live') return '<span class="badge live">● 进行中</span>';
    if (st === 'finished') return '<span class="badge fin">已结束</span>';
    return '<span class="badge up">未开赛</span>';
  }

  function topLabel(m) {
    return m.knockout ? m.stage : `${m.stage} · ${m.group}组`;
  }

  function teamCell(side, info, followedSet) {
    const known = !!info.name;
    const fol = known && followedSet.has(info.name);
    const flagEl = known ? flag(info.name) : '❓';
    const name = known ? `${fol ? '⭐' : ''}${info.name}` : info.label;
    return `<div class="team ${side}">
      <div class="flag">${flagEl}</div>
      <div class="tname ${known ? '' : 'muted'}">${name}</div>
    </div>`;
  }

  function matchCard(m, user, followedSet, allModes) {
    const t = teamsOf(m);
    const known = !!t.home.name && !!t.away.name;
    const r = getMatchResult(m);
    let center;
    if (showsScore(m)) {
      const tag = `<div class="venue">${RESULT_TAG[r.source]}</div>`;
      center = `<div class="score">${r.home} : ${r.away}</div>${tag}`;
    } else {
      center = `<div class="vs">VS</div><div class="time">${fmtTime(m.kickoff)}</div><div class="venue">${m.venue}</div>`;
    }

    const pick = user && user.bets ? user.bets[m.id] : null;
    let foot = '';
    const bettable = !isSettled(m) && matchStatus(m) === 'upcoming' && known;
    if (bettable) {
      let segs = `<div class="bet-seg"><div class="seg-l">胜平负 <i>+${POINTS.wdl}</i></div>${betRow(m, t, pick)}</div>`;
      if (allModes) {
        segs += `<div class="bet-seg"><div class="seg-l">比分 <i>+${POINTS.score}</i></div>${scoreInputs(m, t, user && user.scoreBets)}</div>`;
        segs += `<div class="bet-seg"><div class="seg-l">总进球 <i>+${POINTS.goals}</i></div>${goalButtons(m, user && user.goalBets)}</div>`;
      }
      foot = `<div class="match-foot">${segs}</div>`;
    } else if (!known && m.knockout && !showsScore(m)) {
      foot = `<div class="match-foot"><div class="bet-result"><span class="muted">对阵确定后可竞猜</span></div></div>`;
    } else if (showsScore(m)) {
      foot = `<div class="match-foot">${betResult(m, t, pick)}</div>`;
    }

    return `
      <div class="match" data-match="${m.id}">
        <div class="match-top"><span class="grp">${topLabel(m)}</span>${statusBadge(m)}</div>
        <div class="match-body">
          ${teamCell('home', t.home, followedSet)}
          <div class="center">${center}</div>
          ${teamCell('away', t.away, followedSet)}
        </div>
        ${foot}
      </div>`;
  }

  function betRow(m, t, pick) {
    const opt = (key, cls, label) =>
      `<button class="bet-btn ${cls} ${pick === key ? 'sel' : ''}" data-bet="${m.id}" data-pick="${key}">
        ${label}<small>${pick === key ? '已选' : '猜这个'}</small></button>`;
    const home = opt('home', 'win', `${t.home.name}胜`);
    const away = opt('away', 'lose', `${t.away.name}胜`);
    if (m.knockout) return `<div class="bet-row">${home}${away}</div>`; // 淘汰赛无平局
    return `<div class="bet-row">${home}${opt('draw', 'draw', '平局')}${away}</div>`;
  }

  // 比分输入行（赛程内联 / 比分竞猜栏目共用）
  function scoreInputs(m, t, scoreBets) {
    const cur = scoreBets && scoreBets[m.id];
    return `<div class="sb-row sb-inline">
      <span class="sb-team">${flag(t.home.name)} ${t.home.name}</span>
      <input class="sb-in" data-scorebet="${m.id}" data-sk="home" type="number" min="0" max="20" inputmode="numeric" value="${cur ? cur.home : ''}" placeholder="-" />
      <span class="sb-colon">:</span>
      <input class="sb-in" data-scorebet="${m.id}" data-sk="away" type="number" min="0" max="20" inputmode="numeric" value="${cur ? cur.away : ''}" placeholder="-" />
      <span class="sb-team sb-team-r">${t.away.name} ${flag(t.away.name)}</span>
      ${cur ? `<button class="sb-clear" data-scoreclear="${m.id}">清除</button>` : ''}
    </div>`;
  }
  // 总进球按钮组（赛程内联 / 总进球栏目共用）
  function goalButtons(m, goalBets) {
    const cur = goalBets && goalBets[m.id];
    const opts = [0, 1, 2, 3, 4, 5, 6];
    return `<div class="gb-opts">${opts.map(n =>
      `<button class="goal-btn ${cur === n ? 'sel' : ''}" data-goalbet="${m.id}" data-goals="${n}">${n === 6 ? '6+' : n}</button>`).join('')}</div>`;
  }

  function pickLabel(m, t, pick) {
    if (pick === 'home') return `${t.home.name || t.home.label}胜`;
    if (pick === 'away') return `${t.away.name || t.away.label}胜`;
    if (pick === 'draw') return '平局';
    return '';
  }

  function betResult(m, t, pick) {
    if (!pick) return `<div class="bet-result"><span class="muted">你未参与竞猜</span><span class="pill none">—</span></div>`;
    if (isSettled(m)) {
      const ok = pick === matchOutcome(m);
      return `<div class="bet-result"><span>你猜：<b>${pickLabel(m, t, pick)}</b></span>
        <span class="pill ${ok ? 'ok' : 'no'}">${ok ? `猜中 +${POINTS_CORRECT}` : '未猜中'}</span></div>`;
    }
    return `<div class="bet-result"><span>你猜：<b>${pickLabel(m, t, pick)}</b></span>
      <span class="pill wait">比赛进行中</span></div>`;
  }

  // ---------- 渲染：关注（我的球队，无需登录） ----------
  function renderFollow() {
    const followed = new Set(currentFollowed());
    const view = state.followView || 'teams';
    const toggle = `<div class="filter-bar">
      <button class="chip ${view === 'teams' ? 'active' : ''}" data-followview="teams">选择球队</button>
      <button class="chip ${view === 'schedule' ? 'active' : ''}" data-followview="schedule">我的赛程</button></div>`;
    let html = `<div class="section-title">⭐ 我的球队 <span class="count">已关注 ${followed.size} 支</span></div>` + toggle;
    if (!currentUser()) {
      html += `<div class="card" style="font-size:12px;color:var(--muted);padding:10px 14px;margin-bottom:12px">
        当前未登录，关注会保存在本设备。<a href="#" id="goLogin" style="color:var(--accent);font-weight:700;text-decoration:none">登录/注册</a> 后可同步到账号并参与竞猜。</div>`;
    }
    html += view === 'schedule' ? renderFollowedSchedule(followed) : renderTeamPicker(followed);
    return html;
  }

  // 选择感兴趣的球队
  function renderTeamPicker(followed) {
    const filters = [{ k: 'all', label: '全部小组' }].concat(GROUP_NAMES.map(g => ({ k: g, label: `${g}组` })));
    const bar = `<div class="filter-bar">${filters.map(f =>
      `<button class="chip ${state.teamGroupFilter === f.k ? 'active' : ''}" data-gfilter="${f.k}">${f.label}</button>`
    ).join('')}</div>`;
    const showGroups = state.teamGroupFilter === 'all' ? GROUPS : GROUPS.filter(g => g.name === state.teamGroupFilter);
    let html = `<div style="font-size:12px;color:var(--muted);margin:2px 2px 8px">点击球队即可关注/取消，关注后可在「我的赛程」查看全部比赛</div>` + bar;
    showGroups.forEach(g => {
      html += `<div class="group-block"><h3><span class="tag">${g.name}组</span></h3><div class="group-grid">`;
      g.teams.forEach(t => {
        const on = followed.has(t);
        html += `<div class="team-cell ${on ? 'followed' : ''}" data-team="${t}">
          <div class="flag">${flag(t)}</div>
          <div class="info"><div class="tname">${t}</div><div class="grp">${g.name}组</div></div>
          <div class="star">${on ? '⭐' : '☆'}</div></div>`;
      });
      html += `</div></div>`;
    });
    return html;
  }

  // 单场比赛行（列表 / 月历 共用）
  function followMatchRow(m, followed) {
    const t = teamsOf(m);
    const hF = t.home.name && followed.has(t.home.name), aF = t.away.name && followed.has(t.away.name);
    const hn = t.home.name ? `${flag(t.home.name)} ${t.home.name}` : t.home.label;
    const an = t.away.name ? `${flag(t.away.name)} ${t.away.name}` : t.away.label;
    const r = getMatchResult(m);
    const mid = showsScore(m)
      ? `<span style="font-weight:800;color:var(--navy)"> ${r.home} : ${r.away} </span>`
      : `<span class="muted"> vs </span>`;
    return `<div class="cal-match">
        <div class="cal-time">${fmtTime(m.kickoff)}</div>
        <div class="cal-info">
          <div class="cal-teams"><span class="${hF ? 'cal-foll' : ''}">${hn}</span>${mid}<span class="${aF ? 'cal-foll' : ''}">${an}</span></div>
          <div class="cal-sub">${topLabel(m)} · ${m.venue}</div></div></div>`;
  }

  // 关注球队的全部赛程（看球日历：列表 / 月历）
  function renderFollowedSchedule(followed) {
    const list = MATCHES.filter(m => followsMatch(m, followed));
    if (list.length === 0) {
      return emptyBlock('⭐', '你还没有关注球队<br/>切到「选择球队」挑选感兴趣的队伍<br/>关注后这里会汇总它们的全部赛程');
    }
    const byDate = {};
    list.forEach(m => { const k = fmtDateKey(m.kickoff); (byDate[k] = byDate[k] || []).push(m); });
    const teamsLine = [...followed].map(t => `${flag(t)}${t}`).join('  ');
    const mode = state.scheduleViewMode || 'list';
    let html = `<div style="font-size:12px;color:var(--muted);margin:2px 2px 10px">已关注：${teamsLine}</div>`;
    html += `<div class="filter-bar">
      <button class="chip ${mode === 'list' ? 'active' : ''}" data-scheduleview="list">📋 列表</button>
      <button class="chip ${mode === 'calendar' ? 'active' : ''}" data-scheduleview="calendar">🗓️ 月历</button></div>`;
    html += `<button class="btn-ghost" id="exportIcs" style="margin-bottom:14px">⬇️ 导出到手机日历 (.ics)</button>`;
    html += mode === 'calendar' ? renderMonthCalendar(byDate, followed) : renderScheduleList(byDate, followed);
    return html;
  }

  function renderScheduleList(byDate, followed) {
    let html = '';
    Object.keys(byDate).sort().forEach(k => {
      const { main, dow } = fmtDateLabel(k);
      html += `<div class="date-head" style="position:static;padding-left:2px">${main} <span class="dow">${dow}</span></div>`;
      byDate[k].forEach(m => { html += followMatchRow(m, followed); });
    });
    return html;
  }

  // 月历视图：周一~周日排列，标记有比赛的日期，点选某天看当天比赛
  function renderMonthCalendar(byDate, followed) {
    const dateKeys = Object.keys(byDate).sort();
    const months = [];
    dateKeys.forEach(k => {
      const d = new Date(k + 'T00:00:00');
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (!months.some(x => x.key === key)) months.push({ key, year: d.getFullYear(), month: d.getMonth() });
    });
    const selected = (state.selectedDay && byDate[state.selectedDay]) ? state.selectedDay : dateKeys[0];
    const WD = ['一', '二', '三', '四', '五', '六', '日'];
    let html = '';
    months.forEach(mo => {
      html += `<div class="cal-month"><div class="cal-month-title">${mo.year}年${mo.month + 1}月</div>`;
      html += `<div class="cal-grid">` + WD.map(w => `<div class="cal-wd">${w}</div>`).join('');
      const startCol = (new Date(mo.year, mo.month, 1).getDay() + 6) % 7; // 周一为第一列
      const days = new Date(mo.year, mo.month + 1, 0).getDate();
      for (let i = 0; i < startCol; i++) html += `<div class="cal-cell empty"></div>`;
      for (let d = 1; d <= days; d++) {
        const k = `${mo.year}-${String(mo.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const ms = byDate[k];
        if (ms) {
          html += `<div class="cal-cell has ${k === selected ? 'sel' : ''}" data-calday="${k}">
            <span class="cd-n">${d}</span><span class="cd-badge">${ms.length}</span></div>`;
        } else {
          html += `<div class="cal-cell"><span class="cd-n off">${d}</span></div>`;
        }
      }
      html += `</div></div>`;
    });
    if (selected) {
      const { main, dow } = fmtDateLabel(selected);
      html += `<div class="date-head" style="position:static;padding-left:2px">${main} <span class="dow">${dow}</span><span class="count" style="margin-left:auto">${byDate[selected].length} 场</span></div>`;
      byDate[selected].forEach(m => { html += followMatchRow(m, followed); });
    }
    return html;
  }

  function buildIcs(followedArr) {
    const followed = new Set(followedArr);
    const list = MATCHES.filter(m => followsMatch(m, followed));
    const pad = n => String(n).padStart(2, '0');
    const toUtc = iso => {
      const d = new Date(iso);
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
    };
    const esc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const stamp = toUtc(new Date().toISOString());
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WorldCup2026//H5//CN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    list.forEach(m => {
      const t = teamsOf(m);
      const hn = t.home.name || t.home.label, an = t.away.name || t.away.label;
      const end = new Date(new Date(m.kickoff).getTime() + MATCH_DURATION_MS);
      lines.push('BEGIN:VEVENT', `UID:${m.id}@worldcup2026`, `DTSTAMP:${stamp}`, `DTSTART:${toUtc(m.kickoff)}`,
        `DTEND:${toUtc(end.toISOString())}`, `SUMMARY:${esc('⚽ ' + hn + ' vs ' + an)}`,
        `LOCATION:${esc(m.venue)}`, `DESCRIPTION:${esc('2026 世界杯 ' + topLabel(m))}`, 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  // ---------- 渲染：竞猜（胜平负 / 比分 / 总进球 / 冠军） ----------
  // 可竞猜的比赛：未开赛、未结算、且对阵已确定
  function bettableMatches() {
    return MATCHES.filter(m => matchStatus(m) === 'upcoming' && !isSettled(m))
      .filter(m => { const t = teamsOf(m); return t.home.name && t.away.name; });
  }
  function betDateGroups(list) {
    const byDate = {};
    list.forEach(m => { const k = fmtDateKey(m.kickoff); (byDate[k] = byDate[k] || []).push(m); });
    return byDate;
  }

  const GUEST_USER = { bets: {}, scoreBets: {}, goalBets: {}, championBet: null, followed: [] };
  function renderBet() {
    const realUser = currentUser();
    const user = realUser || GUEST_USER;
    const view = state.betView || 'wdl';
    const tabs = [
      ['wdl', '胜平负', `+${POINTS.wdl}`],
      ['score', '比分', `+${POINTS.score}`],
      ['goals', '总进球', `+${POINTS.goals}`],
      ['champion', '冠军', `+${POINTS.champion}`],
    ];
    const toggle = `<div class="filter-bar">${tabs.map(([k, l]) =>
      `<button class="chip ${view === k ? 'active' : ''}" data-betview="${k}">${l}</button>`).join('')}</div>`;
    const stats = userStats(user);
    let head = '';
    if (!realUser) {
      head += `<div class="card guest-banner">👀 浏览模式：可自由查看各类竞猜玩法，<a href="#" id="goLogin">登录 / 注册</a> 后即可提交并计入积分。</div>`;
    } else {
      head += `<div class="stat-row">
        <div class="stat"><div class="n">${stats.points}</div><div class="l">我的积分</div></div>
        <div class="stat"><div class="n">${stats.wdl.correct + stats.score.correct + stats.goals.correct}</div><div class="l">已猜中</div></div>
        <div class="stat"><div class="n">${stats.wdl.total + stats.score.total + stats.goals.total + (stats.champion.picked ? 1 : 0)}</div><div class="l">已参与</div></div>
      </div>`;
    }
    head += toggle;
    let body;
    if (view === 'score') body = renderScoreBet(user, stats);
    else if (view === 'goals') body = renderGoalBet(user, stats);
    else if (view === 'champion') body = renderChampionBet(user, stats);
    else body = renderWdlBet(user, stats);
    return head + body;
  }

  function betRuleCard(text) {
    return `<div class="card" style="font-size:12px;color:var(--muted);padding:10px 14px;margin-bottom:12px">${text}</div>`;
  }

  // 胜平负
  function renderWdlBet(user, stats) {
    const known = bettableMatches();
    let html = betRuleCard(`猜中一场比赛的<b>胜 / 平 / 负</b>得 <b style="color:var(--navy)">${POINTS.wdl}</b> 分。已命中 ${stats.wdl.correct} 场。`);
    html += `<div class="section-title">🎯 胜平负竞猜 <span class="count">${known.length} 场可猜</span></div>`;
    if (known.length === 0) return html + emptyBlock('🎉', '当前没有可竞猜的比赛');
    const followed = new Set(user.followed);
    const byDate = betDateGroups(known);
    Object.keys(byDate).sort().forEach(k => {
      const { main, dow } = fmtDateLabel(k);
      html += `<div class="date-head">${main} <span class="dow">${dow}</span></div>`;
      byDate[k].forEach(m => { html += matchCard(m, user, followed); });
    });
    return html;
  }

  // 比分竞猜
  function renderScoreBet(user, stats) {
    const known = bettableMatches();
    const sb = user.scoreBets || {};
    let html = betRuleCard(`精准猜中一场比赛的<b>最终比分</b>得 <b style="color:var(--navy)">${POINTS.score}</b> 分（难度最高）。已命中 ${stats.score.correct} 场。`);
    html += `<div class="section-title">🔢 比分竞猜 <span class="count">${known.length} 场可猜</span></div>`;
    if (known.length === 0) return html + emptyBlock('🎉', '当前没有可竞猜的比赛');
    const byDate = betDateGroups(known);
    Object.keys(byDate).sort().forEach(k => {
      const { main, dow } = fmtDateLabel(k);
      html += `<div class="date-head">${main} <span class="dow">${dow}</span></div>`;
      byDate[k].forEach(m => {
        const t = teamsOf(m);
        const cur = sb[m.id];
        html += `<div class="card scorebet-card">
          <div class="sb-top">${topLabel(m)} · ${fmtTime(m.kickoff)}${cur ? `<span class="sb-cur">已猜 ${cur.home}:${cur.away}</span>` : ''}</div>
          <div class="sb-row">
            <span class="sb-team">${flag(t.home.name)} ${t.home.name}</span>
            <input class="sb-in" data-scorebet="${m.id}" data-sk="home" type="number" min="0" max="20" inputmode="numeric" value="${cur ? cur.home : ''}" placeholder="-" />
            <span class="sb-colon">:</span>
            <input class="sb-in" data-scorebet="${m.id}" data-sk="away" type="number" min="0" max="20" inputmode="numeric" value="${cur ? cur.away : ''}" placeholder="-" />
            <span class="sb-team sb-team-r">${t.away.name} ${flag(t.away.name)}</span>
          </div>
          ${cur ? `<button class="sb-clear" data-scoreclear="${m.id}">清除</button>` : ''}
        </div>`;
      });
    });
    return html;
  }

  // 总进球数
  function renderGoalBet(user, stats) {
    const known = bettableMatches();
    const gb = user.goalBets || {};
    let html = betRuleCard(`猜中一场比赛的<b>总进球数</b>得 <b style="color:var(--navy)">${POINTS.goals}</b> 分（「6+」代表 6 球及以上）。已命中 ${stats.goals.correct} 场。`);
    html += `<div class="section-title">⚽ 总进球数竞猜 <span class="count">${known.length} 场可猜</span></div>`;
    if (known.length === 0) return html + emptyBlock('🎉', '当前没有可竞猜的比赛');
    const opts = [0, 1, 2, 3, 4, 5, 6];
    const byDate = betDateGroups(known);
    Object.keys(byDate).sort().forEach(k => {
      const { main, dow } = fmtDateLabel(k);
      html += `<div class="date-head">${main} <span class="dow">${dow}</span></div>`;
      byDate[k].forEach(m => {
        const t = teamsOf(m);
        const cur = gb[m.id];
        const btns = opts.map(n => `<button class="goal-btn ${cur === n ? 'sel' : ''}" data-goalbet="${m.id}" data-goals="${n}">${n === 6 ? '6+' : n}</button>`).join('');
        html += `<div class="card goalbet-card">
          <div class="gb-top"><span>${flag(t.home.name)} ${t.home.name} vs ${t.away.name} ${flag(t.away.name)}</span><span class="muted">${fmtTime(m.kickoff)}</span></div>
          <div class="gb-opts">${btns}</div>
        </div>`;
      });
    });
    return html;
  }

  // 最终冠军
  function renderChampionBet(user, stats) {
    const picked = user.championBet || null;
    const champ = finalChampion();
    const open = championBetOpen();
    let html = betRuleCard(`<b>仅小组赛期间</b>可预测<b>最终冠军</b>，淘汰赛开始后截止、不可更改。决赛结束后若命中得 <b style="color:var(--navy)">${POINTS.champion}</b> 分。`);
    const statusLine = champ
      ? `冠军已产生：${flag(champ)} ${champ} · ${stats.champion.correct ? '🎉 命中！' : '未命中'}`
      : (open ? '冠军竞猜进行中（小组赛期间）' : '冠军竞猜已截止（淘汰赛已开始）');
    html += `<div class="card champ-now">
      <div>我的冠军预测：<b>${picked ? `${flag(picked)} ${picked}` : '尚未选择'}</b></div>
      <div class="muted" style="font-size:12px;margin-top:4px">${statusLine}</div>
    </div>`;
    if (!open) return html; // 小组赛结束后仅展示，不可再选
    GROUPS.forEach(g => {
      html += `<div class="group-block"><h3><span class="tag">${g.name}组</span></h3><div class="group-grid">`;
      g.teams.forEach(team => {
        const on = picked === team;
        html += `<div class="team-cell ${on ? 'followed' : ''}" data-champion="${team}">
          <div class="flag">${flag(team)}</div>
          <div class="info"><div class="tname">${team}</div><div class="grp">${g.name}组</div></div>
          <div class="star">${on ? '👑' : '○'}</div></div>`;
      });
      html += `</div></div>`;
    });
    return html;
  }

  // ---------- 渲染：积分榜（玩家 / 球队） ----------
  function renderRank() {
    const toggle = `<div class="filter-bar">
      <button class="chip ${state.rankView === 'teams' ? 'active' : ''}" data-rankview="teams">球队榜（各小组）</button>
      <button class="chip ${state.rankView === 'users' ? 'active' : ''}" data-rankview="users">玩家榜</button></div>`;
    if (state.rankView === 'teams') {
      return `<div class="section-title">🏅 球队积分榜 <span class="count">各小组</span></div>` + toggle + renderTeamStandings();
    }
    const board = leaderboard();
    const me = currentUsername();
    let html = `<div class="section-title">🏅 玩家积分榜 <span class="count">${board.length} 位玩家</span></div>` + toggle;
    html += `<div class="card" style="font-size:12px;color:var(--muted);padding:10px 14px;margin-bottom:14px">
      规则：猜中一场比赛胜平负得 <b style="color:var(--navy)">${POINTS_CORRECT}</b> 分，未猜中不扣分。比赛结束（或录入真实比分）后自动结算。</div>`;
    if (board.length === 0) return html + emptyBlock('🏅', '还没有玩家参与');
    board.forEach((u, i) => {
      const rank = i + 1;
      const topCls = rank === 1 ? 'top1' : rank === 2 ? 'top2' : rank === 3 ? 'top3' : '';
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
      const isMe = u.username === me;
      html += `<div class="rank-item ${isMe ? 'me' : ''}">
          <div class="rank-no ${topCls}">${medal}</div>
          <div class="rank-avatar">${u.username.slice(0, 1)}</div>
          <div class="rank-main"><div class="rank-name">${u.username}${isMe ? '<span class="me-tag">我</span>' : ''}</div>
            <div class="rank-meta">已结算 ${u.settled} 场 · 猜中 ${u.correct} 场${u.pending ? ` · 待开赛 ${u.pending}` : ''}</div></div>
          <div class="rank-pts"><span class="n">${u.points}</span> <span class="u">分</span></div></div>`;
    });
    return html;
  }

  // 球队积分榜：各小组实时排名表
  function renderTeamStandings() {
    const followed = new Set(currentFollowed());
    let html = `<div class="card" style="font-size:12px;color:var(--muted);padding:10px 14px;margin-bottom:12px">
      胜 3 分 / 平 1 分 / 负 0 分，按 积分 → 净胜球 → 进球 排序。<span style="color:var(--win)">绿</span>=前两名出线区，<span style="color:var(--draw)">橙</span>=小组第三（争最佳第三名）。</div>`;
    GROUPS.forEach(g => {
      const tbl = liveGroupTable(g.name);
      html += `<div class="card standing-card">
        <div class="standing-title"><span class="tag">${g.name}组</span></div>
        <div class="standing-row standing-th">
          <span class="c-rank">#</span><span class="c-team">球队</span>
          <span class="c-n">场</span><span class="c-n">胜</span><span class="c-n">平</span><span class="c-n">负</span><span class="c-n">净</span><span class="c-pts">分</span></div>`;
      tbl.forEach((row, i) => {
        const qual = i < 2 ? 'q1' : i === 2 ? 'q3' : '';
        const mine = followed.has(row.team) ? 'mine' : '';
        html += `<div class="standing-row ${qual} ${mine}">
          <span class="c-rank">${i + 1}</span>
          <span class="c-team">${flag(row.team)} ${row.team}</span>
          <span class="c-n">${row.played}</span>
          <span class="c-n">${row.w}</span><span class="c-n">${row.d}</span><span class="c-n">${row.l}</span>
          <span class="c-n">${row.gd > 0 ? '+' : ''}${row.gd}</span>
          <span class="c-pts">${row.pts}</span></div>`;
      });
      html += `</div>`;
    });
    return html;
  }

  // ---------- 渲染：我的 + 赛果录入 ----------
  function renderMe() {
    const user = currentUser();
    if (!user) return renderAuth();
    const stats = userStats(user);
    const board = leaderboard();
    const myRank = board.findIndex(u => u.username === user.username) + 1;
    return `
      <div class="profile-head">
        <div class="pavatar">${user.username.slice(0, 1)}</div>
        <div class="pname">${user.username}</div>
        <div class="pmeta">世界杯竞猜玩家 · 当前第 ${myRank} 名</div>
        <div class="profile-stats">
          <div class="ps"><div class="n">${stats.points}</div><div class="l">积分</div></div>
          <div class="ps"><div class="n">${stats.correct}/${stats.settled}</div><div class="l">猜中/已结算</div></div>
          <div class="ps"><div class="n">${user.followed.length}</div><div class="l">关注球队</div></div>
        </div>
      </div>
      <div class="list-row" data-goto="follow"><span>⭐ 我的球队与专属赛程</span><span class="r">${user.followed.length} 支 ›</span></div>
      <div class="list-row" data-goto="rank"><span>🏅 积分榜（玩家 / 球队）</span><span class="r">›</span></div>
      ${renderAdmin()}
      <div class="list-row danger" id="logoutBtn">退出登录</div>`;
  }

  // 赛果录入：对已开赛/已录入的比赛录入真实比分，覆盖演示比分
  function renderAdmin() {
    const list = MATCHES.filter(m => matchStatus(m) !== 'upcoming' || hasManual(m));
    const head = `<div class="list-row" id="adminToggle">
        <span>🛠️ 赛果录入（管理） <span class="r" style="font-weight:600">${list.length} 场可录入</span></span>
        <span class="r">${state.adminOpen ? '收起 ▲' : '展开 ▼'}</span></div>`;
    if (!state.adminOpen) return head;
    if (list.length === 0) {
      return head + `<div class="card" style="color:var(--muted);font-size:13px">暂无已开赛的比赛。比赛开赛后可在此录入真实比分以覆盖模拟比分，积分与淘汰赛对阵会自动更新。</div>`;
    }
    let rows = `<div class="card" style="font-size:12px;color:var(--muted);margin-bottom:10px">
      录入真实比分后将覆盖"模拟比分"，并实时重新结算积分、推算淘汰赛对阵。点「恢复」可还原为模拟比分。</div>`;
    const byDate = {};
    list.forEach(m => { const k = fmtDateKey(m.kickoff); (byDate[k] = byDate[k] || []).push(m); });
    Object.keys(byDate).sort().forEach(k => {
      const { main, dow } = fmtDateLabel(k);
      rows += `<div class="date-head" style="position:static;padding-left:2px">${main} <span class="dow">${dow}</span></div>`;
      byDate[k].forEach(m => {
        const t = teamsOf(m);
        const r = getMatchResult(m);
        const hn = t.home.name ? `${flag(t.home.name)} ${t.home.name}` : t.home.label;
        const an = t.away.name ? `${flag(t.away.name)} ${t.away.name}` : t.away.label;
        rows += `<div class="card" style="padding:11px 13px;margin-bottom:9px">
          <div style="font-size:11px;color:var(--muted);margin-bottom:8px">${topLabel(m)} · 当前${RESULT_TAG[r.source]}</div>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="flex:1;font-weight:700;font-size:13px;text-align:right">${hn}</div>
            <input class="adm-in" data-score="${m.id}-home" type="number" min="0" max="20" value="${r.home}"
              style="width:42px;text-align:center;padding:7px 0;border-radius:9px;border:1.5px solid var(--line);font-size:15px" />
            <span style="color:var(--muted);font-weight:700">:</span>
            <input class="adm-in" data-score="${m.id}-away" type="number" min="0" max="20" value="${r.away}"
              style="width:42px;text-align:center;padding:7px 0;border-radius:9px;border:1.5px solid var(--line);font-size:15px" />
            <div style="flex:1;font-weight:700;font-size:13px">${an}</div>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="bet-btn win" data-save="${m.id}" style="flex:2">保存真实比分</button>
            ${hasManual(m) ? `<button class="bet-btn" data-clear="${m.id}" style="flex:1">恢复演示</button>` : ''}
          </div></div>`;
      });
    });
    return head + rows;
  }

  // ---------- 注册/登录 ----------
  function renderAuth() {
    const isLogin = state.authMode === 'login';
    return `<div class="card auth-card">
        <h2>${isLogin ? '一起加入罗莉球友俱乐部 ⚽' : '创建账号 🎉'}</h2>
        <p class="sub">${isLogin ? '登录后关注球队、参与竞猜、冲击积分榜' : '注册一个账号，开启你的世界杯竞猜之旅'}</p>
        <form id="authForm">
          <div class="field"><label>用户名</label>
            <input name="username" type="text" placeholder="2~12 个字符" autocomplete="off" maxlength="12" /></div>
          <div class="field"><label>密码</label>
            <input name="password" type="password" placeholder="至少 6 位" autocomplete="off" /></div>
          <div class="form-err">${state.authError || ''}</div>
          <button type="submit" class="btn-primary">${isLogin ? '登 录' : '注册并登录'}</button>
        </form>
        <div class="switch-line">${isLogin ? '还没有账号？' : '已有账号？'}
          <a href="#" id="switchAuth">${isLogin ? '去注册' : '去登录'}</a></div></div>`;
  }
  function loginPrompt(text) {
    return `<div class="card auth-card" style="text-align:center">
      <div style="font-size:40px;margin-bottom:8px">🔒</div>
      <p class="sub" style="margin-bottom:18px">${text}</p>
      <button class="btn-primary" id="goLogin">去登录 / 注册</button></div>`;
  }
  function emptyBlock(emoji, text) { return `<div class="empty"><span class="emoji">${emoji}</span>${text}</div>`; }

  // ---------- 主渲染 ----------
  function render() {
    const view = $('#view');
    let html = '';
    switch (state.tab) {
      case 'schedule': html = renderSchedule(); break;
      case 'follow': html = renderFollow(); break;
      case 'bet': html = renderBet(); break;
      case 'rank': html = renderRank(); break;
      case 'me': html = renderMe(); break;
    }
    view.innerHTML = html;
    renderHeaderUser();
    syncTabbar();
    if (state.tab === 'schedule' && state.scheduleView === 'bracket') setupBracketGestures();
  }
  function renderHeaderUser() {
    const el = $('#headerUser');
    const user = currentUser();
    if (user) {
      const stats = userStats(user);
      el.innerHTML = `<span class="uname">${user.username}</span> · <span class="upts">${stats.points}分</span>`;
    } else {
      el.innerHTML = `<button class="header-login-btn" id="hLogin">登录</button>`;
    }
  }
  function syncTabbar() {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === state.tab));
  }
  function go(tab) { state.tab = tab; state.authError = ''; render(); }

  // ---------- 事件 ----------
  function bindEvents() {
    $('#tabbar').addEventListener('click', e => {
      const btn = e.target.closest('.tab');
      if (btn) go(btn.dataset.tab);
    });
    $('#view').addEventListener('click', e => {
      const sf = e.target.closest('[data-sfilter]');
      if (sf) { state.scheduleFilter = sf.dataset.sfilter; return render(); }
      const gf = e.target.closest('[data-gfilter]');
      if (gf) { state.teamGroupFilter = gf.dataset.gfilter; return render(); }
      const fv = e.target.closest('[data-followview]');
      if (fv) { state.followView = fv.dataset.followview; return render(); }
      const svw = e.target.closest('[data-scheduleview]');
      if (svw) { state.scheduleViewMode = svw.dataset.scheduleview; return render(); }
      const cd = e.target.closest('[data-calday]');
      if (cd) { state.selectedDay = cd.dataset.calday; return render(); }
      const rv = e.target.closest('[data-rankview]');
      if (rv) { state.rankView = rv.dataset.rankview; return render(); }
      const sm = e.target.closest('[data-schedmode]');
      if (sm) { state.scheduleView = sm.dataset.schedmode; return render(); }
      const zb = e.target.closest('[data-zoom]');
      if (zb) return adjustZoom(zb.dataset.zoom);
      const bv = e.target.closest('[data-betview]');
      if (bv) { state.betView = bv.dataset.betview; return render(); }
      const gt = e.target.closest('[data-goto]');
      if (gt) return go(gt.dataset.goto);
      const tc = e.target.closest('[data-team]');
      if (tc) return toggleFollow(tc.dataset.team);
      const cb = e.target.closest('[data-champion]');
      if (cb) return pickChampion(cb.dataset.champion);
      const gbn = e.target.closest('[data-goalbet]');
      if (gbn) return setGoalBet(gbn.dataset.goalbet, parseInt(gbn.dataset.goals, 10));
      const scl = e.target.closest('[data-scoreclear]');
      if (scl) return clearScoreBet(scl.dataset.scoreclear);
      const bb = e.target.closest('[data-bet]');
      if (bb) return placeBet(bb.dataset.bet, bb.dataset.pick);
      const sv = e.target.closest('[data-save]');
      if (sv) return saveResult(sv.dataset.save);
      const cl = e.target.closest('[data-clear]');
      if (cl) return clearResult(cl.dataset.clear);
      if (e.target.closest('#adminToggle')) { state.adminOpen = !state.adminOpen; return render(); }
      if (e.target.id === 'switchAuth') {
        e.preventDefault();
        state.authMode = state.authMode === 'login' ? 'register' : 'login';
        state.authError = ''; return render();
      }
      if (['goLogin', 'hLogin'].includes(e.target.id)) { e.preventDefault(); state.authMode = 'login'; return go('me'); }
      if (e.target.id === 'logoutBtn') return logout();
      if (e.target.id === 'exportIcs') return exportCalendar();
    });
    $('#view').addEventListener('change', e => {
      const si = e.target.closest('[data-scorebet]');
      if (si) maybeSaveScoreBet(si.dataset.scorebet);
    });
    $('#view').addEventListener('submit', e => {
      if (e.target.id === 'authForm') {
        e.preventDefault();
        const fd = new FormData(e.target);
        handleAuth((fd.get('username') || '').trim(), fd.get('password') || '');
      }
    });
    $('#headerUser').addEventListener('click', e => {
      if (e.target.id === 'hLogin') { state.authMode = 'login'; go('me'); }
    });
  }

  // ---------- 业务动作 ----------
  // 登录/注册后，把游客关注合并进账号
  function mergeGuestFollows() {
    const guest = load(LS.guestFollows, []);
    if (!guest.length) return;
    updateCurrentUser(u => {
      guest.forEach(t => { if (!u.followed.includes(t)) u.followed.push(t); });
    });
    localStorage.removeItem(LS.guestFollows);
  }
  function handleAuth(username, password) {
    if (state.authMode === 'register') {
      if (username.length < 2 || username.length > 12) return authErr('用户名需 2~12 个字符');
      if (!password || password.length < 6) return authErr('密码至少 6 位');
      const users = getUsers();
      if (users.some(u => u.username === username)) return authErr('该用户名已被注册');
      users.push({ username, password, followed: [], bets: {} });
      setUsers(users);
      save(LS.session, username);
      mergeGuestFollows();
      toast('注册成功，欢迎加入！🎉');
      state.authError = ''; go('follow');
    } else {
      const u = getUsers().find(x => x.username === username);
      if (!u) return authErr('用户不存在，请先注册');
      if (u.password !== password) return authErr('密码不正确');
      save(LS.session, username);
      mergeGuestFollows();
      toast(`欢迎回来，${username}！`);
      state.authError = ''; go('schedule');
    }
  }
  function authErr(msg) { state.authError = msg; render(); }
  function logout() {
    localStorage.removeItem(LS.session);
    toast('已退出登录');
    state.authMode = 'login'; go('me');
  }
  function toggleFollow(team) {
    if (currentUser()) {
      updateCurrentUser(u => {
        const i = u.followed.indexOf(team);
        if (i >= 0) { u.followed.splice(i, 1); toast(`已取消关注 ${team}`); }
        else { u.followed.push(team); toast(`已关注 ${team} ⭐ 赛程已更新`); }
      });
    } else {
      const arr = load(LS.guestFollows, []);
      const i = arr.indexOf(team);
      if (i >= 0) { arr.splice(i, 1); toast(`已取消关注 ${team}`); }
      else { arr.push(team); toast(`已关注 ${team} ⭐ 赛程已更新`); }
      save(LS.guestFollows, arr);
    }
    render();
  }
  function placeBet(matchId, pick) {
    if (!currentUser()) { state.authMode = 'login'; return go('me'); }
    const m = MATCH_BY_ID[matchId];
    if (!m || isSettled(m) || matchStatus(m) !== 'upcoming') { toast('比赛已开赛，无法竞猜'); return render(); }
    const t = teamsOf(m);
    updateCurrentUser(u => {
      u.bets = u.bets || {};
      if (u.bets[matchId] === pick) { delete u.bets[matchId]; toast('已取消竞猜'); }
      else { u.bets[matchId] = pick; toast(`已选择：${pickLabel(m, t, pick)}`); }
    });
    render();
  }
  // 校验比赛仍可竞猜
  function canBet(matchId) {
    const m = MATCH_BY_ID[matchId];
    return m && !isSettled(m) && matchStatus(m) === 'upcoming';
  }
  // 比分竞猜：两个输入都填好后保存（不触发整页重渲染以保留输入焦点）
  function maybeSaveScoreBet(matchId) {
    if (!currentUser()) { state.authMode = 'login'; return go('me'); }
    if (!canBet(matchId)) { toast('比赛已开赛，无法竞猜'); return render(); }
    const hEl = document.querySelector(`[data-scorebet="${matchId}"][data-sk="home"]`);
    const aEl = document.querySelector(`[data-scorebet="${matchId}"][data-sk="away"]`);
    if (!hEl || !aEl) return;
    if (hEl.value === '' || aEl.value === '') return; // 等两个都填
    const hv = parseInt(hEl.value, 10), av = parseInt(aEl.value, 10);
    if (isNaN(hv) || isNaN(av) || hv < 0 || av < 0) return toast('请输入有效比分');
    const m = MATCH_BY_ID[matchId];
    if (m && m.knockout && hv === av) return toast('淘汰赛不能为平局');
    updateCurrentUser(u => { u.scoreBets = u.scoreBets || {}; u.scoreBets[matchId] = { home: hv, away: av }; });
    toast(`已猜比分 ${hv}:${av} ✅`);
    render();
  }
  function clearScoreBet(matchId) {
    updateCurrentUser(u => { if (u.scoreBets) delete u.scoreBets[matchId]; });
    toast('已清除比分竞猜');
    render();
  }
  function setGoalBet(matchId, n) {
    if (!currentUser()) { state.authMode = 'login'; return go('me'); }
    if (!canBet(matchId)) { toast('比赛已开赛，无法竞猜'); return render(); }
    updateCurrentUser(u => {
      u.goalBets = u.goalBets || {};
      if (u.goalBets[matchId] === n) { delete u.goalBets[matchId]; toast('已取消'); }
      else { u.goalBets[matchId] = n; toast(`已猜总进球 ${n === 6 ? '6+' : n} ⚽`); }
    });
    render();
  }
  function pickChampion(team) {
    if (!currentUser()) { state.authMode = 'login'; return go('me'); }
    if (!championBetOpen()) { toast('淘汰赛已开始，冠军竞猜已截止'); return render(); }
    updateCurrentUser(u => {
      if (u.championBet === team) { u.championBet = null; toast('已取消冠军预测'); }
      else { u.championBet = team; toast(`已预测冠军：${team} 👑`); }
    });
    render();
  }
  function saveResult(matchId) {
    const h = document.querySelector(`[data-score="${matchId}-home"]`);
    const a = document.querySelector(`[data-score="${matchId}-away"]`);
    if (!h || !a) return;
    const hv = parseInt(h.value, 10), av = parseInt(a.value, 10);
    if (isNaN(hv) || isNaN(av) || hv < 0 || av < 0) return toast('请输入有效比分');
    const m = MATCH_BY_ID[matchId];
    if (m && m.knockout && hv === av) return toast('淘汰赛不能为平局，请录入分出胜负的比分');
    const results = getResults();
    results[matchId] = { home: hv, away: av };
    save(LS.results, results);
    toast('真实比分已保存，积分已更新 ✅');
    render();
  }
  function clearResult(matchId) {
    const results = getResults();
    delete results[matchId];
    save(LS.results, results);
    toast('已恢复为模拟比分');
    render();
  }
  async function exportCalendar() {
    const followedArr = currentFollowed();
    if (followedArr.length === 0) return toast('请先关注球队');
    const ics = buildIcs(followedArr);
    const filename = '世界杯2026-我的看球日历.ics';

    // 1) 优先系统分享：iOS/Android 可直接“添加到日历 / 存到文件”
    try {
      if (navigator.canShare && typeof File !== 'undefined') {
        const file = new File([ics], filename, { type: 'text/calendar' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: '世界杯2026 看球日历' });
          return;
        }
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return; // 用户取消
      // 其余情况继续走兜底
    }

    const ua = navigator.userAgent || '';
    const isIOS = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

    // 2) iOS Safari 不支持 a[download]，用 data:URL 触发系统“添加到日历”
    if (isIOS) {
      window.location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
      toast('在弹出的页面点“添加全部”即可导入日历 📅');
      return;
    }

    // 3) 桌面 / 安卓：常规下载
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast('日历已导出，可导入手机日历 📅');
  }

  // ---------- 启动 ----------
  function init() {
    seedDemoUsers();
    bindEvents();
    bindBracketWindowEvents();
    render();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
