// 멀티뷰 다시보기 싱크. 다시보기끼리 묶은 그룹을 실제 방송 시각으로 맞춘다.
//
// 방송 시각 = liveOpenDate(라이브 당시 실제 방송 시작 시각) + 재생 위치.
// 라이브 싱크(multiviewSync.js)는 지연·버퍼·배속으로 따라가지만, 다시보기는 원하는
// 위치로 바로 옮길 수 있으므로 기준 칸의 방송 시각에 다른 칸을 seek 으로 맞추고
// 재생/일시정지도 기준을 따라가게 한다.
//
// 기준은 사용자가 마지막으로 직접 움직인 칸이다(그 칸을 옮기면 나머지가 따라온다).
// 판단은 여기서 하고, 명령 전송·상태 보관은 multiviewWatch.js 가 한다.
((root) => {
  "use strict";

  const LIMITS = Object.freeze({
    // 측정값이 이보다 오래되면 판단에 쓰지 않는다(라이브 싱크와 같은 값).
    staleMs: 3500,
    // 자동 싱크가 옮기는 최소 차이. 다시보기 seek 은 다시 버퍼링하므로 작은 차이는
    // 옮기는 비용이 더 크다.
    seekThresholdSec: 1,
    // 버튼으로 한 번 맞출 때(기준에 맞추기·보정)는 작은 차이도 옮긴다.
    manualThresholdSec: 0.05,
    // 재생 중 seek 은 다시 재생될 때까지 그만큼 늦는다. 조금 앞으로 보낸다.
    seekLeadSec: 0.25,
    // 영상 끝에서 이만큼 안쪽까지만 보낸다(끝에 닿으면 플레이어가 다음 영상으로 넘어간다).
    endMarginSec: 0.5,
    // '방송 시작 전' 칸을 0 으로 되돌릴 때 이 정도 차이는 그냥 둔다.
    startSlackSec: 0.5,
  });

  const finite = (value, min, max) =>
    typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
      ? value
      : null;

  // 프레임이 보낸 측정값을 검증해 같은 모양으로 맞춘다. 이상하면 null.
  function normalize(raw, receivedAt = Date.now()) {
    if (!raw || typeof raw !== "object") return null;
    if (typeof raw.paused !== "boolean" || typeof raw.seeking !== "boolean") return null;
    const currentTime = finite(raw.currentTime, 0, 1000000);
    if (currentTime === null) return null;
    const sampledAt = finite(raw.sampledAt, 0, 1e15);
    return {
      currentTime,
      duration: finite(raw.duration, 0, 1000000),
      paused: raw.paused,
      seeking: raw.seeking,
      readyState: Number.isInteger(raw.readyState) && raw.readyState >= 0 && raw.readyState <= 4
        ? raw.readyState : 0,
      playbackRate: finite(raw.playbackRate, 0.0625, 16) || 1,
      // 업로드 영상은 방송 시작 시각이 없다(0).
      liveOpenAt: finite(raw.liveOpenAt, 1, 1e15) || 0,
      adPlaying: raw.adPlaying === true,
      userActionAt: finite(raw.userActionAt, 1, 1e15) || 0,
      userAction: ["seek", "play", "pause"].includes(raw.userAction) ? raw.userAction : null,
      // 프레임과 같은 기기 시계다. 크게 어긋나면 받은 시각을 쓴다.
      sampledAt: sampledAt !== null && Math.abs(sampledAt - receivedAt) <= 1000
        ? sampledAt : receivedAt,
      receivedAt,
    };
  }

  function fresh(stats, now) {
    return !!stats && now - stats.receivedAt <= LIMITS.staleMs;
  }

  // 방송 시각으로 맞출 수 있는 상태인가(광고 중·시각 정보 없음은 제외).
  function usable(stats, now) {
    return fresh(stats, now) && stats.liveOpenAt > 0 && !stats.adPlaying && stats.readyState >= 1;
  }

  // 지금 이 순간의 재생 위치. 측정 뒤 흐른 시간만큼 재생했다고 본다.
  function positionAt(stats, now) {
    const running = !stats.paused && !stats.seeking && stats.readyState >= 3;
    const elapsed = running ? Math.max(0, now - stats.sampledAt) / 1000 : 0;
    const position = stats.currentTime + elapsed * stats.playbackRate;
    return stats.duration !== null ? Math.min(position, stats.duration) : position;
  }

  // 지금 화면에 나오는 장면의 실제 방송 시각(ms).
  function broadcastClock(stats, now) {
    return stats.liveOpenAt + positionAt(stats, now) * 1000;
  }

  // 이 상태면 그 칸은 기준 타임라인에 맞춰진 것이다(기준이 될 수 있다).
  const ALIGNED_STATUSES = Object.freeze(["기준", "맞춤", "방송 시작 전", "방송 끝난 뒤"]);

  // 그룹의 기준 칸. 사용자가 직접 움직인 칸이 있으면 그중 가장 최근 칸이 기준이 된다.
  // handled: id → 이미 반영한 userActionAt. 반환값의 handled 로 갱신한다.
  // aligned: 이미 타임라인에 맞춰진 칸. 싱크 중에 새로 들어온 칸(자동 재생·이어보기 위치)이
  //   기준이 되면 나머지가 그 칸으로 끌려간다. 그래서 맞춰진 칸이 있으면 그 칸들만 기준이
  //   될 수 있다(새 칸에서 생긴 조작은 반영한 것으로만 치고 넘긴다). 비어 있으면 처음 시작이다.
  function chooseLeader(memberIds, statsById, current, handled, preferred = null, aligned = null) {
    const settled = aligned && memberIds.some((id) => aligned.has(id));
    const canLead = (id) => !settled || aligned.has(id);
    const nextHandled = new Map(handled);
    let actor = null;
    let actorAt = 0;
    for (const id of memberIds) {
      const at = statsById.get(id)?.userActionAt || 0;
      if (at > (handled.get(id) || 0)) {
        nextHandled.set(id, at);
        if (canLead(id) && at > actorAt) {
          actor = id;
          actorAt = at;
        }
      }
    }
    const leaderId = actor ||
      (memberIds.includes(current) ? current : null) ||
      (memberIds.includes(preferred) && canLead(preferred) ? preferred : null) ||
      memberIds.find(canLead) ||
      null;
    return { leaderId, handled: nextHandled, byUser: !!actor };
  }

  // 칸마다 상태와 보낼 명령을 정한다.
  // offsets: id → 초. 양수면 그 칸이 기준보다 그만큼 늦게(과거 장면) 나온다(라이브 싱크와 같은 뜻).
  // 반환: { rows: Map(id → { status, deltaSec, clock }), actions: [{ id, action, currentTime? }] }
  function plan({ memberIds, statsById, leaderId, offsets = {}, now = Date.now(), threshold = LIMITS.seekThresholdSec, onlyIds = null }) {
    const rows = new Map();
    const actions = [];
    const leader = statsById.get(leaderId);
    const leaderUsable = usable(leader, now);
    const leaderClock = leaderUsable ? broadcastClock(leader, now) : null;
    const leaderOffset = Number(offsets[leaderId]) || 0;
    for (const id of memberIds) {
      const stats = statsById.get(id);
      const row = { status: "측정 대기", deltaSec: null, clock: null };
      rows.set(id, row);
      if (!fresh(stats, now)) continue;
      if (!stats.liveOpenAt) {
        row.status = "방송 시각 없음";
        continue;
      }
      row.clock = broadcastClock(stats, now);
      // 영상 정보를 읽기 전에 옮기면 플레이어의 이어보기 이동이 덮어쓴다. 다음 측정을 기다린다.
      if (id !== leaderId && stats.readyState < 1) {
        row.status = "재생 준비 중";
        continue;
      }
      if (stats.adPlaying) {
        row.status = "광고 중";
        continue;
      }
      if (id === leaderId) {
        row.status = "기준";
        row.deltaSec = 0;
        continue;
      }
      if (!leaderUsable) {
        row.status = "기준 대기";
        continue;
      }
      const target = (leaderClock - stats.liveOpenAt) / 1000 - ((Number(offsets[id]) || 0) - leaderOffset);
      const position = positionAt(stats, now);
      row.deltaSec = Math.round((position - target) * 10) / 10;
      const act = !onlyIds || onlyIds.includes(id);
      // 상태가 바뀌는 중에는 다음 측정을 기다린다.
      if (leader.seeking || stats.seeking) {
        row.status = "맞추는 중";
        continue;
      }
      if (target < 0) {
        // 이 방송은 아직 시작 전이다. 처음에서 멈춰 기다리다가 기준이 시작 시각을
        // 지나면 아래 일반 경로가 맞춰 재생한다.
        row.status = "방송 시작 전";
        if (!act) continue;
        if (stats.currentTime > LIMITS.startSlackSec) actions.push({ id, action: "seek", currentTime: 0 });
        if (!stats.paused) actions.push({ id, action: "pause" });
        continue;
      }
      if (stats.duration !== null && target > stats.duration - LIMITS.endMarginSec) {
        // 이 방송은 이미 끝난 시각이다. 끝으로 보내지 않고 그 자리에서 멈춘다.
        row.status = "방송 끝난 뒤";
        if (act && !stats.paused) actions.push({ id, action: "pause" });
        continue;
      }
      const off = Math.abs(position - target) >= threshold;
      row.status = off ? "맞추는 중" : "맞춤";
      if (!act) continue;
      if (off) {
        const lead = leader.paused ? 0 : LIMITS.seekLeadSec;
        const limit = stats.duration !== null ? stats.duration - LIMITS.endMarginSec : Infinity;
        actions.push({
          id,
          action: "seek",
          currentTime: Math.round(Math.max(0, Math.min(limit, target + lead)) * 1000) / 1000,
        });
      }
      if (leader.paused && !stats.paused) actions.push({ id, action: "pause" });
      if (!leader.paused && stats.paused) actions.push({ id, action: "play" });
    }
    return { rows, actions };
  }

  const api = { LIMITS, ALIGNED_STATUSES, normalize, fresh, usable, positionAt, broadcastClock, chooseLeader, plan };
  root.CheeseMultiviewVodSync = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
