// 치즈 플래터 - 스크린샷 파일 이름 형식.
//
// 사용자가 정한 형식(예: "{채널}_{제목}_{날짜}_{시각}")의 항목을 값으로 바꾼다.
// 설정 페이지(미리보기)와 치지직 페이지의 플레이어 스크립트(실제 저장)가 같은 규칙을 쓴다.
(() => {
  "use strict";

  const DEFAULT = "{채널}_{제목}_{날짜}_{시각}";
  const TOKENS = ["채널", "제목", "카테고리", "날짜", "시각", "방송시각"];
  const MAX_LENGTH = 200;
  const TOKEN_RE = new RegExp(`\\{(${TOKENS.join("|")})\\}`, "g");
  const SEPARATORS = "_\\-\\s.·";

  // 저장할 형식. 비었거나 항목이 하나도 없으면 기본 형식.
  function normalizeFormat(value) {
    const text = String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, MAX_LENGTH);
    return text && new RegExp(TOKEN_RE.source).test(text) ? text : DEFAULT;
  }

  const pad = (n) => String(n).padStart(2, "0");
  const dateText = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const timeText = (d) => `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

  // values: { channel, title, category, at(찍은 시각 ms), broadcastAt(장면의 실제 방송 시각 ms) }
  // 빈 항목은 바로 앞의 구분자(_ - 공백 . ·)와 함께 빠진다. 사용자가 넣은 나머지 구분자는 그대로.
  // 파일 이름에 못 쓰는 글자 정리는 부르는 쪽(sanitizeScreenshotName)이 한다.
  function format(formatText, values = {}) {
    const at = new Date(Number.isFinite(values.at) ? values.at : Date.now());
    const broadcast = Number.isFinite(values.broadcastAt) && values.broadcastAt > 0
      ? new Date(values.broadcastAt) : null;
    const map = {
      채널: values.channel,
      제목: values.title,
      카테고리: values.category,
      날짜: dateText(at),
      시각: timeText(at),
      방송시각: broadcast ? `${dateText(broadcast)}_${timeText(broadcast)}` : "",
    };
    const EMPTY = "\u0000";
    return normalizeFormat(formatText)
      .replace(TOKEN_RE, (_, key) => String(map[key] ?? "").replace(/\u0000/g, "").trim() || EMPTY)
      .replace(new RegExp(`[${SEPARATORS}]*${EMPTY}`, "g"), "")
      .replace(new RegExp(`^[${SEPARATORS}]+|[${SEPARATORS}]+$`, "g"), "");
  }

  const api = { DEFAULT, TOKENS, MAX_LENGTH, normalizeFormat, format };
  if (typeof module === "object" && module.exports) module.exports = api;
  else globalThis.CheeseScreenshotName = api;
})();
