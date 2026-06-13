/**
 * 数据源：football-data.org（稳定、结构化 JSON，推荐）
 *
 * 需要环境变量 FOOTBALL_DATA_TOKEN（免费注册获取：https://www.football-data.org/）
 * 免费档限速约 10 次/分钟；本适配器每次运行只请求 1 次（拉全部赛事再本地匹配）。
 *
 * 接口：GET https://api.football-data.org/v4/competitions/WC/matches
 *   返回 matches[]：{ utcDate, status, homeTeam:{name}, awayTeam:{name}, score:{fullTime:{home,away}} }
 *   status === 'FINISHED' 视为已完赛。
 *
 * 匹配策略：小组赛每对球队只交手一次，按"两队英文名命中我方中文队名"配对，
 *          再根据哪一侧是我方 home 决定主客比分归属。
 */
import { apiNameMatchesCn } from '../teamNames.js';

const API_URL = 'https://api.football-data.org/v4/competitions/WC/matches';

export const id = 'footballdata';

export function available(env) {
  return !!env.FOOTBALL_DATA_TOKEN;
}

export async function resolve(pending, env) {
  const out = [];
  if (!env.FOOTBALL_DATA_TOKEN) {
    return { results: out, note: 'FOOTBALL_DATA_TOKEN 未配置' };
  }
  let data;
  try {
    const res = await fetch(API_URL, {
      headers: { 'X-Auth-Token': env.FOOTBALL_DATA_TOKEN },
      cf: { cacheTtl: 0 },
    });
    if (!res.ok) return { results: out, note: 'http_' + res.status };
    data = await res.json();
  } catch (e) {
    return { results: out, note: 'fetch_error:' + (e && e.message) };
  }

  const finished = (data.matches || []).filter(m =>
    m.status === 'FINISHED' &&
    m.score && m.score.fullTime &&
    m.score.fullTime.home != null && m.score.fullTime.away != null
  );

  for (const fx of pending) {
    const hit = finished.find(m => {
      const hn = m.homeTeam && m.homeTeam.name;
      const an = m.awayTeam && m.awayTeam.name;
      const directHome = apiNameMatchesCn(hn, fx.home) && apiNameMatchesCn(an, fx.away);
      const swapped = apiNameMatchesCn(hn, fx.away) && apiNameMatchesCn(an, fx.home);
      return directHome || swapped;
    });
    if (!hit) continue;
    const apiHome = hit.score.fullTime.home;
    const apiAway = hit.score.fullTime.away;
    // 把 API 的主客映射到我方主客
    const apiHomeIsOurHome = apiNameMatchesCn(hit.homeTeam.name, fx.home);
    const home = apiHomeIsOurHome ? apiHome : apiAway;
    const away = apiHomeIsOurHome ? apiAway : apiHome;
    out.push({ id: fx.id, home, away, info: `${fx.home} ${home}:${away} ${fx.away}` });
  }
  return { results: out, note: `api_finished=${finished.length}` };
}
