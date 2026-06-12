(function () {
  'use strict';

  const { TEAMS, GROUPS, GROUP_NAMES, MATCHES } = window.WC_DATA;

  // ---------- 存储 ----------
  const LS = {
    users: 'wc_users',        // [{username, password, followed:[], bets:{matchId:'home'|'draw'|'away'}}]
    session: 'wc_session',    // username
  };
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  // ---------- 状态 ----------
  let state = {
    tab: 'schedule',
    scheduleFilter: 'all', // all | mine | upcoming
    teamGroupFilter: 'all',
    authMode: 'login',     // login | register
    authError: '',
  };

  // ---------- 工具 ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const now = () => new Date();
  const flag = name => (TEAMS[name] && TEAMS[name].flag) || '🏳️';

  const MATCH_DURATION_MS = 105 * 60 * 1000; // 含中场，约 105 分钟

  function matchStatus(m) {
    const start = new Date(m.kickoff).getTime();
    const t = now().getTime();
    if (t < start) return 'upcoming';
    if (t < start + MATCH_DURATION_MS) return 'live';
    return 'finished';
  }
  // 已结束比赛的真实结果：home / draw / away
  function matchOutcome(m) {
    const r = m.result;
    if (r.home > r.away) return 'home';
    if (r.home < r.away) return 'away';
    return 'draw';
  }

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

  // ---------- 积分计算 ----------
  // 猜中胜平负 = +3 分
  const POINTS_CORRECT = 3;
  function userStats(user) {
    let points = 0, correct = 0, settled = 0, totalBets = 0;
    const bets = user.bets || {};
    MATCHES.forEach(m => {
      const pick = bets[m.id];
      if (!pick) return;
      totalBets++;
      if (matchStatus(m) === 'finished') {
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

  // ---------- 演示数据：首次进入时注入几个示例用户 ----------
  function seedDemoUsers() {
    if (getUsers().length > 0) return;
    const demos = ['梅西铁粉', '老王看球', '足球小将', '冷门收割机', '客厅解说员'];
    const picks = ['home', 'draw', 'away'];
    const users = demos.map((name, i) => {
      const bets = {};
      MATCHES.forEach((m, idx) => {
        // 确定性地为每个 demo 用户生成投注，覆盖大部分比赛
        if ((idx + i) % 4 !== 0) {
          bets[m.id] = picks[(idx * 7 + i * 3) % 3];
        }
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
      { k: 'upcoming', label: '未开赛' },
      { k: 'mine', label: '我关注的' },
    ];

    let list = MATCHES.slice();
    if (state.scheduleFilter === 'upcoming') list = list.filter(m => matchStatus(m) === 'upcoming');
    if (state.scheduleFilter === 'mine') list = list.filter(m => followed.has(m.home) || followed.has(m.away));

    const bar = `<div class="filter-bar">${filters.map(f =>
      `<button class="chip ${state.scheduleFilter === f.k ? 'active' : ''}" data-sfilter="${f.k}">${f.label}</button>`
    ).join('')}</div>`;

    if (list.length === 0) {
      return bar + emptyBlock('🗓️', state.scheduleFilter === 'mine'
        ? '你还没有关注球队<br/>去「关注」页选择喜欢的球队吧'
        : '暂无比赛');
    }

    // 按日期分组
    const groupsByDate = {};
    list.forEach(m => {
      const k = fmtDateKey(m.kickoff);
      (groupsByDate[k] = groupsByDate[k] || []).push(m);
    });

    let html = bar;
    Object.keys(groupsByDate).sort().forEach(dateKey => {
      const { main, dow } = fmtDateLabel(dateKey);
      html += `<div class="date-head">${main}<span class="dow">${dow}</span></div>`;
      groupsByDate[dateKey].forEach(m => { html += matchCard(m, user, followed); });
    });
    return html;
  }

  function statusBadge(status) {
    if (status === 'live') return '<span class="badge live">● 进行中</span>';
    if (status === 'finished') return '<span class="badge fin">已结束</span>';
    return '<span class="badge up">未开赛</span>';
  }

  function matchCard(m, user, followedSet) {
    const status = matchStatus(m);
    const fH = followedSet.has(m.home) ? ' ' : '';
    const fA = followedSet.has(m.away) ? ' ' : '';
    const center = status === 'upcoming'
      ? `<div class="vs">VS</div><div class="time">${fmtTime(m.kickoff)}</div><div class="venue">${m.venue}</div>`
      : `<div class="score">${m.result.home} : ${m.result.away}</div><div class="venue">${m.venue}</div>`;

    let foot = '';
    const pick = user && user.bets ? user.bets[m.id] : null;

    if (status === 'upcoming') {
      foot = `<div class="match-foot">${betRow(m, pick, !!user)}</div>`;
    } else {
      // 已开赛/结束：展示竞猜结果
      foot = `<div class="match-foot">${betResult(m, pick, status)}</div>`;
    }

    return `
      <div class="match" data-match="${m.id}">
        <div class="match-top">
          <span class="grp">${m.stage} · ${m.group}组</span>
          ${statusBadge(status)}
        </div>
        <div class="match-body">
          <div class="team home">
            <div class="flag">${flag(m.home)}</div>
            <div class="tname">${followedSet.has(m.home) ? '⭐' : ''}${m.home}</div>
          </div>
          <div class="center">${center}</div>
          <div class="team away">
            <div class="flag">${flag(m.away)}</div>
            <div class="tname">${followedSet.has(m.away) ? '⭐' : ''}${m.away}</div>
          </div>
        </div>
        ${foot}
      </div>`;
  }

  function betRow(m, pick, loggedIn) {
    const opt = (key, cls, label) =>
      `<button class="bet-btn ${cls} ${pick === key ? 'sel' : ''}" data-bet="${m.id}" data-pick="${key}">
        ${label}<small>${pick === key ? '已选' : '猜这个'}</small>
      </button>`;
    return `<div class="bet-row">
      ${opt('home', 'win', `${m.home}胜`)}
      ${opt('draw', 'draw', '平局')}
      ${opt('away', 'lose', `${m.away}胜`)}
    </div>`;
  }

  function pickLabel(m, pick) {
    if (pick === 'home') return `${m.home}胜`;
    if (pick === 'away') return `${m.away}胜`;
    if (pick === 'draw') return '平局';
    return '';
  }

  function betResult(m, pick, status) {
    if (!pick) {
      return `<div class="bet-result"><span class="muted">你未参与竞猜</span><span class="pill none">—</span></div>`;
    }
    if (status === 'finished') {
      const ok = pick === matchOutcome(m);
      return `<div class="bet-result">
        <span>你猜：<b>${pickLabel(m, pick)}</b></span>
        <span class="pill ${ok ? 'ok' : 'no'}">${ok ? `猜中 +${POINTS_CORRECT}` : '未猜中'}</span>
      </div>`;
    }
    return `<div class="bet-result">
      <span>你猜：<b>${pickLabel(m, pick)}</b></span>
      <span class="pill wait">比赛进行中</span>
    </div>`;
  }

  // ---------- 渲染：关注球队 ----------
  function renderFollow() {
    const user = currentUser();
    if (!user) return loginPrompt('登录后即可关注球队，并自动生成你的看球日历');

    const followed = new Set(user.followed);
    const filters = [{ k: 'all', label: '全部小组' }].concat(
      GROUP_NAMES.map(g => ({ k: g, label: `${g}组` }))
    );
    const bar = `<div class="filter-bar">${filters.map(f =>
      `<button class="chip ${state.teamGroupFilter === f.k ? 'active' : ''}" data-gfilter="${f.k}">${f.label}</button>`
    ).join('')}</div>`;

    const showGroups = state.teamGroupFilter === 'all'
      ? GROUPS
      : GROUPS.filter(g => g.name === state.teamGroupFilter);

    let html = `<div class="section-title">⭐ 关注球队 <span class="count">已关注 ${followed.size} 支</span></div>` + bar;
    showGroups.forEach(g => {
      html += `<div class="group-block"><h3><span class="tag">${g.name}组</span></h3><div class="group-grid">`;
      g.teams.forEach(t => {
        const on = followed.has(t);
        html += `
          <div class="team-cell ${on ? 'followed' : ''}" data-team="${t}">
            <div class="flag">${flag(t)}</div>
            <div class="info"><div class="tname">${t}</div><div class="grp">${g.name}组</div></div>
            <div class="star">${on ? '⭐' : '☆'}</div>
          </div>`;
      });
      html += `</div></div>`;
    });
    return html;
  }

  // ---------- 渲染：我的日历 (在「我的」内入口 + 独立展示) ----------
  function renderCalendar() {
    const user = currentUser();
    const followed = new Set(user.followed);
    const list = MATCHES.filter(m => followed.has(m.home) || followed.has(m.away));
    if (list.length === 0) {
      return emptyBlock('📅', '关注球队后<br/>这里会自动生成你的看球日历');
    }
    const byDate = {};
    list.forEach(m => { const k = fmtDateKey(m.kickoff); (byDate[k] = byDate[k] || []).push(m); });

    let html = `<div class="section-title">📅 我的看球日历 <span class="count">共 ${list.length} 场</span></div>`;
    html += `<button class="btn-ghost" id="exportIcs" style="margin-bottom:14px">⬇️ 导出到手机日历 (.ics)</button>`;
    Object.keys(byDate).sort().forEach(k => {
      const { main, dow } = fmtDateLabel(k);
      html += `<div class="date-head" style="position:static;padding-left:2px">${main} <span class="dow">${dow}</span></div>`;
      byDate[k].forEach(m => {
        const hF = followed.has(m.home), aF = followed.has(m.away);
        html += `
          <div class="cal-match">
            <div class="cal-time">${fmtTime(m.kickoff)}</div>
            <div class="cal-info">
              <div class="cal-teams">
                <span class="${hF ? 'cal-foll' : ''}">${flag(m.home)} ${m.home}</span>
                <span class="muted"> vs </span>
                <span class="${aF ? 'cal-foll' : ''}">${flag(m.away)} ${m.away}</span>
              </div>
              <div class="cal-sub">${m.stage} · ${m.group}组 · ${m.venue}</div>
            </div>
          </div>`;
      });
    });
    return html;
  }

  function buildIcs(user) {
    const followed = new Set(user.followed);
    const list = MATCHES.filter(m => followed.has(m.home) || followed.has(m.away));
    const pad = n => String(n).padStart(2, '0');
    const toUtc = iso => {
      const d = new Date(iso);
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
    };
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//WorldCup2026//H5//CN', 'CALSCALE:GREGORIAN'];
    list.forEach(m => {
      const start = new Date(m.kickoff);
      const end = new Date(start.getTime() + MATCH_DURATION_MS);
      lines.push(
        'BEGIN:VEVENT',
        `UID:${m.id}@worldcup2026`,
        `DTSTART:${toUtc(m.kickoff)}`,
        `DTEND:${toUtc(end.toISOString())}`,
        `SUMMARY:⚽ ${m.home} vs ${m.away} (${m.group}组)`,
        `LOCATION:${m.venue}`,
        `DESCRIPTION:2026 世界杯 ${m.stage} ${m.group}组`,
        'END:VEVENT'
      );
    });
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  // ---------- 渲染：竞猜 ----------
  function renderBet() {
    const user = currentUser();
    if (!user) return loginPrompt('登录后参与胜平负竞猜，猜中得 3 分，冲击积分榜！');

    const upcoming = MATCHES.filter(m => matchStatus(m) === 'upcoming');
    const bets = user.bets || {};
    const betCount = upcoming.filter(m => bets[m.id]).length;
    const stats = userStats(user);

    let html = `
      <div class="stat-row">
        <div class="stat"><div class="n">${stats.points}</div><div class="l">我的积分</div></div>
        <div class="stat"><div class="n">${stats.correct}</div><div class="l">已猜中</div></div>
        <div class="stat"><div class="n">${betCount}</div><div class="l">待开赛竞猜</div></div>
      </div>
      <div class="section-title">🎯 未开赛比赛竞猜 <span class="count">${upcoming.length} 场可猜</span></div>`;

    if (upcoming.length === 0) {
      return html + emptyBlock('🎉', '当前没有可竞猜的比赛');
    }
    const followed = new Set(user.followed);
    const byDate = {};
    upcoming.forEach(m => { const k = fmtDateKey(m.kickoff); (byDate[k] = byDate[k] || []).push(m); });
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
      规则：猜中一场比赛胜平负得 <b style="color:var(--navy)">${POINTS_CORRECT}</b> 分，未猜中不扣分。比赛结束后自动结算。</div>`;

    if (board.length === 0) return html + emptyBlock('🏅', '还没有玩家参与');

    board.forEach((u, i) => {
      const rank = i + 1;
      const topCls = rank === 1 ? 'top1' : rank === 2 ? 'top2' : rank === 3 ? 'top3' : '';
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
      const isMe = u.username === me;
      html += `
        <div class="rank-item ${isMe ? 'me' : ''}">
          <div class="rank-no ${topCls}">${medal}</div>
          <div class="rank-avatar">${u.username.slice(0, 1)}</div>
          <div class="rank-main">
            <div class="rank-name">${u.username}${isMe ? '<span class="me-tag">我</span>' : ''}</div>
            <div class="rank-meta">已结算 ${u.settled} 场 · 猜中 ${u.correct} 场${u.pending ? ` · 待开赛 ${u.pending}` : ''}</div>
          </div>
          <div class="rank-pts"><span class="n">${u.points}</span> <span class="u">分</span></div>
        </div>`;
    });
    return html;
  }

  // ---------- 渲染：我的 ----------
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
      <div class="list-row danger" id="logoutBtn">退出登录</div>
    `;
  }

  // ---------- 渲染：注册/登录 ----------
  function renderAuth() {
    const isLogin = state.authMode === 'login';
    return `
      <div class="card auth-card">
        <h2>${isLogin ? '欢迎回来 👋' : '创建账号 🎉'}</h2>
        <p class="sub">${isLogin ? '登录后关注球队、参与竞猜、冲击积分榜' : '注册一个账号，开启你的世界杯竞猜之旅'}</p>
        <form id="authForm">
          <div class="field">
            <label>用户名</label>
            <input name="username" type="text" placeholder="2~12 个字符" autocomplete="off" maxlength="12" />
          </div>
          <div class="field">
            <label>密码</label>
            <input name="password" type="password" placeholder="至少 6 位" autocomplete="off" />
          </div>
          <div class="form-err">${state.authError || ''}</div>
          <button type="submit" class="btn-primary">${isLogin ? '登 录' : '注册并登录'}</button>
        </form>
        <div class="switch-line">
          ${isLogin ? '还没有账号？' : '已有账号？'}
          <a href="#" id="switchAuth">${isLogin ? '去注册' : '去登录'}</a>
        </div>
      </div>`;
  }

  function loginPrompt(text) {
    return `<div class="card auth-card" style="text-align:center">
      <div style="font-size:40px;margin-bottom:8px">🔒</div>
      <p class="sub" style="margin-bottom:18px">${text}</p>
      <button class="btn-primary" id="goLogin">去登录 / 注册</button>
    </div>`;
  }

  function emptyBlock(emoji, text) {
    return `<div class="empty"><span class="emoji">${emoji}</span>${text}</div>`;
  }

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
    view.scrollTop = 0;
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
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === state.tab);
    });
  }

  function go(tab) { state.tab = tab; state.authError = ''; render(); }

  // ---------- 事件委托 ----------
  function bindEvents() {
    // 底部导航
    $('#tabbar').addEventListener('click', e => {
      const btn = e.target.closest('.tab');
      if (btn) go(btn.dataset.tab);
    });

    // 主体内点击委托
    $('#view').addEventListener('click', e => {
      // 赛程过滤
      const sf = e.target.closest('[data-sfilter]');
      if (sf) { state.scheduleFilter = sf.dataset.sfilter; return render(); }

      // 小组过滤
      const gf = e.target.closest('[data-gfilter]');
      if (gf) { state.teamGroupFilter = gf.dataset.gfilter; return render(); }

      // 关注/取关球队
      const tc = e.target.closest('[data-team]');
      if (tc) return toggleFollow(tc.dataset.team);

      // 竞猜
      const bb = e.target.closest('[data-bet]');
      if (bb) return placeBet(bb.dataset.bet, bb.dataset.pick);

      // 切换登录/注册
      if (e.target.id === 'switchAuth') {
        e.preventDefault();
        state.authMode = state.authMode === 'login' ? 'register' : 'login';
        state.authError = '';
        return render();
      }
      // 各种"去登录"入口
      if (['goLogin', 'hLogin'].includes(e.target.id)) {
        state.authMode = 'login';
        return go('me');
      }
      // 退出
      if (e.target.id === 'logoutBtn') return logout();
      // 导出 ics
      if (e.target.id === 'exportIcs') return exportCalendar();
    });

    // 表单提交
    $('#view').addEventListener('submit', e => {
      if (e.target.id === 'authForm') {
        e.preventDefault();
        const fd = new FormData(e.target);
        handleAuth(fd.get('username').trim(), fd.get('password'));
      }
    });

    // header 登录按钮
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
      state.authError = '';
      go('follow'); // 引导去关注球队
    } else {
      const u = getUsers().find(x => x.username === username);
      if (!u) return authErr('用户不存在，请先注册');
      if (u.password !== password) return authErr('密码不正确');
      save(LS.session, username);
      toast(`欢迎回来，${username}！`);
      state.authError = '';
      go('schedule');
    }
  }
  function authErr(msg) { state.authError = msg; render(); }

  function logout() {
    localStorage.removeItem(LS.session);
    toast('已退出登录');
    state.authMode = 'login';
    go('me');
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
    const m = MATCHES.find(x => x.id === matchId);
    if (!m || matchStatus(m) !== 'upcoming') { toast('比赛已开赛，无法竞猜'); return render(); }
    updateCurrentUser(u => {
      u.bets = u.bets || {};
      if (u.bets[matchId] === pick) { delete u.bets[matchId]; toast('已取消竞猜'); }
      else { u.bets[matchId] = pick; toast(`已选择：${pickLabel(m, pick)}`); }
    });
    render();
  }

  function exportCalendar() {
    const user = currentUser();
    if (!user || user.followed.length === 0) return toast('请先关注球队');
    const ics = buildIcs(user);
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '世界杯2026-我的看球日历.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
