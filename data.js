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

const MATCHES = buildMatches();

window.WC_DATA = { TEAMS, TEAM_LIST, GROUPS, GROUP_NAMES, MATCHES, VENUES };
