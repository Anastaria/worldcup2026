/**
 * 2026 世界杯数据
 * - 48 支球队，分 12 个小组（A~L）
 * - 小组赛赛程自动生成（每组 6 场，3 个比赛日）
 * - 每场比赛预生成确定性比分，比赛"开赛后"才视为已结束并参与积分计算
 *
 * 说明：2026 世界杯由美国 / 加拿大 / 墨西哥联合举办，小组赛于 2026-06-11 开赛。
 *       为方便演示，部分球队仅为示意性分组。
 */

// 16 座承办城市
const VENUES = [
  '墨西哥城', '瓜达拉哈拉', '蒙特雷',
  '多伦多', '温哥华',
  '纽约/新泽西', '洛杉矶', '旧金山湾区', '西雅图', '达拉斯',
  '堪萨斯城', '休斯顿', '亚特兰大', '费城', '迈阿密', '波士顿'
];

// 48 支球队（按分组顺序排列，每 4 支为一组）
const TEAM_LIST = [
  { name: '墨西哥', flag: '🇲🇽' }, { name: '波兰', flag: '🇵🇱' }, { name: '新西兰', flag: '🇳🇿' }, { name: '南非', flag: '🇿🇦' },
  { name: '加拿大', flag: '🇨🇦' }, { name: '摩洛哥', flag: '🇲🇦' }, { name: '日本', flag: '🇯🇵' }, { name: '卡塔尔', flag: '🇶🇦' },
  { name: '美国', flag: '🇺🇸' }, { name: '瑞士', flag: '🇨🇭' }, { name: '伊朗', flag: '🇮🇷' }, { name: '加纳', flag: '🇬🇭' },
  { name: '阿根廷', flag: '🇦🇷' }, { name: '澳大利亚', flag: '🇦🇺' }, { name: '克罗地亚', flag: '🇭🇷' }, { name: '科特迪瓦', flag: '🇨🇮' },
  { name: '法国', flag: '🇫🇷' }, { name: '塞内加尔', flag: '🇸🇳' }, { name: '韩国', flag: '🇰🇷' }, { name: '巴拿马', flag: '🇵🇦' },
  { name: '巴西', flag: '🇧🇷' }, { name: '塞尔维亚', flag: '🇷🇸' }, { name: '尼日利亚', flag: '🇳🇬' }, { name: '哥斯达黎加', flag: '🇨🇷' },
  { name: '西班牙', flag: '🇪🇸' }, { name: '乌拉圭', flag: '🇺🇾' }, { name: '突尼斯', flag: '🇹🇳' }, { name: '挪威', flag: '🇳🇴' },
  { name: '葡萄牙', flag: '🇵🇹' }, { name: '丹麦', flag: '🇩🇰' }, { name: '埃及', flag: '🇪🇬' }, { name: '秘鲁', flag: '🇵🇪' },
  { name: '荷兰', flag: '🇳🇱' }, { name: '哥伦比亚', flag: '🇨🇴' }, { name: '喀麦隆', flag: '🇨🇲' }, { name: '智利', flag: '🇨🇱' },
  { name: '德国', flag: '🇩🇪' }, { name: '乌克兰', flag: '🇺🇦' }, { name: '沙特', flag: '🇸🇦' }, { name: '巴拉圭', flag: '🇵🇾' },
  { name: '比利时', flag: '🇧🇪' }, { name: '奥地利', flag: '🇦🇹' }, { name: '阿尔及利亚', flag: '🇩🇿' }, { name: '希腊', flag: '🇬🇷' },
  { name: '意大利', flag: '🇮🇹' }, { name: '厄瓜多尔', flag: '🇪🇨' }, { name: '瑞典', flag: '🇸🇪' }, { name: '土耳其', flag: '🇹🇷' }
];

const GROUP_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

// 简单确定性哈希，用于生成稳定的比分
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}

function seededScore(id) {
  const h = hashStr(id);
  // 0~4 进球，整体偏向小比分
  const home = [0, 1, 1, 2, 2, 3, 1, 0, 4, 2][h % 10];
  const away = [1, 0, 2, 1, 0, 1, 1, 0, 1, 3][Math.floor(h / 10) % 10];
  return { home, away };
}

// 构造分组
const GROUPS = GROUP_NAMES.map((g, gi) => ({
  name: g,
  teams: TEAM_LIST.slice(gi * 4, gi * 4 + 4).map(t => t.name)
}));

// 球队名 -> 信息映射
const TEAMS = {};
TEAM_LIST.forEach((t, idx) => {
  TEAMS[t.name] = { ...t, group: GROUP_NAMES[Math.floor(idx / 4)] };
});

