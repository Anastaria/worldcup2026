(function () {
  'use strict';

  const { TEAMS, GROUPS, GROUP_NAMES, MATCHES } = window.WC_DATA;
  const MATCH_BY_ID = {};
  MATCHES.forEach(m => { MATCH_BY_ID[m.id] = m; });

  // ---------- 存储 ----------
  const LS = {
    users: 'wc_users',        // [{username, password, followed:[], bets:{matchId:'home'|'draw'|'away'}}]
    session: 'wc_session',    // username
    results: 'wc_results',    // {matchId:{home,away}} 录入的真实比分（覆盖演示比分）
  };
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  // ---------- 状态 ----------
  let state = {
    tab: 'schedule',
    scheduleFilter: 'all', // all | group | knockout | upcoming | mine
    teamGroupFilter: 'all',
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
  // 真实比分优先，否则用演示比分
  function getMatchResult(m) {
    const man = getResults()[m.id];
    if (man) return { home: man.home, away: man.away, real: true };
    return { home: m.result.home, away: m.result.away, real: false };
  }
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

  // 小组排名：所有 6 场均已结算才返回排名数组，否则 null
  function groupStanding(groupName) {
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
      .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team))
      .map(x => x.team);
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

  // ---------- 积分 ----------
  const POINTS_CORRECT = 3;
  function userStats(user) {
    let points = 0, correct = 0, settled = 0, totalBets = 0;
    const bets = user.bets || {};
    MATCHES.forEach(m => {
      const pick = bets[m.id];
      if (!pick) return;
      totalBets++;
      if (isSettled(m)) {
        settled++;
        if (pick === matchOutcome(m)) { correct++; points += POINTS_CORRECT; }
      }
    });
    return { points, correct, settled, totalBets, pending: totalBets - settled };
  }
  function leaderboard() {
    return getUsers()
      .map(u => ({ username: u.username, ...userStats(u) }))
      .sort((a, b) => b.points - a.points || b.correct - a.correct || a.username.localeCompare(b.username));
  }

  // ---------- 演示用户 ----------
  function seedDemoUsers() {
    if (getUsers().length > 0) return;
    const demos = ['梅西铁粉', '老王看球', '足球小将', '冷门收割机', '客厅解说员'];
    const picks = ['home', 'draw', 'away'];
    const users = demos.map((name, i) => {
      const bets = {};
      MATCHES.forEach((m, idx) => {
        if (m.knockout) return; // 演示投注只覆盖小组赛
        if ((idx + i) % 4 !== 0) bets[m.id] = picks[(idx * 7 + i * 3) % 3];
      });
      return { username: name, password: 'demo123', followed: [], bets };
    });
    setUsers(users);
  }

  // ---------- 渲染：赛程 ----------
  function renderSchedule() {
    const user = currentUser();
    const followed = new Set(user ? user.followed : []);
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
    ).join('')}</div>`;

    if (list.length === 0) {
      return bar + emptyBlock('🗓️', state.scheduleFilter === 'mine'
        ? '你还没有关注球队<br/>去「关注」页选择喜欢的球队吧' : '暂无比赛');
    }
    const byDate = {};
    list.forEach(m => { const k = fmtDateKey(m.kickoff); (byDate[k] = byDate[k] || []).push(m); });
    let html = bar;
    Object.keys(byDate).sort().forEach(dateKey => {
      const { main, dow } = fmtDateLabel(dateKey);
      html += `<div class="date-head">${main}<span class="dow">${dow}</span></div>`;
      byDate[dateKey].forEach(m => { html += matchCard(m, user, followed); });
    });
    return html;
  }

  function followsMatch(m, followedSet) {
    const t = teamsOf(m);
    return (t.home.name && followedSet.has(t.home.name)) || (t.away.name && followedSet.has(t.away.name));
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

  function matchCard(m, user, followedSet) {
    const t = teamsOf(m);
    const known = !!t.home.name && !!t.away.name;
    const r = getMatchResult(m);
    let center;
    if (showsScore(m)) {
      const tag = r.real ? '<div class="venue">实际比分</div>' : '<div class="venue">演示比分</div>';
      center = `<div class="score">${r.home} : ${r.away}</div>${tag}`;
    } else {
      center = `<div class="vs">VS</div><div class="time">${fmtTime(m.kickoff)}</div><div class="venue">${m.venue}</div>`;
    }

    const pick = user && user.bets ? user.bets[m.id] : null;
    let foot = '';
    const bettable = !isSettled(m) && matchStatus(m) === 'upcoming' && known;
    if (bettable) {
      foot = `<div class="match-foot">${betRow(m, t, pick)}</div>`;
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

  // ---------- 渲染：关注 ----------
  function renderFollow() {
    const user = currentUser();
    if (!user) return loginPrompt('登录后即可关注球队，并自动生成你的看球日历');
    const followed = new Set(user.followed);
    const filters = [{ k: 'all', label: '全部小组' }].concat(GROUP_NAMES.map(g => ({ k: g, label: `${g}组` })));
    const bar = `<div class="filter-bar">${filters.map(f =>
      `<button class="chip ${state.teamGroupFilter === f.k ? 'active' : ''}" data-gfilter="${f.k}">${f.label}</button>`
    ).join('')}</div>`;
    const showGroups = state.teamGroupFilter === 'all' ? GROUPS : GROUPS.filter(g => g.name === state.teamGroupFilter);
    let html = `<div class="section-title">⭐ 关注球队 <span class="count">已关注 ${followed.size} 支</span></div>` + bar;
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

  // ---------- 渲染：看球日历 ----------
  function renderCalendar() {
    const user = currentUser();
    const followed = new Set(user.followed);
    const list = MATCHES.filter(m => followsMatch(m, followed));
    if (list.length === 0) return emptyBlock('📅', '关注球队后<br/>这里会自动生成你的看球日历');
    const byDate = {};
    list.forEach(m => { const k = fmtDateKey(m.kickoff); (byDate[k] = byDate[k] || []).push(m); });
    let html = `<div class="section-title">📅 我的看球日历 <span class="count">共 ${list.length} 场</span></div>`;
    html += `<button class="btn-ghost" id="exportIcs" style="margin-bottom:14px">⬇️ 导出到手机日历 (.ics)</button>`;
    Object.keys(byDate).sort().forEach(k => {
      const { main, dow } = fmtDateLabel(k);
      html += `<div class="date-head" style="position:static;padding-left:2px">${main} <span class="dow">${dow}</span></div>`;
      byDate[k].forEach(m => {
        const t = teamsOf(m);
        const hF = t.home.name && followed.has(t.home.name), aF = t.away.name && followed.has(t.away.name);
        const hn = t.home.name ? `${flag(t.home.name)} ${t.home.name}` : t.home.label;
        const an = t.away.name ? `${flag(t.away.name)} ${t.away.name}` : t.away.label;
        html += `<div class="cal-match">
            <div class="cal-time">${fmtTime(m.kickoff)}</div>
            <div class="cal-info">
              <div class="cal-teams"><span class="${hF ? 'cal-foll' : ''}">${hn}</span>
              <span class="muted"> vs </span><span class="${aF ? 'cal-foll' : ''}">${an}</span></div>
              <div class="cal-sub">${topLabel(m)} · ${m.venue}</div></div></div>`;
      });
    });
    return html;
  }

  function buildIcs(user) {
    const followed = new Set(user.followed);
    const list = MATCHES.filter(m => followsMatch(m, followed));
    const pad = n => String(n).padStart(2, '0');
    const toUtc = iso => {
      const d = new Date(iso);
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
    };
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WorldCup2026//H5//CN', 'CALSCALE:GREGORIAN'];
    list.forEach(m => {
      const t = teamsOf(m);
      const hn = t.home.name || t.home.label, an = t.away.name || t.away.label;
      const end = new Date(new Date(m.kickoff).getTime() + MATCH_DURATION_MS);
      lines.push('BEGIN:VEVENT', `UID:${m.id}@worldcup2026`, `DTSTART:${toUtc(m.kickoff)}`,
        `DTEND:${toUtc(end.toISOString())}`, `SUMMARY:⚽ ${hn} vs ${an}`,
        `LOCATION:${m.venue}`, `DESCRIPTION:2026 世界杯 ${topLabel(m)}`, 'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  // ---------- 渲染：竞猜 ----------
  function renderBet() {
    const user = currentUser();
    if (!user) return loginPrompt('登录后参与胜平负竞猜，猜中得 3 分，冲击积分榜！');
    const upcoming = MATCHES.filter(m => matchStatus(m) === 'upcoming' && !isSettled(m));
    const known = upcoming.filter(m => { const t = teamsOf(m); return t.home.name && t.away.name; });
    const bets = user.bets || {};
    const betCount = known.filter(m => bets[m.id]).length;
    const stats = userStats(user);
    let html = `<div class="stat-row">
        <div class="stat"><div class="n">${stats.points}</div><div class="l">我的积分</div></div>
        <div class="stat"><div class="n">${stats.correct}</div><div class="l">已猜中</div></div>
        <div class="stat"><div class="n">${betCount}</div><div class="l">待开赛竞猜</div></div>
      </div>
      <div class="section-title">🎯 未开赛比赛竞猜 <span class="count">${known.length} 场可猜</span></div>`;
    if (known.length === 0) return html + emptyBlock('🎉', '当前没有可竞猜的比赛');
    const followed = new Set(user.followed);
    const byDate = {};
    known.forEach(m => { const k = fmtDateKey(m.kickoff); (byDate[k] = byDate[k] || []).push(m); });
    Object.keys(byDate).sort().forEach(k => {
      const { main, dow } = fmtDateLabel(k);
      html += `<div class="date-head">${main} <span class="dow">${dow}</span></div>`;
      byDate[k].forEach(m => { html += matchCard(m, user, followed); });
    });
    return html;
  }

  // ---------- 渲染：积分榜 ----------
  function renderRank() {
    const board = leaderboard();
    const me = currentUsername();
    let html = `<div class="section-title">🏅 积分榜 <span class="count">${board.length} 位玩家</span></div>`;
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
      <div id="calBlock">${renderCalendar()}</div>
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
      return head + `<div class="card" style="color:var(--muted);font-size:13px">暂无已开赛的比赛。比赛开赛后可在此录入真实比分以覆盖演示比分，积分与淘汰赛对阵会自动更新。</div>`;
    }
    let rows = `<div class="card" style="font-size:12px;color:var(--muted);margin-bottom:10px">
      录入真实比分后将覆盖"演示比分"，并实时重新结算积分、推算淘汰赛对阵。点「恢复」可还原为演示比分。</div>`;
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
          <div style="font-size:11px;color:var(--muted);margin-bottom:8px">${topLabel(m)} · ${hasManual(m) ? '已录入真实比分' : '当前为演示比分'}</div>
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
        <h2>${isLogin ? '欢迎回来 👋' : '创建账号 🎉'}</h2>
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
      const tc = e.target.closest('[data-team]');
      if (tc) return toggleFollow(tc.dataset.team);
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
      if (['goLogin', 'hLogin'].includes(e.target.id)) { state.authMode = 'login'; return go('me'); }
      if (e.target.id === 'logoutBtn') return logout();
      if (e.target.id === 'exportIcs') return exportCalendar();
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
  function handleAuth(username, password) {
    if (state.authMode === 'register') {
      if (username.length < 2 || username.length > 12) return authErr('用户名需 2~12 个字符');
      if (!password || password.length < 6) return authErr('密码至少 6 位');
      const users = getUsers();
      if (users.some(u => u.username === username)) return authErr('该用户名已被注册');
      users.push({ username, password, followed: [], bets: {} });
      setUsers(users);
      save(LS.session, username);
      toast('注册成功，欢迎加入！🎉');
      state.authError = ''; go('follow');
    } else {
      const u = getUsers().find(x => x.username === username);
      if (!u) return authErr('用户不存在，请先注册');
      if (u.password !== password) return authErr('密码不正确');
      save(LS.session, username);
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
    if (!currentUser()) { state.authMode = 'login'; return go('me'); }
    updateCurrentUser(u => {
      const i = u.followed.indexOf(team);
      if (i >= 0) { u.followed.splice(i, 1); toast(`已取消关注 ${team}`); }
      else { u.followed.push(team); toast(`已关注 ${team} ⭐ 日历已更新`); }
    });
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
    toast('已恢复为演示比分');
    render();
  }
  function exportCalendar() {
    const user = currentUser();
    if (!user || user.followed.length === 0) return toast('请先关注球队');
    const ics = buildIcs(user);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '世界杯2026-我的看球日历.ics';
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
    render();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
