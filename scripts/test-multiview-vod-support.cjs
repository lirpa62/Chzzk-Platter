const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const watch = read("src/multiviewWatch.js");
const content = read("src/content.js");
const mixer = read("src/audioMixer.js");
const html = read("settings.html");
const watchHtml = read("multiviewWatch.html");
const settings = read("src/settings.js");
const css = read("src/multiview.css");
const setupPage = read("src/multiview.js");
const achievementMap = read("src/achievementBadgeMap.js");
const achievementMapContent = content.slice(
  content.indexOf("const ACHIEVEMENT_BADGE_URL_MAP"),
  content.indexOf("const ACHIEVEMENT_BADGE_NAME_MAP"),
);

let failed = 0;
function check(condition, label) {
  try {
    assert.ok(condition, label);
    console.log(`  PASS ${label}`);
  } catch {
    failed += 1;
    console.log(`  FAIL ${label}`);
  }
}

const mapEntries = (source) => new Map(
  [...source.matchAll(/^\s*(?:"([^"]+)"|([\w]+)):\s*(?:\n\s*)?"([^"]+)"/gm)]
    .map((match) => [match[1] || match[2], match[3]]),
);
const canonicalAchievementMap = mapEntries(achievementMapContent);
const multiviewAchievementMap = mapEntries(achievementMap);
check([...multiviewAchievementMap].every(([id, url]) => canonicalAchievementMap.get(id) === url),
  "멀티뷰 업적 이미지 URL이 기존 검색 배지 표와 일치");

console.log("[다시보기 화질] 시작만 메인 최대·보조 720p, 이후에는 치지직 화질 선택");
// README: 옵션과 무관하게 다시보기는 시작 시 메인 최대 화질, 보조 720p. 이후 상한은 없다.
check(/if \(channel\.mediaType === "video"\) return isMain \? "highest" : "cap-720";/.test(watch),
  "다시보기는 옵션과 무관하게 메인 최대·보조 720p 로 시작");
check(/function qualityForChannel\(channel, isMain, mainHighQuality\) \{\s*return \{ quality: "native", qualityPolicy: "native" \};/.test(watch),
  "시작 뒤에는 라이브·다시보기 모두 치지직 화질 선택을 따름(상한 없음)");
check(/"highest", "cap-480", "cap-720", "native"/.test(content), "격리 월드가 기본 화질 정책을 허용");
check(/multiviewQualityPolicy === "cap-720"\) return 720/.test(content), "VOD 정책에서 720 상한 계산");
check(/"highest", "cap-480", "cap-720", "native"/.test(mixer), "MAIN 플레이어가 기본 화질 정책을 허용");
check(/\["cap-480", "cap-720"\]\.includes\(multiviewQualityPolicy\)/.test(mixer), "두 상한 모두 트랙 재시도와 숨김 탭 정책에 반영");

console.log("\n[다시보기 설정] 토글·저장·기존 기능 게이트");
const vodSettings = [
  ["cheeseMultiviewVodSpeedButton", "data-multiview-vod-speed"],
  ["cheeseMultiviewVodTimestamps", "data-multiview-vod-timestamps"],
  ["cheeseMultiviewVodMyChat", "data-multiview-vod-my-chat"],
  ["cheeseMultiviewVodChatGraph", "data-multiview-vod-chat-graph"],
  ["cheeseMultiviewVodRoleChat", "data-multiview-vod-role-chat"],
];
for (const [key, selector] of vodSettings) {
  check(html.includes(selector), `${key} 설정 토글이 화면에 있음`);
  check(settings.includes(`"${key}"`), `${key} 설정 내보내기·불러오기 목록에 있음`);
  check(content.includes(`"${key}"`), `${key} 런타임 저장 변경을 감지`);
}
check(/flags\.speedButton = !multiviewVodSpeedButton/.test(content), "멀티뷰 다시보기 재생 속도 설정 적용");
check(/flags\.commentTimestamp = isCommentTimestampHidden\(\);/.test(content) &&
  /function isCommentTimestampHidden\(\) \{\s*return featureFlags\.commentTimestamp === true \|\|\s*\(isMultiviewReplay\(\) && !multiviewVodTimestamps\);/.test(content),
  "멀티뷰 다시보기 댓글 타임스탬프 설정 적용(전역 설정과 함께 본다)");
// ⚠ 버튼을 만드는 쪽(격리 월드)도 같은 판정을 써야 옵션을 끄면 버튼이 사라진다.
check(/function initCommentTimestampMarkers\(\) \{[\s\S]{0,300}if \(isCommentTimestampHidden\(\)\) \{/.test(content),
  "댓글 타임스탬프 버튼을 만들 때도 멀티뷰 옵션을 본다");
check(/if \(changes\[MULTIVIEW_VOD_TIMESTAMPS_KEY\]\) initCommentTimestampMarkers\(\);/.test(content),
  "옵션을 바꾸면 열려 있는 다시보기 칸에 바로 반영");
// 멀티뷰 다시보기 플레이어 옵션은 모두 기본 끔.
for (const [key, selector, variable, constant] of [
  ["cheeseMultiviewVodSpeedButton", "data-multiview-vod-speed", "multiviewVodSpeedButton", "MULTIVIEW_VOD_SPEED_KEY"],
  ["cheeseMultiviewVodTimestamps", "data-multiview-vod-timestamps", "multiviewVodTimestamps", "MULTIVIEW_VOD_TIMESTAMPS_KEY"],
  ["cheeseMultiviewVodMyChat", "data-multiview-vod-my-chat", "multiviewVodMyChat", "MULTIVIEW_VOD_MY_CHAT_KEY"],
  ["cheeseMultiviewVodChatGraph", "data-multiview-vod-chat-graph", "multiviewVodChatGraph", "MULTIVIEW_VOD_CHAT_GRAPH_KEY"],
  ["cheeseMultiviewVodRoleChat", "data-multiview-vod-role-chat", "multiviewVodRoleChat", "MULTIVIEW_VOD_ROLE_CHAT_KEY"],
]) {
  check(settings.includes(`["[${selector}]", "${key}", false]`) &&
    new RegExp(`let ${variable} = false;`).test(content) &&
    new RegExp(`${variable} = data\\?\\.\\[${constant}\\] === true;`).test(content),
    `${key} 기본 끔(설정 화면·런타임 모두)`);
}
check(/return chatRecapOn && !chatRecapPlayerButtonHidden/.test(content), "내 채팅 기록은 기존 채팅 리캡 동의가 필요");
check(/multiviewVodChatGraph && chatGraphOn/.test(content), "채팅 활성도는 멀티뷰·기존 기능 설정을 함께 따름");
check(/multiviewVodRoleChat && vodRoleChatOn/.test(content), "역할 채팅은 멀티뷰·기존 기능 설정을 함께 따름");

console.log("\n[다시보기 채팅] 재생 위치에 맞춰 페이지 단위로 점진 표시");
check(/if \(channel\?\.mediaType === "video"\) return ""/.test(watch), "다시보기 칸을 라이브 채팅 채널로 변환하지 않음");
check(/CheeseMultiviewVodChat\.createSession/.test(watch), "멀티뷰 부모가 다시보기 채팅 세션을 생성");
check(/service\/v1\/videos\/\$\{videoNo\}\/chats/.test(read("src/multiviewVodChat.js")), "다시보기 채팅 API의 페이지 요청 사용");
check(/previousVideoChatSize/.test(read("src/multiviewVodChat.js")), "채팅 요청 페이지 크기를 제한");
check(/SEEK_HISTORY_MS = 90000/.test(read("src/multiviewVodChat.js")), "재생 위치 이전 90초 채팅을 함께 수집해 목록을 채움");
check(/MAX_BUFFER_MESSAGES = 2000/.test(read("src/multiviewVodChat.js")) && !/DISPLAY_WINDOW_SEC/.test(read("src/multiviewVodChat.js")), "시간이 지나도 채팅은 유지하고 개수로 메모리 상한 적용");
check(/privateUserBlock === true/.test(read("src/multiviewVodChat.js")), "차단된 비공개 이용자 채팅 제외");
check(/parseObject\(message\.profile\)/.test(read("src/multiviewVodChat.js")), "JSON 문자열 profile에서 닉네임·역할 정보를 읽음");
check(/userRoleCode[\s\S]*?verifiedMark/.test(read("src/multiviewVodChat.js")), "방장·매니저·파트너 역할을 구분");
check(/getNicknameColorCode/.test(read("src/multiviewVodChat.js")) && /darkRgbValue/.test(read("src/multiviewVodChat.js")) && /lightRgbValue/.test(read("src/multiviewVodChat.js")) && /resolveNicknameStyle/.test(watch) && /effectType === "HIGHLIGHT"/.test(read("src/multiviewVodChat.js")) && /effectType === "GRADATION"/.test(read("src/multiviewVodChat.js")) && /nickname\/color\/codes/.test(watch) && /service\/v2\/nickname\/color\/codes/.test(read("src/background.js")), "닉네임 색상 코드 API의 테마별 전경색·강조 배경·그라데이션 처리");
check(/nicknameTitleColor/.test(read("src/multiviewVodChat.js")) && /message\.nicknameTitleColor/.test(watch), "관리자 닉네임은 프로필 제목 색상을 우선 사용");
check(/nicknameMessageColor/.test(read("src/multiviewVodChat.js")) && /message\.nicknameMessageColor\s*\|\|\s*globalThis\.CheeseMultiviewVodChat\.resolveNicknameColor/.test(watch), "방장·매니저 채팅 메시지에 닉네임과 동일한 색을 적용");
check(/DEFAULT_NICKNAME_COLORS/.test(read("src/multiviewVodChat.js")) && /getFallbackNicknameColor/.test(read("src/multiviewVodChat.js")) && /fallbackNicknameColorStates/.test(read("src/multiviewVodChat.js")) && /MAX_FALLBACK_COLOR_VIDEOS = 6/.test(read("src/multiviewVodChat.js")), "CC000 닉네임에 제한된 다시보기별 고정 순환 색상을 배정");
check(/message\.donation\s*\?\s*""/.test(watch.slice(watch.indexOf("function renderVodChatRow"), watch.indexOf("function renderVodChat()"))), "후원·구독·미션 특수 채팅에는 닉네임 색상 코드 스타일을 적용하지 않음");
check(/new MutationObserver\(\(\) => \{\s*postChatView\(\);\s*renderVodChat\(\);/.test(watch), "테마 변경 시 다시보기 채팅 닉네임 색상을 즉시 갱신");
check(!/(?:profile|userProfile|user|streamingProperty)\.activityBadges?\b/.test(read("src/multiviewVodChat.js")) && /streamingProperty\.subscription/.test(read("src/multiviewVodChat.js")) && /activatedAchievementBadgeIds/.test(read("src/multiviewVodChat.js")) && /viewerBadges/.test(read("src/multiviewVodChat.js")) && /mv-vod-chat-profile-badge/.test(watch), "구독·업적·시청자 배지를 닉네임 앞뒤에 표시하고 활동 배지는 넣지 않음");
check(/src\/achievementBadgeMap\.js/.test(watchHtml) && /2026chzzkopencup_4/.test(read("src/achievementBadgeMap.js")), "멀티뷰에서 지원하는 업적 배지 URL 표를 로드");
check(/cheeseFeatureHidden/.test(watch) && /chatShowTime === true/.test(watch) && /cheeseChatTimeFormat/.test(watch), "채팅 시간 표시 여부와 12/24시간 형식을 기존 설정에 맞춤");
check(/mvVodChatScaleDown/.test(watchHtml) && /mvVodChatScaleUp/.test(watchHtml) && /VOD_CHAT_SCALE_STEPS = Object\.freeze\(\[100, 125, 150, 175\]\)/.test(watch) && /vodChatScalePercent >= 175/.test(watch), "다시보기 채팅 크기를 100·125·150·175% 단계로 조절");
check(/createFontScaleControls\(/.test(watch) && /--mv-badge-chat-font-scale/.test(watch) && /--mv-vod-chat-scale/.test(watch), "다시보기 배지 채팅 팝업 헤더에 독립 글자 크기 조절을 제공");
check(/--mv-vod-chat-scale:\s*var\(--mv-badge-chat-font-scale, 1\)/.test(css), "본문 글자 크기가 다시보기 배지 팝업에 상속되지 않음");
check(!watch.includes("mv-vod-chat-role") && !watch.includes("mv-vod-chat-title") && !css.includes(".mv-vod-chat-role") && !css.includes(".mv-vod-chat-title"), "닉네임 앞 역할 문구와 제목 칩 제거");
check(/chatRecapEmojis/.test(watch) && /mv-vod-chat-emoji/.test(watch), "저장된 이모티콘 사전과 API 이모티콘 맵을 사용");
check(/kind: "subscription"/.test(read("src/multiviewVodChat.js")) && /kind: "gift"/.test(read("src/multiviewVodChat.js")) && /donationTone\(amount\)/.test(read("src/multiviewVodChat.js")) && /mv-vod-chat-card/.test(watch), "후원 금액별 색상과 구독·구독권 선물·미션 카드를 표시");
check(/const cheeseIcon = '<span class="mv-vod-chat-cheese-icon"/.test(watch) && (watch.match(/\$\{cheeseIcon\}/g) || []).length === 2 && /\.mv-vod-chat-cheese-icon::before\s*\{[^}]*icon_cheese\.png[^}]*height:\s*18px;[^}]*width:\s*18px/s.test(css), "후원·미션 금액에 18px 치즈 아이콘을 표시");
check(/is-channel-gift/.test(watch) && /is-personal-gift/.test(watch) && /gift_ticket_01\.png/.test(css) && (css.match(/background:\s*#3e34af/g) || []).length >= 2 && (css.match(/background:\s*#6f23cb/g) || []).length >= 2 && /rgba\(255, 255, 255, 0\.8\)/.test(css), "채널·개인 구독권 선물을 분리하고 티어별 색상과 장식을 적용");
check(/is-participation/.test(watch) && /mv-vod-chat-mission-prize-title/.test(watch) && /추가했습니다\./.test(watch) && /mv-vod-chat-mission-target/.test(watch), "미션 후원과 미션 상금 카드 레이아웃을 분리하고 과녁 아이콘을 표시");
check(/const missionTimeSeconds = mission \? durationTime : 0/.test(read("src/multiviewVodChat.js")) && /mv-vod-chat-mission-timer/.test(watch) && /viewBox="0 0 13 14"/.test(watch) && /missionTimeSeconds \/ 3600/.test(watch), "미션 타이머는 extras.durationTime을 사용");
check(/html\[data-theme="dark"\]\s+\.mv-vod-chat-card\.is-mission\s*\{[^}]*background:\s*#2a2c2f;[^}]*color:\s*#fff/s.test(css) && /html\[data-theme="dark"\]\s+\.mv-vod-chat-card\.is-mission\.is-participation\s*\{[^}]*color:\s*#dfe2ea/s.test(css) && /html\[data-theme="dark"\]\s+\.mv-vod-chat-card\.is-mission\.is-participation\s+\.mv-vod-chat-special-head\s*\{[^}]*color:\s*#fff/s.test(css) && /html\[data-theme="dark"\]\s+\.mv-vod-chat-card\.is-mission\s+\.mv-vod-chat-mission-label\s*\{[^}]*color:\s*#0e0f10/s.test(css), "다크 모드 미션·상금 카드 전용 배경과 글자색 적용");
check(/mv-vod-chat-inline/.test(watch) && /\.mv-vod-chat-message\s*\{[\s\S]*?display:\s*inline/.test(css), "일반 채팅의 닉네임과 메시지를 한 흐름으로 표시");
check(/\.mv-vod-chat-inline\s*\{[^}]*line-height:\s*calc\(20px \* var\(--mv-vod-chat-scale, 1\)\)/s.test(css) && /\.mv-vod-chat-inline \.mv-vod-chat-identity\s*\{[^}]*vertical-align:\s*top/s.test(css) && /\.mv-vod-chat-identity\s*\{[^}]*line-height:\s*inherit/s.test(css) && !/\.mv-vod-chat-message\s*\{[^}]*vertical-align:/s.test(css), "닉네임과 메시지가 네이티브의 상단 정렬·상속 line-height를 사용");
check(!/\.mv-vod-chat-inline strong\s*,[\s\S]*?color:\s*#b7c5ff/.test(css), "일반 다시보기 닉네임에 고정 파란색 대신 채팅 기본색을 사용");
check(/mv-vod-chat-identity/.test(watch) && /\.mv-vod-chat-inline \.mv-vod-chat-identity\s*\{[^}]*margin-right:\s*4px/s.test(css), "멀티뷰 다시보기 닉네임과 메시지 사이에 4px 간격을 둠");
check(/mv-vod-chat-profile-badge-group/.test(watch) && /\.mv-vod-chat-profile-badge-group\s*\{[^}]*gap:\s*4px/s.test(css), "멀티뷰 다시보기 프로필 배지 wrapper가 4px gap을 유지");
check(/\.mv-vod-chat-emoji\s*\{[^}]*margin-right:\s*var\(--mv-vod-chat-emoji-gap,\s*4px\)/s.test(css), "멀티뷰 다시보기 이모티콘 사이에 4px 간격을 둠");
check(/is-tier-\$\{info\.tier\}/.test(watch) && /\.mv-vod-chat-card\.is-subscription\.is-tier-1\s*\{[^}]*background:\s*#f0f1f2/s.test(css) && /html\[data-theme="dark"\] \.mv-vod-chat-card\.is-subscription\.is-tier-1\s*\{[^}]*background:\s*#202224/s.test(css) && /\.mv-vod-chat-card\.is-subscription\.is-tier-2\s*\{[^}]*background:\s*#ddf4ea/s.test(css) && /html\[data-theme="dark"\] \.mv-vod-chat-card\.is-subscription\.is-tier-2\s*\{[^}]*background:\s*#11382c/s.test(css), "구독 티어별 라이트·다크 배경색을 사용");
check(/\.mv-vod-chat-special-detail\s*\{[^}]*background:\s*#e1e1e5;[^}]*color:\s*#2e3033/s.test(css) && /html\[data-theme="dark"\]\s+\.mv-vod-chat-special-detail\s*\{[^}]*background:\s*#2e3033;[^}]*color:\s*#c9cedc/s.test(css) && /\.mv-vod-chat-card\.is-subscription\.is-tier-2\s+\.mv-vod-chat-special-detail\s*\{[^}]*background:\s*#0000000d;[^}]*color:\s*#2e3033/s.test(css) && /html\[data-theme="dark"\]\s+\.mv-vod-chat-card\.is-subscription\.is-tier-2\s+\.mv-vod-chat-special-detail\s*\{[^}]*background:\s*#ffffff0d;[^}]*color:\s*#c9cedc/s.test(css), "상세 문구의 공통·티어2 라이트/다크 배경과 글자색을 사용");
check(/\.mv-vod-chat-card\.is-subscription\s+\.mv-vod-chat-special-copy strong\s*\{[^}]*color:\s*#23815a/s.test(css) && /html\[data-theme="dark"\]\s+\.mv-vod-chat-card\.is-subscription\s+\.mv-vod-chat-special-copy\s+strong\s*\{[^}]*color:\s*#00ffa3/s.test(css), "구독 안내 강조색을 라이트·다크 모드에 맞춤");
check(/const header = \(suffix = ""\) =>[\s\S]*?suffix \? `<strong>\$\{esc\(suffix\)\}<\/strong>`/.test(watch), "특수 채팅 헤더의 님이 문구를 strong으로 표시");
const specialCardRenderer = watch.slice(watch.indexOf("function renderVodChatSpecialCard"), watch.indexOf("function renderVodChatRow"));
check(/function renderVodChatSpecialCard\(message, identity\)/.test(specialCardRenderer) && !/\$\{time\}/.test(specialCardRenderer), "후원·구독·미션 특수 메시지에서 시간을 숨김");
check(specialCardRenderer.includes("const content = renderVodChatText(message);") &&
  specialCardRenderer.includes('<strong class="mv-vod-chat-video-label">[영상 후원]</strong>') &&
  specialCardRenderer.includes("${identity}${videoLabel}") &&
  specialCardRenderer.includes("${content}${party}") &&
  !specialCardRenderer.includes("|| title") &&
  /\.mv-vod-chat-special-head \.mv-vod-chat-video-label\s*\{[^}]*color:\s*#00ffa3/s.test(css),
  "영상 후원 라벨을 닉네임 옆에 강조하고 빈 후원 본문은 비워 둠");
const badgeRenderer = watch.slice(watch.indexOf("const renderBadges ="), watch.indexOf("const time = rowTime"));
check(/mv-vod-chat-profile-badge/.test(badgeRenderer) && /alt="\$\{esc\(position === "after" \? "" : badge\.label\)\}"/.test(badgeRenderer) && !/title=/.test(badgeRenderer), "닉네임 앞 배지는 대체 텍스트를 유지하고 뒤쪽 장식 배지는 빈 alt로 표시");
check(!/\.mv-vod-chat-row\.is-current/.test(css) && !/is-current/.test(watch.slice(watch.indexOf("function renderVodChatRow"), watch.indexOf("function renderVodChat()"))), "현재 재생 채팅 강조 배경·테두리·그림자를 사용하지 않음");
check(/broadcastTimeAt/.test(read("src/multiviewVodChat.js")) && /mvVodChatTimeMode/.test(watchHtml), "재생 시간과 실제 방송 시각을 전환");
check(/let vodChatTimeMode = "broadcast"/.test(watch) &&
  /id="mvVodChatTimeMode" aria-pressed="true"[\s\S]*?aria-label="재생 시간으로 전환"[\s\S]*?>방송 시각<\/button>/.test(watchHtml),
  "다시보기 채팅 시간 표시의 초기값을 실제 방송 시각으로 설정");
check(/if \(!canShowBroadcastTime && snapshot\.complete\) vodChatTimeMode = "playback"/.test(watch) &&
  /complete: noMore/.test(read("src/multiviewVodChat.js")),
  "방송 시각이 없다는 이유로 첫 페이지 로딩 중 기본값이 사라지지 않음");
check(/cheese-multiview-no-root-scroll/.test(content) &&
  /html\.cheese-popup-player-frame\.cheese-multiview-frame\.cheese-multiview-no-root-scroll,[\s\S]*?overflow:\s*hidden !important/.test(read("src/content.css")) &&
  /html\.cheese-popup-player-frame\.cheese-multiview-chat-frame\.cheese-multiview-no-root-scroll/.test(read("src/content.css")),
  "공통 팝업 스크롤 규칙보다 우선해 멀티뷰 루트 스크롤을 막음");
check(/IS_MULTIVIEW_FRAME && multiviewVideoNo[\s\S]*?cheese-multiview-vod-frame/.test(content) &&
  /html\.cheese-popup-player-frame\.cheese-multiview-vod-frame[\s\S]*?section\[class\*=\"_container_\"\][\s\S]*?overflow:\s*hidden !important/.test(read("src/content.css")),
  "멀티뷰 다시보기 iframe 내부 section의 스크롤을 차단");
check(/\.mv-chat-body\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden/s.test(css) &&
  /\.mv-vod-chat-feed\s*\{[^}]*overflow:\s*hidden/s.test(css) &&
  /\.mv-badge-chat-popover\s*\{[^}]*overflow:\s*hidden/s.test(css) &&
  /\.mv-vod-chat-list\s*\{[^}]*overflow-y:\s*auto;[^}]*scrollbar-width:\s*none/s.test(css) &&
  /\.mv-vod-chat-list::-webkit-scrollbar\s*\{[^}]*height:\s*0;[^}]*width:\s*0/s.test(css),
  "다시보기 채팅은 스크롤을 유지하면서 y축 스크롤바를 숨김");
check(/\.mv-vod-chat-list\s*\{[^}]*flex-direction:\s*column;[^}]*justify-content:\s*flex-start/s.test(css) &&
  /\.mv-vod-chat-row:first-child\s*\{[^}]*margin-top:\s*auto/s.test(css) &&
  /list\.scrollHeight - list\.clientHeight - list\.scrollTop < 32/.test(watch) &&
  /list\.innerHTML = visible\s*\.map/.test(watch) &&
  /list\.scrollTop = nearBottom \? list\.scrollHeight : previousScrollTop/.test(watch),
  "넘치기 전 아래 정렬을 유지하고, 넘친 뒤 하단 따라가기와 수동 스크롤을 지원");
check(/FRAME_VOD_CHAT_PLAYBACK/.test(content) && /SET_MULTIVIEW_VOD_CHAT/.test(content), "재생 시각 브리지의 송수신 구현");
const vodLoadStart = watch.slice(watch.indexOf("function loadChat("), watch.indexOf("function applyChat("));
check(/vodChatSession\.start\(videoChannel\.videoNo, 0\)/.test(vodLoadStart), "최초 VOD 채팅 선택 즉시 0초 기준 세션을 시작");
check(vodLoadStart.indexOf("vodChatSession.start(") < vodLoadStart.indexOf("postVodChatControl(selectedId, true"), "플레이어 재생 이벤트보다 먼저 VOD 채팅 로딩을 시작");
const applyChat = watch.slice(watch.indexOf("function applyChat("), watch.indexOf("function restoreInlineChat("));
check(/vodChatSourceId === source\.id && video\?\.videoNo &&\s*vodSnapshot\.videoNo === video\.videoNo && !\$\("mvVodChatFeed"\)\.hidden/.test(applyChat), "VOD 채팅은 해당 다시보기 세션과 실제 피드가 준비된 경우에만 중복 로드를 생략");
check(/event\.source !== window\.parent/.test(content) && /event\.origin !== MULTIVIEW_PARENT_ORIGIN/.test(content), "다시보기 재생 명령에 기존 출처 검증 유지");
check(/event\.source !== frame\.contentWindow/.test(watch) && /data\.chatGeneration !== chatGeneration/.test(watch), "부모가 해당 프레임과 최신 채팅 세대만 수용");
check(!/chrome\.storage|background\.sendMessage/.test(read("src/multiviewVodChat.js")), "다시보기 원문을 영구 저장하거나 백그라운드로 중계하지 않음");
check(/document\.querySelector\("aside#vod-aside"\)/.test(content), "멀티뷰 초기 접기 대상에 다시보기 채팅 aside 포함");
check(/function getChatFoldToggleBtn\(aside = null\)/.test(content), "네이티브 접기 버튼을 해당 채팅 aside 안에서 찾음");
check(/function getVodChatCloseButton\(aside = null\)[\s\S]*?button\[class\*="_close_button_"\]/.test(content), "다시보기 채팅의 전용 닫기 버튼을 찾음");
// 수동 '다시 적용'용 force 인자가 붙어도 같은 함수를 찾는다.
const foldReconcileStart = content.indexOf("function ensureMultiviewChatFold(");
const foldReconcileEnd = content.indexOf("// 넓은 화면은 MAIN world", foldReconcileStart);
const foldReconcile = content.slice(foldReconcileStart, foldReconcileEnd);
check(/if \(isVod && isVodChatFoldedAway\(\)\) return true/.test(foldReconcile), "네이티브 펼치기 버튼이 나타나면 다시보기 채팅을 닫힌 상태로 판정");
check(/isVod\s*\?\s*getVodChatCloseButton\(aside\)\s*:\s*getChatFoldToggleBtn\(aside\)/.test(foldReconcile), "라이브 토글과 다시보기 닫기 버튼을 구분해 실행");
check(/\.mv-card\.is-skeleton \.mv-card-text\s*\{\s*flex:\s*1;\s*\}/s.test(css), "기본 다시보기 스켈레톤에서 제목·채널명 줄이 프로필 옆 너비를 차지");
check(/:root:not\(\[data-theme="dark"\]\)\s+\.mv-video-rerank-controls\s+\.cheese-search-control:hover[\s\S]*?background:\s*#e7ddfb;[\s\S]*?color:\s*#452b7d;/s.test(css), "라이트 모드 재정렬 버튼에 충분한 보라색 대비 적용");
check(/:root:not\(\[data-theme="dark"\]\)\s+\.mv-video-rerank-controls\s+\.cheese-search-options-segments\s+button\.is-active[\s\S]*?background:\s*#d9cbf5;[\s\S]*?color:\s*#392267;/s.test(css), "라이트 모드 설정 패널 선택 버튼에 진한 보라색 적용");
check(/let quickVideoChannelKeyword = "";/.test(watch) && /let quickVideoRerankSearchKeyword = "";/.test(watch), "Quick 채널 검색과 재정렬 검색이 별도 상태를 사용");
check(/const onQuickVideoChannelSearchInput = \(event\) => \{\s*quickVideoChannelKeyword = event\.target\.value;/.test(watch) && /const onQuickVideoRerankSearchInput = \(event\) => \{\s*quickVideoRerankSearchKeyword = event\.target\.value;/.test(watch), "각 Quick 검색 입력이 자기 검색어만 갱신");
check(!watch.includes('$("mvQuickVideoRerankSearchInput").value = quickVideoChannelKeyword') && !watch.includes('$("mvQuickVideoChannelSearchInput").value = quickVideoRerankSearchKeyword'), "한 Quick 검색어가 다른 탭의 입력칸을 덮어쓰지 않음");

console.log("\n[다시보기 카드·재정렬 UI] 배지 정렬과 팝오버 레이어");
check(/\.mv-card-badge-row\s*\{[^}]*display:\s*flex/s.test(css), "다시보기 배지를 가로로 배치할 컨테이너");
check(/\.mv-card-live-pv,\s*\.mv-card-duration\s*\{[^}]*font-weight:\s*700/s.test(css), "livePv와 재생 시간 글꼴 굵기 700");
check(/\.mv-video-rerank-controls\s*\{[^}]*justify-content:\s*flex-end/s.test(css), "재정렬 컨트롤을 오른쪽 끝에 배치");
check(/#mvVideoRerankSearch,\s*#mvQuickVideoRerankSearch\s*\{[^}]*z-index:\s*120/s.test(css), "두 재정렬 영역을 썸네일 배지보다 위에 배치");
check(/\.mv-video-rerank-controls \.cheese-search-sort-menu\s*\{[^}]*z-index:\s*1500/s.test(css) &&
  /\.mv-video-rerank-controls \.cheese-search-options-popover\s*\{[^}]*z-index:\s*1501/s.test(css), "정렬·설정 팝오버의 높은 레이어");
check(/class="mv-card-live is-replay"[\s\S]*?class="mv-card-live-pv"/.test(setupPage) &&
  /class="mv-card-live is-replay"[\s\S]*?class="mv-card-live-pv"/.test(watch), "setup·시청 양쪽 다시보기 카드에서 livePv가 배지 뒤에 위치");

if (failed) {
  console.error(`\n${failed}개 테스트 실패`);
  process.exitCode = 1;
} else {
  console.log("\n전부 통과");
}