// 生成小组赛赛程
function buildMatches() {
  const matches = [];
  const kickoffHours = [12, 15, 18, 21];
  let venueCursor = 0;

  GROUPS.forEach((group, gi) => {
    const [t0, t1, t2, t3] = group.teams;
    const rounds = [
      [[t0, t1], [t2, t3]], // 第1轮
      [[t0, t2], [t3, t1]], // 第2轮
      [[t0, t3], [t1, t2]], // 第3轮
    ];
    const roundBaseDay = [11, 17, 23]; // 6 月：3 个比赛日的起始
    const roundSpan = [6, 6, 5];

    rounds.forEach((pairings, ri) => {
      const day = roundBaseDay[ri] + (gi % roundSpan[ri]);
      pairings.forEach((pair, pi) => {
        const hour = kickoffHours[(gi + pi + ri) % kickoffHours.length];
        const dd = String(day).padStart(2, '0');
        const hh = String(hour).padStart(2, '0');
        const id = `G${group.name}-R${ri + 1}-${pi + 1}`;
        const venue = VENUES[venueCursor % VENUES.length];
        venueCursor++;
        matches.push({
          id,
          stage: '小组赛',
          group: group.name,
          round: ri + 1,
          home: pair[0],
          away: pair[1],
          kickoff: `2026-06-${dd}T${hh}:00:00`,
          venue,
          result: seededScore(id), // 预生成比分，开赛后才"揭晓"
        });
      });
    });
  });

  matches.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  return matches;
}

// 生成淘汰赛赛程（对阵以"槽位"表示，运行时根据成绩自动解析为具体球队）
function buildKnockout() {
  const list = [];
  let vc = 0;
  const venue = () => VENUES[vc++ % VENUES.length];
  const g = (group, rank) => ({ kind: 'group', group, rank });
  const win = (match) => ({ kind: 'winner', match });
  const lose = (match) => ({ kind: 'loser', match });

  function add(id, stage, bn, bi, homeSlot, awaySlot, date, hour) {
    const hh = String(hour).padStart(2, '0');
    const r = seededScore(id);
    if (r.home === r.away) r.home += 1; // 淘汰赛必分胜负
    list.push({
      id, knockout: true, stage, bn, bi,
      homeSlot, awaySlot,
      kickoff: `2026-${date}T${hh}:00:00`,
      venue: venue(),
      result: r,
    });
  }

  // 1/16 决赛（32 强）：12 个小组第1、第2 + 8 个小组第3
  const r32Slots = [
    g('A', 1), g('B', 2), g('C', 1), g('D', 2), g('E', 1), g('F', 2),
    g('G', 1), g('H', 2), g('I', 1), g('J', 2), g('K', 1), g('L', 2),
    g('A', 2), g('B', 1), g('C', 2), g('D', 1), g('E', 2), g('F', 1),
    g('G', 2), g('H', 1), g('I', 2), g('J', 1), g('K', 2), g('L', 1),
    g('A', 3), g('B', 3), g('C', 3), g('D', 3), g('E', 3), g('F', 3),
    g('G', 3), g('H', 3),
  ];
  const r32Days = ['06-28', '06-28', '06-28', '06-29', '06-29', '06-29', '06-30', '06-30',
    '06-30', '07-01', '07-01', '07-01', '07-02', '07-02', '07-03', '07-03'];
  const knHours = [13, 17, 21];
  for (let i = 0; i < 16; i++) {
    add(`R32-${i + 1}`, '1/16 决赛', '1/16', i + 1,
      r32Slots[i * 2], r32Slots[i * 2 + 1], r32Days[i], knHours[i % knHours.length]);
  }

  // 1/8 决赛（16 强）
  const r16Days = ['07-04', '07-04', '07-05', '07-05', '07-06', '07-06', '07-07', '07-07'];
  for (let i = 0; i < 8; i++) {
    add(`R16-${i + 1}`, '1/8 决赛', '1/8', i + 1,
      win(`R32-${i * 2 + 1}`), win(`R32-${i * 2 + 2}`), r16Days[i], knHours[i % 2 ? 1 : 2]);
  }

  // 1/4 决赛
  const qfDays = ['07-09', '07-09', '07-10', '07-10'];
  for (let i = 0; i < 4; i++) {
    add(`QF-${i + 1}`, '1/4 决赛', '1/4', i + 1,
      win(`R16-${i * 2 + 1}`), win(`R16-${i * 2 + 2}`), qfDays[i], i % 2 ? 21 : 17);
  }

  // 半决赛
  add('SF-1', '半决赛', '半决赛', 1, win('QF-1'), win('QF-2'), '07-14', 21);
  add('SF-2', '半决赛', '半决赛', 2, win('QF-3'), win('QF-4'), '07-15', 21);

  // 季军赛 & 决赛
  add('3RD', '季军赛', '季军赛', 1, lose('SF-1'), lose('SF-2'), '07-18', 17);
  add('FINAL', '决赛', '决赛', 1, win('SF-1'), win('SF-2'), '07-19', 21);

  return list;
}

const MATCHES = buildMatches().concat(buildKnockout())
  .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));

window.WC_DATA = { TEAMS, TEAM_LIST, GROUPS, GROUP_NAMES, MATCHES, VENUES };
