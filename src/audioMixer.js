// 치즈 서치 - 오디오 믹서 (MAIN world content script)
// 치지직 라이브 <video>에 Web Audio 그래프를 연결해 컴프레서/노멀라이저/EQ를
// 적용한다. content script(격리 월드)에서는 페이지 <video>의
// MediaElementSource를 만들 수 없으므로 manifest에서 "world": "MAIN"으로 주입된다.
// 설정 저장은 MAIN world에서 chrome.storage 접근이 불가하므로 window.postMessage로
// 일반 content script(src/content.js)에 위임한다.
(() => {
  "use strict";

  if (window.__cheeseAudioMixerLoaded) return;
  window.__cheeseAudioMixerLoaded = true;

  // 팝업 기능 표시/숨김 플래그(content.js가 chrome.storage에서 읽어 postMessage로 전달).
  const featureFlags = {
    audioMixer: false,
    streamStats: false,
    liveSync: false,
    liveRewind: false,
    tabMute: false,
    screenshotButton: false, // 스크린샷 버튼 숨김(true=숨김, 기본 표시)
  };
  // '항상 켜기'(전역) + 첫 사용자 제스처 감지. 제스처 전엔 자동 활성화하지 않는다
  // (AudioContext 자동재생 정책 + 타 확장과의 source 선점 경쟁 회피).
  let mixerAlwaysOn = false;
  let wideScreenAuto = false; // 넓은 화면(viewmode) 진입 시 자동 적용(전역)
  let liveSeekBarOn = true; // 라이브 되감기 바(seekable 표시+드래그 seek) 표시(전역, 기본 ON)
  let volumePctOn = true; // 볼륨 조절 시 % 표시(전역, 기본 ON)
  let wheelVolumeOn = false; // 영상 위 마우스 휠로 볼륨 조절(전역, 기본 OFF)
  let wheelVolumeRightClick = false; // 우클릭(오른쪽 버튼)을 누른 채 휠일 때만 조절(기본 OFF)
  let wheelVolumeStep = 0.05; // 휠 한 틱당 볼륨 변화량(0.01~0.10, 기본 0.05=5%)
  let actionOverlayOn = true; // 조작(휠 볼륨/시크) 시 화면 반투명 피드백(전역, 기본 ON)
  // OSD(조작 오버레이) 종류별 표시 on/off + 위치(중심 기준 %). 볼륨은 전체 화면 기준,
  // 되감기는 왼쪽 절반 기준(x 0~100 → 실제 0~50%), 앞으로는 오른쪽 절반 기준(x 0~100 →
  // 실제 50~100%). y 는 셋 다 전체 화면 기준 0~100%. 기본값은 기존 위치(볼륨 중앙 등).
  const actionOverlayPos = {
    volume: { on: true, x: 50, y: 50 },
    rewind: { on: true, x: 30, y: 50 }, // 왼쪽 절반의 30% → 실제 left 15%
    forward: { on: true, x: 70, y: 50 }, // 오른쪽 절반의 70% → 실제 left 85%
  };
  let gainPctOn = true; // 게인 조절 시 % 표시(전역, 기본 ON)
  let screenshotPreviewOn = false; // 스크린샷 저장 전 미리보기(전역, 기본 OFF)
  let mixerClickActivate = false; // 믹서 버튼 클릭 시 즉시 활성/비활성(전역, 기본 OFF)
  let mixerClickNoPanel = false; // 위 옵션 시 패널을 열지 않고 효과만 토글(전역, 기본 OFF)
  let mixerBeginner = false; // 초보자용 원클릭: 클릭 시 패널 없이 기본 프리셋으로 바로 on/off
  let maxQualityAuto = false; // 시청 시 최대 화질 자동 고정(전역, 기본 OFF)
  let maxQualityRespectManual = true; // 수동 화질 변경 시 존중(전역, 기본 ON)
  // 플레이어 하단 버튼 좌/우 배치(전역). 버튼별 "left"|"right". 기본은 현재 배치(우측).
  // 오디오 믹서/비디오 필터는 볼륨 컨트롤로 감싸진 특수 배치라 이동 대상에서 제외한다.
  // 하단 버튼 배치: side=각 버튼 소속 그룹, order=그룹 내 순서. content.js 가 정규화해
  // { side, order, slot } 형태로 브로드캐스트한다. 되감기/앞으로는 각각 독립 이동.
  // 배열 순서 = 기본(초기화) 순서: 되감기·따라잡기·앞으로·탭음소거·스크린샷·스트림정보.
  const PLAYER_BTN_KEYS = [
    "rewind",
    "sync",
    "forward",
    "tabMute",
    "screenshot",
    "streamStats",
  ];
  const playerButtonSide = {
    side: {
      streamStats: "right",
      tabMute: "right",
      screenshot: "right",
      rewind: "right",
      forward: "right",
      sync: "right",
    },
    order: {
      left: [],
      right: [
        "rewind",
        "sync",
        "forward",
        "tabMute",
        "screenshot",
        "streamStats",
      ],
    },
    // 각 우리 버튼이 붙는 네이티브 앵커(그 뒤에 배치). "START"=그룹 맨 앞. 기본은
    // 우측 샵 버튼 뒤(=클립 버튼 앞, 기존 배치 재현).
    slot: {
      streamStats: { grp: "right", after: "custom__shop-button" },
      tabMute: { grp: "right", after: "custom__shop-button" },
      screenshot: { grp: "right", after: "custom__shop-button" },
      rewind: { grp: "right", after: "custom__shop-button" },
      forward: { grp: "right", after: "custom__shop-button" },
      sync: { grp: "right", after: "custom__shop-button" },
    },
  };
  // 그룹별 네이티브 앵커 클래스(DOM 순서). arrangePlayerButtons 가 이 순서로 앵커를
  // 처리하고, 저장 slot 의 앵커가 현재 DOM 에 없으면 다음 존재하는 앵커로 폴백한다.
  // 오디오 믹서는 앵커 제외(믹서·필터 사이 배치 금지) — 필터만 앵커.
  const PLAYER_BTN_ANCHOR_ORDER = {
    left: [
      "pzp-playback-switch",
      "pzp-pc__volume-control",
      "cheese-video-filter-control",
      "live_time",
    ],
    right: [
      "custom__shop-button",
      "custom__clip-button",
      "pzp-pip-button",
      "pzp-setting-button",
      "pzp-viewmode-button",
      "pzp-pc__fullscreen-button",
    ],
  };
  let forceFullTick = false; // 다음 tick에서 fast-path를 건너뛰고 full로 돌린다(플래그 변경 등)
  let userGestureSeen = false;
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "cheese-feature-flags")
      return;
    const f = e.data.flags || {};
    featureFlags.audioMixer = f.audioMixer === true;
    featureFlags.streamStats = f.streamStats === true;
    featureFlags.liveSync = f.liveSync === true;
    featureFlags.liveRewind = f.liveRewind === true;
    featureFlags.tabMute = f.tabMute === true;
    featureFlags.screenshotButton = f.screenshotButton === true;
    // 오디오 믹서 '항상 켜기'(전역). 켜져 있으면 첫 사용자 제스처 이후 자동 활성화.
    mixerAlwaysOn = e.data.mixerAlwaysOn === true;
    // 넓은 화면 자동 적용(전역). 켜져 있으면 플레이어 진입 시 viewmode를 1회 켠다.
    wideScreenAuto = e.data.wideScreenAuto === true;
    if (typeof maybeAutoWideScreen === "function") maybeAutoWideScreen();
    // 볼륨/게인 % 표시(전역, 미설정=기본 ON). 끄면 조절 시 % 툴팁을 띄우지 않는다.
    volumePctOn = e.data.volumePct !== false;
    actionOverlayOn = e.data.actionOverlay !== false; // 기본 ON
    // OSD 종류별 표시/위치(있으면 반영). 값은 content.js 가 정규화해 넘긴다.
    if (e.data.actionOverlayPos && typeof e.data.actionOverlayPos === "object") {
      for (const k of ["volume", "rewind", "forward"]) {
        const p = e.data.actionOverlayPos[k];
        if (p && typeof p === "object") {
          if (typeof p.on === "boolean") actionOverlayPos[k].on = p.on;
          if (Number.isFinite(p.x))
            actionOverlayPos[k].x = Math.min(100, Math.max(0, p.x));
          if (Number.isFinite(p.y))
            actionOverlayPos[k].y = Math.min(100, Math.max(0, p.y));
        }
      }
    }
    wheelVolumeOn = e.data.wheelVolume === true; // 기본 OFF
    wheelVolumeRightClick = e.data.wheelVolumeRightClick === true; // 기본 OFF
    // 휠 볼륨 조절 간격(% 1~10 → 0.01~0.10). 범위 밖/미설정이면 5%.
    {
      const s = Number(e.data.wheelVolumeStep);
      wheelVolumeStep = Number.isFinite(s)
        ? Math.min(10, Math.max(1, Math.round(s))) / 100
        : 0.05;
    }
    gainPctOn = e.data.gainPct !== false;
    // 스크린샷 저장 전 미리보기(전역, 기본 OFF). 켜면 모달로 저장/취소 확인.
    screenshotPreviewOn = e.data.screenshotPreview === true;
    // 믹서 버튼 클릭 시 즉시 활성/비활성(전역, 기본 OFF=패널만 토글).
    mixerClickActivate = e.data.mixerClickActivate === true;
    mixerClickNoPanel = e.data.mixerClickNoPanel === true;
    // 초보자용 원클릭(전역, 기본 OFF). 켜지면 위 옵션·전역기본값과 무관하게 클릭 시
    // 패널 없이 기본 프리셋으로 바로 on/off 한다.
    const mixerBeginnerPrev = mixerBeginner;
    mixerBeginner = e.data.mixerBeginner === true;
    // 옵션을 방금 '켠' 순간, 믹서가 이미 켜져 있으면(다른 프리셋 사용 중) 즉시 기본
    // 프리셋으로 교체한다(끄기 전까진 초보자 모드가 프리셋을 고정하므로). 꺼져 있으면
    // 그대로 두고 다음 버튼 클릭 시 적용.
    if (
      mixerBeginner &&
      !mixerBeginnerPrev &&
      state.enabled &&
      typeof applyPreset === "function"
    ) {
      applyPreset("default");
    }
    // 최대 화질 자동 고정(전역, 기본 OFF) + 수동 변경 존중(기본 ON). 켜지면 즉시 시도.
    maxQualityAuto = e.data.maxQualityAuto === true;
    maxQualityRespectManual = e.data.maxQualityRespectManual !== false;
    if (maxQualityAuto && typeof applyMaxQuality === "function") {
      // 옵션을 방금 켠 경우 현재 video 에 이벤트를 바인딩해 두면, 다음 재생/전환에서
      // 곧바로 최고화질이 걸린다. 이미 재생 중이면 applyMaxQuality 가 즉시 처리.
      if (typeof bindMaxQualityEvents === "function") bindMaxQualityEvents();
      applyMaxQuality();
    }
    // 전역 기본값 재방문 동작(global | channel, 기본 global).
    globalDefaultMode =
      e.data.mixerGlobalDefaultMode === "channel" ? "channel" : "global";
    // 게인 슬라이더 범위(전역). 기본 0.5~2. 값이 바뀌면 현재 게인을 새 범위로
    // 클램프하고 슬라이더/패널을 다시 그려 즉시 반영한다.
    updateGainRange(e.data.mixerGainMin, e.data.mixerGainMax);
    // 라이브 되감기 바 표시(전역, 미설정=기본 ON). 끄면 바 제거.
    liveSeekBarOn = e.data.liveSeekBar !== false;
    if (typeof applyLiveSeekBar === "function") applyLiveSeekBar();
    // 따라잡기 민감도 프리셋(낮음/보통/높음/커스텀). content.js가 chrome.storage에서
    // 읽어 전달. custom이면 syncCustom={enable,target}을 함께 받는다.
    if (typeof applySyncPreset === "function")
      applySyncPreset(e.data.syncPreset, e.data.syncCustom);
    // 따라잡기 배속(1.2/1.5/2/3). 쿨다운 on/off + 커스텀 {base,max}(초).
    if (typeof applySyncTuning === "function")
      applySyncTuning(
        e.data.syncRate,
        e.data.syncCooldownEnabled,
        e.data.syncCooldownCustom,
      );
    // 되감기 간격(3~60초). 바뀌면 이미 떠 있는 버튼 라벨/아이콘 갱신.
    const ns = Number(e.data.seekStepS);
    if (Number.isFinite(ns) && ns >= 3 && ns <= 60) {
      const changed = ns !== seekStepS;
      seekStepS = Math.round(ns);
      if (changed && typeof refreshSeekButtonLabels === "function")
        refreshSeekButtonLabels();
    }
    // 하단 버튼 좌/우 배치 + 그룹 내 순서(전역). { side, order } 를 받아 반영하고, 값이
    // 바뀌면 버튼을 재배치한다.
    const pbs = e.data.playerButtonSide;
    if (pbs && typeof pbs === "object" && pbs.side && pbs.order) {
      const prev = JSON.stringify(playerButtonSide);
      for (const k of PLAYER_BTN_KEYS) {
        if (pbs.side[k] === "left" || pbs.side[k] === "right") {
          playerButtonSide.side[k] = pbs.side[k];
        }
      }
      for (const grp of ["left", "right"]) {
        if (Array.isArray(pbs.order[grp])) {
          playerButtonSide.order[grp] = pbs.order[grp].filter((k) =>
            PLAYER_BTN_KEYS.includes(k),
          );
        }
      }
      // 네이티브 앵커 슬롯 반영. grp 는 side 와 일치, after 는 그 그룹 허용 앵커거나 START.
      if (pbs.slot && typeof pbs.slot === "object") {
        for (const k of PLAYER_BTN_KEYS) {
          const sv = pbs.slot[k];
          if (!sv || typeof sv !== "object") continue;
          const grp = playerButtonSide.side[k] === "left" ? "left" : "right";
          let after = typeof sv.after === "string" ? sv.after : "START";
          if (
            after !== "START" &&
            !PLAYER_BTN_ANCHOR_ORDER[grp].includes(after)
          )
            after = "START";
          playerButtonSide.slot[k] = { grp, after };
        }
      }
      if (
        JSON.stringify(playerButtonSide) !== prev &&
        typeof relocatePlayerButtons === "function"
      ) {
        relocatePlayerButtons();
      }
    }
    // 플래그가 바뀌었으니 다음 tick은 fast-path를 건너뛰고 반드시 full로 돌려
    // 버튼 숨김/표시를 즉시 반영한다(안 그러면 컨트롤 재렌더가 있을 때까지 지연됨).
    forceFullTick = true;
    if (typeof tick === "function") tick();
    if (typeof maybeAutoEnableMixer === "function") maybeAutoEnableMixer();
  });
  // 로드 직후 현재 플래그를 요청한다(content.js의 초기 송신을 놓쳤을 수 있으므로).
  window.postMessage(
    { source: "cheese-feature-flags-request" },
    location.origin,
  );

  // content.js(격리 월드)가 background로부터 받은 탭 음소거 상태를 돌려준다.
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "cheese-tab-mute-content")
      return;
    tabMutedState = e.data.muted === true;
    if (typeof syncTabMuteButton === "function") syncTabMuteButton();
  });
  // 탭 음소거 토글/조회 요청을 content.js로 보낸다.
  function requestTabMuteToggle() {
    window.postMessage(
      { source: "cheese-tab-mute", type: "toggle" },
      location.origin,
    );
  }
  function requestTabMuteQuery() {
    window.postMessage(
      { source: "cheese-tab-mute", type: "query" },
      location.origin,
    );
  }

  const PANEL_ID = "cheese-audio-mixer-panel";
  const BUTTON_CLASS = "cheese-audio-mixer-button";
  const CONTROL_CLASS = "cheese-audio-mixer-control";
  const STATS_PANEL_ID = "cheese-stream-stats-panel";
  const STATS_BUTTON_CLASS = "cheese-stream-stats-button";
  const STATS_REFRESH_MS = 1000;
  // 탭 음소거 버튼(브라우저 탭 전체 음소거 토글, background 경유).
  const TAB_MUTE_BUTTON_CLASS = "cheese-tab-mute-button";
  let tabMutedState = false; // content.js 응답으로 동기화되는 현재 탭 음소거 상태
  // 스크린샷 버튼(현재 재생 프레임을 PNG로 저장). 표준 canvas.drawImage 기법.
  const SCREENSHOT_BUTTON_CLASS = "cheese-screenshot-button";
  // 음량 슬라이더 조절 시 현재 % 값을 보여주는 툴팁.
  const VOLUME_TOOLTIP_CLASS = "cheese-volume-tooltip";
  const VOLUME_TOOLTIP_HIDE_MS = 700; // 조작 멈춘 뒤 이 시간 후 숨김
  // 라이브 되감기/앞으로(seekable 윈도우 내) 관련
  const REWIND_BUTTON_CLASS = "cheese-live-rewind-button";
  const FORWARD_BUTTON_CLASS = "cheese-live-forward-button";
  const SEEK_BAR_CLASS = "cheese-live-seek-bar"; // 되감기 가능 영역 표시 + 드래그 seek 바
  let seekStepS = 10; // 한 번에 ±N초(settings에서 3~60 조절). content.js가 전달.
  const SEEK_EDGE_PAD_S = 2; // 라이브 엣지에 이만큼 못 미치게(엣지 직전까지만 앞으로)

  // 라이브 싱크 따라잡기 관련
  const SYNC_BUTTON_CLASS = "cheese-live-sync-button";
  const SYNC_MENU_ID = "cheese-live-sync-menu";
  const SYNC_CHECK_MS = 1000; // 버튼 활성/비활성 갱신 주기
  let SYNC_RATE = 1.5; // 따라잡기 배속(설정으로 변경 가능: 1.2/1.5/2/3)
  const SYNC_MAX_DURATION_MS = 30000; // 안전: 최대 따라잡기 시간
  const SYNC_NO_PROGRESS_MS = 4000; // 이 시간 동안 지연이 의미있게 안 줄면(스톨) 중단
  const SYNC_PROGRESS_EPS_S = 0.3; // '진전'으로 인정할 최소 지연 감소(초)
  const SYNC_JUMP_LATENCY_S = 12; // 이 지연(초) 이상이면 1.5배속 대신 라이브로 즉시 점프
  // 따라잡기 민감도 프리셋(settings에서 선택). enable=발동/버튼활성 임계, target=목표 지연.
  // 값이 작을수록 라이브에 더 바짝 붙는다(자주 발동). 큰 값은 느슨하게(끊김 적게).
  const SYNC_PRESETS = {
    low: { enable: 5, target: 3 }, // 낮음: 느슨하게(끊김 최소)
    normal: { enable: 3, target: 2 }, // 보통(기본)
    high: { enable: 2, target: 1.5 }, // 높음: 라이브에 바짝
  };
  let syncPresetKey = "normal";
  // 현재 적용 중인 임계값. enable=수동/자동 발동 임계, target=따라잡기 목표 지연.
  let syncCfg = { ...SYNC_PRESETS.normal };
  // 자동 따라잡기 재발동 쿨다운(진동 방지). 지수 백오프로 늘었다 안정 시 리셋.
  // base/max 는 설정으로 변경 가능(let). 쿨다운을 끄면(syncCooldownOn=false) 백오프 없이
  // 항상 최소 간격(SYNC_COOLDOWN_OFF_MS)으로만 막아 지연이 밀리면 바로바로 따라잡는다.
  let SYNC_AUTO_COOLDOWN_BASE_MS = 15000; // 기본 쿨다운
  let SYNC_AUTO_COOLDOWN_MAX_MS = 120000; // 백오프 상한(2분)
  const SYNC_BACKOFF_RESET_MS = 120000; // 이 시간 동안 안정(임계 아래)이면 백오프 리셋
  const SYNC_COOLDOWN_OFF_MS = 3000; // 쿨다운 OFF 시 최소 간격(과도한 연속 발동만 방지)
  let syncCooldownOn = true; // 쿨다운 사용 여부(기본 ON)
  let syncAutoCooldownMs = SYNC_AUTO_COOLDOWN_BASE_MS; // 현재 쿨다운(백오프로 변동)
  let syncLastUnstableAt = 0; // 마지막으로 임계 이상이었던 시각(백오프 리셋 판단)
  const SYNC_USER_SEEK_PAUSE_MS = 60000; // 사용자가 과거로 seek하면 이 시간만큼 자동 따라잡기 중단
  // 되감기 버튼으로 10초 이내(±여유)만 되감았을 땐 60초나 멈출 필요 없이 짧게만
  // 멈췄다 다시 따라잡는다(잠깐 놓친 부분 확인용). 작은 되감기에 한해 적용.
  const SYNC_SHORT_REWIND_MAX_S = 10; // 이 이하의 되감기는 '짧은 되감기'로 간주
  const SYNC_SHORT_REWIND_PAUSE_MS = 10000; // 짧은 되감기 시 자동 따라잡기 중단 시간
  const SYNC_BACK_SEEK_MIN_S = 2; // 이 이상 지연이 늘어난 seek만 '과거 보기'로 간주(앞으로/라이브 복귀는 제외)
  const SYNC_FRESH_ENTRY_WINDOW_MS = 20000; // 라이브 최초 진입 후 이 시간 안에서만 1회 강제 따라잡기 시도
  const SYNC_AUTO_STORE_KEY = "cheeseAudioMixer.autoSync"; // 전역 저장 키
  const PANEL_RIGHT_PX = 16;
  const PANEL_BOTTOM_PX = 64;
  const PANEL_TOP_GAP_PX = 12;
  const PANEL_MAX_HEIGHT_PX = 520;
  const PANEL_MIN_HEIGHT_PX = 160;
  const PANEL_ANCHOR_CHECK_MS = 250;
  const PANEL_AUTO_CLOSE_DELAY_MS = 4000;
  const CUSTOM_PRESET_NAME_MAX_LENGTH = 7;
  const EQ_BANDS = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
  // 고급 슬라이더(저음/선명도/고음)가 함께 움직이는 EQ 밴드 그룹과 밴드별 가중치.
  // 단일 밴드만 움직이던 방식보다 자연스러운 쉘프 형태가 된다.
  const EQ_GROUPS = {
    bass: { bands: [0, 1, 2], weights: [1, 0.8, 0.5] },
    clarity: { bands: [3, 4, 5], weights: [0.6, 1, 0.7] },
    treble: { bands: [6, 7, 8, 9], weights: [0.5, 0.8, 1, 1] },
  };

  // 고급 슬라이더·전문가 모드 각 항목의 역할/조절 효과 설명(info 아이콘 클릭 시 표시).
  const INFO_TEXT = {
    gain: "전체 음량(볼륨) 배율입니다. 1.0이 원음이며, 높이면 전체가 커지고 낮추면 작아집니다. 너무 높이면 소리가 찢어질 수 있어요.",
    bass: "저음(베이스) 대역을 올리거나 내립니다. 올리면 묵직하고 풍부해지고, 내리면 웅웅거림이 줄어 깔끔해집니다.",
    treble:
      "고음(트레블) 대역을 올리거나 내립니다. 올리면 선명하고 또렷해지지만 과하면 쉬익 소리가 거슬릴 수 있어요.",
    clarity:
      "사람 목소리 대역(중음)을 강조합니다. 올리면 말소리가 또렷하게 앞으로 나오고, 내리면 배경에 묻힙니다.",
    normalizer:
      "음량 균일화. 작은 소리는 키우고 큰 소리는 줄여 전체 음량을 일정하게 맞춥니다. 방송·구간마다 볼륨이 들쭉날쭉할 때 켜면 편합니다.",
    comp: "다이내믹 압축(컴프레서). 큰 소리를 눌러 작은 소리와의 차이를 줄입니다. 갑작스러운 큰 소리를 부드럽게 만들어 듣기 편해집니다.",
    limiter:
      "최대 음량 제한(리미터). 설정한 한계를 넘는 소리를 강하게 막아 갑작스러운 폭발음·고함으로부터 귀를 보호합니다.",
    "comp-threshold":
      "컴프레서가 작동하기 시작하는 음량 기준(dB)입니다. 낮출수록(왼쪽) 더 작은 소리부터 압축이 걸려 효과가 강해집니다.",
    "comp-knee":
      "임계점 부근에서 압축이 얼마나 부드럽게 시작되는지 결정합니다. 값이 클수록 자연스럽게, 작을수록 또렷하게 압축이 걸립니다.",
    "comp-ratio":
      "압축 비율입니다. 기준을 넘은 소리를 얼마나 줄일지 정합니다. 높일수록(예: 12:1) 큰 소리가 강하게 눌립니다.",
    "comp-attack":
      "큰 소리가 들어온 뒤 압축이 걸리기까지의 시간(초)입니다. 짧으면 즉각 반응해 강하게, 길면 초반 타격감을 살립니다.",
    "comp-release":
      "소리가 작아진 뒤 압축이 풀리기까지의 시간(초)입니다. 짧으면 빠르게 원래대로, 길면 부드럽게 돌아옵니다.",
    "comp-makeup":
      "메이크업 게인(dB)입니다. 컴프레서가 큰 소리를 눌러 전체 음량이 작아진 만큼을 다시 키워 원래 체감 음량으로 보정합니다. 컴프를 강하게 걸수록 올려주면 좋습니다.",
    "limiter-threshold":
      "리미터가 막기 시작하는 최대 음량(dB)입니다. 낮출수록 더 일찍 막아 전체 음량이 안정되지만 너무 낮추면 답답해질 수 있어요.",
    "normalizer-target":
      "음량 균일화의 목표 레벨입니다. 높일수록 전체 음량을 더 크게 끌어올려 평준화하고, 낮추면 더 조용한 기준으로 맞춥니다.",
    // 전문가 모드 그룹 제목용 개념 설명
    "group-eq":
      "이퀄라이저(EQ). 소리를 주파수 대역(저음~고음)으로 나눠 각 대역을 키우거나 줄여 음색을 조절합니다. 10개 밴드는 왼쪽이 저음(60Hz), 오른쪽이 고음(16kHz)입니다.",
    "group-gain":
      "음량(게인). 모든 처리를 거치기 전 입력 신호의 전체 크기를 조절합니다. 기본 볼륨이 너무 작거나 클 때 여기서 맞춥니다.",
    "group-comp":
      "컴프레서. 큰 소리를 자동으로 눌러 작은 소리와의 음량 차이(다이내믹 레인지)를 줄입니다. 갑작스러운 큰 소리를 부드럽게 만들어 오래 들어도 편안합니다. 아래 값들로 작동 강도와 반응 속도를 세밀하게 조절합니다.",
    "group-limiter":
      "리미터. 설정한 한계를 넘는 소리를 강하게 막아 그 이상 커지지 않게 합니다. 컴프레서보다 더 강력한 '천장' 역할로, 폭발음·고함 같은 순간적인 큰 소리로부터 귀를 보호합니다.",
    "group-normalizer":
      "노멀라이저(음량 균일화). 실시간으로 소리 크기를 분석해 작은 소리는 키우고 큰 소리는 줄여, 방송이나 구간이 바뀌어도 체감 음량을 일정하게 유지합니다.",
  };

  // 아래 공간이 부족한(패널 하단 근처) 항목은 팝오버를 아이콘 위쪽에 띄운다.
  const INFO_ABOVE = new Set([
    "normalizer",
    "normalizer-target",
    "group-normalizer",
    "comp",
    "limiter",
    "comp-release",
    "limiter-threshold",
  ]);

  function infoIcon(key) {
    return `<button type="button" class="cheese-mixer-info" data-info="${key}" aria-label="설명 보기" tabindex="0">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"></circle>
        <path d="M12 11v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
        <circle cx="12" cy="7.5" r="1.2" fill="currentColor"></circle>
      </svg>
    </button>`;
  }

  // 스트리머별 프리셋 정의. 값 단위:
  // - gain: 배율(1 = 원음), eq: 밴드별 dB, comp: WebAudio DynamicsCompressor 파라미터
  // - targetLevel: 노멀라이저 목표 RMS, limiter: 리미터 threshold(dB)
  const PRESETS = {
    default: {
      // 기본: 적당한 컴프로 큰 소리를 억제하고 makeup 으로 체감 음량을 키운다. 예전
      // 기본(threshold -50 / ratio 12 / makeup 12dB)은 조용한 소리까지 과증폭돼 찢어졌고,
      // 그 반동으로 너무 약하게(makeup 2dB) 낮췄더니 믹서 on/off 차이가 거의 없었다.
      // 큰 소리만 적당히 압축(threshold -24, ratio 4)해 다이내믹을 살리고, 음량은
      // makeup 8dB(≈2.5배)로 키운다(음량 키우기는 threshold/ratio 가 아니라 makeup 담당).
      // 리미터로 클리핑(찢어짐)을 막는다.
      label: "기본",
      gain: 1,
      eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      normalizer: false,
      targetLevel: 0.12,
      comp: {
        enabled: true,
        threshold: -24,
        knee: 24,
        ratio: 4,
        attack: 0.003,
        release: 0.25,
        makeup: 8,
      },
      limiter: -1,
    },
    voice: {
      // 저챗·라디오: 말소리는 앞으로 두되, 배경음악이 너무 얇아지지 않게
      // 중고역을 완만하게 강조하고 노멀라이저로 방송별 음량 차이를 줄인다.
      label: "저챗·라디오",
      gain: 1,
      eq: [-2, -1.5, -0.5, 1.5, 2, 2.5, 2, 1, 0, -1],
      normalizer: true,
      targetLevel: 0.1,
      comp: {
        enabled: true,
        threshold: -22,
        knee: 30,
        ratio: 3,
        attack: 0.005,
        release: 0.2,
        makeup: 1.5,
      },
      limiter: -1,
    },
    game: {
      // 효과음/총성 다이내믹 압축 + 채팅·게임 음량차 평준화(노멀라이저).
      label: "게임 방송",
      gain: 1,
      eq: [2, 1.6, 1, 0, 1, 2, 2, 1.6, 1, 0.5],
      normalizer: true,
      targetLevel: 0.11,
      comp: {
        enabled: true,
        threshold: -22,
        knee: 24,
        ratio: 6,
        attack: 0.003,
        release: 0.18,
        makeup: 4,
      },
      limiter: -1,
    },
    outdoor: {
      // 야외방송: 바람·잡음 환경 → 저역 컷(웅웅거림/바람소리), 음성 명료도 부스트,
      // 컴프로 음량 안정 + 노멀라이저 강하게.
      label: "야외방송",
      gain: 1.1,
      eq: [-4, -3, -1.5, 1, 3, 2.5, 1.5, 0.5, -0.5, -1],
      normalizer: true,
      targetLevel: 0.13,
      comp: {
        enabled: true,
        threshold: -28,
        knee: 28,
        ratio: 6,
        attack: 0.004,
        release: 0.22,
        makeup: 5,
      },
      limiter: -1,
    },
    music: {
      // 음악 다이내믹은 보존(컴프 약하게), 곡 간 음량차는 노멀라이저로 평준화.
      label: "노래 방송",
      gain: 1,
      eq: [3, 2.4, 1.5, -0.5, 0, 1, 2, 3, 2.4, 1.5],
      normalizer: true,
      targetLevel: 0.09,
      comp: {
        enabled: false,
        threshold: -18,
        knee: 20,
        ratio: 3,
        attack: 0.01,
        release: 0.25,
        makeup: 0,
      },
      limiter: -0.8,
    },
    classical: {
      // 클래식·재즈: 자연스러운 음색과 다이내믹 보존(컴프 약하게), 저역 따뜻함과
      // 고역 공기감만 살짝. 악장·곡 간 음량차는 노멀라이저로 완화.
      label: "클래식·재즈",
      gain: 1,
      eq: [1.5, 1, 0.5, 0, 0, 0.5, 1, 2, 1.5, 1],
      normalizer: true,
      targetLevel: 0.08,
      comp: {
        enabled: false,
        threshold: -18,
        knee: 24,
        ratio: 2,
        attack: 0.02,
        release: 0.4,
        makeup: 0,
      },
      limiter: -1.5,
    },
    movie: {
      // 대사 명료도 위해 중역 보강 + 컴프, 조용한 대사/큰 효과음 차이 완화(노멀라이저).
      label: "영화·드라마",
      gain: 1.1,
      eq: [3, 2, 1, 1.5, 2, 1.5, 1, 1.6, 1, 0.5],
      normalizer: true,
      targetLevel: 0.12,
      comp: {
        enabled: true,
        threshold: -28,
        knee: 30,
        ratio: 6,
        attack: 0.004,
        release: 0.3,
        makeup: 4,
      },
      limiter: -1,
    },
    anime: {
      // 애니: 대사·효과음·BGM 균형. 중역 명료도 보강 + 가벼운 컴프, 노멀라이저로
      // 장면 전환 음량차 완화.
      label: "애니",
      gain: 1.05,
      eq: [1, 0.5, 0, 1, 2, 1.5, 1, 1.5, 1.5, 1],
      normalizer: true,
      targetLevel: 0.11,
      comp: {
        enabled: true,
        threshold: -26,
        knee: 28,
        ratio: 4,
        attack: 0.005,
        release: 0.25,
        makeup: 3,
      },
      limiter: -1,
    },
    sports: {
      // 스포츠: 중계 음성 명료도 + 함성·효과음 다이내믹 압축. 노멀라이저로 평준화.
      label: "스포츠",
      gain: 1,
      eq: [0.5, 0, 0, 1.5, 2.5, 2, 1.5, 1, 0.5, 0],
      normalizer: true,
      targetLevel: 0.12,
      comp: {
        enabled: true,
        threshold: -24,
        knee: 26,
        ratio: 6,
        attack: 0.003,
        release: 0.2,
        makeup: 4,
      },
      limiter: -1,
    },
    asmr: {
      // 작은 소리 증폭(노멀라이저 + 컴프), 고역 디테일 부스트.
      label: "ASMR",
      gain: 1.3,
      eq: [-3, -2.4, -1, 1, 2, 3, 4, 4.8, 4, 3],
      normalizer: true,
      targetLevel: 0.07,
      comp: {
        enabled: true,
        threshold: -36,
        knee: 36,
        ratio: 8,
        attack: 0.006,
        release: 0.25,
        makeup: 6,
      },
      limiter: -1.5,
    },
  };

  const DEFAULT_STATE = () => ({
    enabled: false,
    // 사용자가 이 채널에서 믹서를 직접 끔 → '항상 켜기' 자동 활성화 제외(opt-out).
    userDisabled: false,
    // 사용자가 이 채널에서 프리셋을 직접 골랐는지. '직접 선택 우선' 모드에서
    // true인 채널은 전역 기본값 대신 채널 저장값을 쓴다.
    userPickedPreset: false,
    preset: "default",
    gain: 1,
    eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    comp: { ...PRESETS.default.comp },
    limiter: { enabled: true, threshold: -1 },
    normalizer: { enabled: true, target: 0.12 },
    customPresets: [],
    // '기본' 프리셋을 대체하는 커스텀 프리셋 id(전역). 빈 문자열이면 PRESETS.default.
    defaultCustomId: "",
  });

  // ── 오디오 그래프 ────────────────────────────────────────────────────────
  const audio = {
    ctx: null,
    source: null,
    inputGain: null,
    analyser: null, // 노멀라이저용 RMS 측정 탭
    normGain: null, // 노멀라이저가 조정하는 자동 게인
    eqFilters: [],
    comp: null,
    limiter: null,
    outputGain: null,
    video: null,
    connected: false,
    normTimer: 0, // 노멀라이저 분석 루프(setInterval) id
  };
  const mediaSourceCache = new WeakMap();

  let state = DEFAULT_STATE();
  let currentPageKey = null; // 현재 페이지 raw 키(live:<id>|video:<no>)
  let currentMediaId = null; // 해석된 채널id(설정 저장/복원 키)
  let wideScreenAppliedForPage = null; // 넓은 화면 자동 적용을 끝낸 pageKey(미디어당 1회)
  let wideScreenRetryUntil = 0; // viewmode 버튼이 늦게 뜰 수 있어 잠깐 재시도하는 마감 시각
  // 현재 미디어의 저장 설정(프리셋 등) 로드 완료 여부. '항상 켜기' 자동 활성화는
  // 이게 true일 때만 시도해, 저장된 프리셋이 적용되기 전에 기본 프리셋으로 켜지는
  // 레이스를 막는다.
  let stateLoaded = false;
  let activeTab = "presets";
  let customDraft = null;
  // 커스텀 추가/편집 드래프트 진입 직전의 믹서 상태(취소 시 복원용).
  // { snapshot, preset, presetDirty, dirtyFromName, dirtyMode }
  let draftBackup = null;
  let customCreatorOpen = false;
  let customDialog = null;
  // 커스텀 프리셋 내보내기/불러오기 패널 상태.
  let customExportOpen = false; // 내보내기(선택→JSON 복사) UI 열림
  let customImportOpen = false; // 불러오기(JSON 붙여넣기→검증→추가) UI 열림
  let customExportSelected = new Set(); // 내보내기로 선택한 프리셋 id들
  let customImportText = ""; // 불러오기 textarea 내용(재렌더 간 유지)
  let customShareMsg = null; // { kind: "ok"|"error", text } 안내 메시지
  const PRESET_SHARE_TYPE = "cheese-audio-mixer-presets"; // 공유 JSON 식별자
  const PRESET_SHARE_VERSION = 1;
  // settings 플레이어 탭에서 지정하는 채널 무관 전역 기본 프리셋.
  let globalDefaultPreset = { enabled: false, preset: "default" };
  // 전역 기본값 재방문 동작: "global"=재진입 시 항상 전역값, "channel"=채널에서 직접
  // 고른 게 있으면 그걸(없으면 전역값). settings에서 선택(기본 global).
  let globalDefaultMode = "global";
  // 채널의 '원래 선택'(전역 기본값 적용 전) 스냅샷. 전역 기본값이 켜진 동안엔 이 값을
  // 채널 저장에 쓴다(전역값이 채널 저장을 덮어쓰지 않게). 전역 해제 시 이 값으로 복원.
  let channelBaseState = null;
  // 프리셋(내장/커스텀) 적용 후 값을 수정해 벗어난 상태인지. true면 head에
  // "프리셋 추가" 빠른 저장 버튼이 나타난다.
  let presetDirty = false;
  // dirty 진입 직전의 프리셋 이름(수정 전 기준). 버튼 툴팁에 "수정된 OOO"로 쓴다.
  // state.preset은 dirty 시 "custom"으로 덮여 원래 이름을 잃기 때문에 따로 보관한다.
  let dirtyFromName = "";
  // dirty 진입 직전의 프리셋 키(내장 키 또는 커스텀 id). head의 "초기화" 버튼이
  // 이 프리셋으로 되돌릴 때 쓴다.
  let dirtyFromKey = "";
  // 수정이 일어난 탭(advanced/expert). 빠른 저장 시 프리셋 mode로 쓴다.
  let dirtyMode = "advanced";
  // head의 인라인 이름 입력창 열림 여부.
  let quickSaveOpen = false;
  let graphRetryBlock = {
    video: null,
    pageKey: "",
    until: 0,
  };
  // 다른 확장이 같은 video로 MediaElementSource를 선점해 그래프 구성이 불가능한
  // 충돌 상태. true면 패널에 안내를 띄운다.
  let graphConflict = false;

  // 페이지 식별: 라이브(/live/<channelId>)·다시보기(/video/<videoNo>)에서 URL로
  // 즉시 얻는 raw 키. 채널id 해석(resolveChannelId)의 입력으로 쓴다.
  function getPageKey() {
    const live = location.pathname.match(/^\/live\/([0-9a-f]{32})/i);
    if (live) return `live:${live[1]}`;
    const vod = location.pathname.match(/^\/video\/(\d+)/);
    if (vod) return `video:${vod[1]}`;
    return null;
  }

  // 라이브/다시보기 페이지를 벗어나(팔로잉·전체 방송 등으로 이동) 플레이어가 PIP
  // (미니플레이어)로 떠 있는 상태인지. 이때 video는 계속 재생 중이라 오디오 믹서
  // 그래프를 teardown하면 안 된다(PIP에서 믹서가 꺼지던 원인).
  function isPipActive() {
    return !!document.querySelector(
      "[class*='_type_pip_'], .pzp-pc.pzp-pc--pip",
    );
  }

  // 설정은 채널id로 통일 저장한다(라이브·다시보기 공유). 다시보기 URL엔 채널id가
  // 없는데, 페이지 DOM엔 추천 채널 링크가 섞여 있어 DOM 추출은 신뢰할 수 없다.
  // 따라서 video API로 본 영상의 채널id를 확보한다(videoNo당 1회 캐시).
  const videoChannelCache = new Map();

  async function fetchChannelIdFromApi(videoNo) {
    try {
      const res = await fetch(
        `https://api.chzzk.naver.com/service/v2/videos/${videoNo}`,
        { credentials: "include", headers: { accept: "application/json" } },
      );
      if (!res.ok) return null;
      const json = await res.json();
      const id = json?.content?.channel?.channelId;
      return typeof id === "string" && /^[0-9a-f]{32}$/i.test(id) ? id : null;
    } catch {
      return null;
    }
  }

  // pageKey(live:<id> | video:<no>)를 실제 채널id로 해석한다. 라이브는 URL에서
  // 즉시, 다시보기는 video API로. 실패 시 null.
  async function resolveChannelId(pageKey) {
    if (!pageKey) return null;
    if (pageKey.startsWith("live:")) return pageKey.slice(5);
    if (pageKey.startsWith("video:")) {
      const videoNo = pageKey.slice(6);
      if (videoChannelCache.has(videoNo)) return videoChannelCache.get(videoNo);
      const fromApi = await fetchChannelIdFromApi(videoNo);
      if (fromApi) {
        videoChannelCache.set(videoNo, fromApi);
        // 무한 증가 방지: 상한 초과 시 가장 오래된 항목부터 제거(FIFO). videoNo→channelId
        // 는 불변 매핑이라 순서 기반 제거로 충분(긴 시청 세션의 캐시 누적 방지).
        while (videoChannelCache.size > 300) {
          const oldest = videoChannelCache.keys().next().value;
          if (oldest === undefined) break;
          videoChannelCache.delete(oldest);
        }
      }
      return fromApi;
    }
    return null;
  }

  function findPlayer() {
    return (
      document.querySelector(".pzp-pc") ||
      document.querySelector(".webplayer-internal-core") ||
      document
        .querySelector("video")
        ?.closest(".pzp-pc, .webplayer-internal-core, [class*='player']")
    );
  }

  function findVideo() {
    const player = findPlayer();
    return player?.querySelector("video") || document.querySelector("video");
  }

  // 그래프: source → inputGain → normGain → [EQ peaking ×10] → comp → outputGain(makeup) → limiter → destination
  //         analyser는 normGain 입력(inputGain 출력)에서 RMS를 측정해 normGain을 자동 조정한다.
  //         리미터는 makeup 뒤(최종단)에 둬 makeup·게인으로 키운 신호의 클리핑을 막는다.
  function buildGraph(video) {
    if (audio.connected && audio.video === video) return true;
    if (isGraphRetryBlocked(video)) return false;
    if (!canStartAudioContext()) return false;
    try {
      audio.ctx ||= new AudioContext();
      if (audio.ctx.state === "suspended") {
        audio.ctx.resume().catch(() => {});
      }

      teardownGraph();

      // createMediaElementSource는 video당 1회만 가능하다. SPA 이동 후 같은
      // video 엘리먼트가 재사용될 수 있으므로 WeakMap으로 source를 재사용한다.
      audio.source = getMediaElementSource(video);
      audio.video = video;

      audio.inputGain = audio.ctx.createGain();
      audio.normGain = audio.ctx.createGain();
      audio.analyser = audio.ctx.createAnalyser();
      audio.analyser.fftSize = 1024;
      audio.analyser.smoothingTimeConstant = 0.8;
      audio.eqFilters = EQ_BANDS.map((freq) => {
        const f = audio.ctx.createBiquadFilter();
        f.type = "peaking";
        f.frequency.value = freq;
        f.Q.value = 1.1;
        f.gain.value = 0;
        return f;
      });
      audio.comp = audio.ctx.createDynamicsCompressor();
      // 리미터도 DynamicsCompressor로 구현(높은 ratio + 빠른 attack)
      audio.limiter = audio.ctx.createDynamicsCompressor();
      audio.limiter.ratio.value = 20;
      audio.limiter.knee.value = 0;
      audio.limiter.attack.value = 0.001;
      audio.limiter.release.value = 0.1;
      audio.outputGain = audio.ctx.createGain();

      // 체인 연결
      let node = audio.source;
      node.disconnect();
      node.connect(audio.inputGain);
      audio.inputGain.connect(audio.normGain);
      audio.inputGain.connect(audio.analyser); // 측정 탭(소리 경로엔 영향 없음)
      node = audio.normGain;
      audio.eqFilters.forEach((f) => {
        node.connect(f);
        node = f;
      });
      node.connect(audio.comp);
      // 리미터를 makeup(outputGain) '뒤'에 둔다. makeup 으로 키운 최종 신호를 리미터가
      // 제한해야 클리핑(찢어짐)을 실제로 막는다. (이전엔 comp→limiter→outputGain 순이라
      // 리미터가 makeup 앞에 있어, makeup 배율이 리미터 뒤에서 곱해져 최종 출력이 리미터
      // threshold 를 넘어 찢어졌다 — 게인/​makeup 을 올릴수록 심해짐.)
      audio.comp.connect(audio.outputGain);
      audio.outputGain.connect(audio.limiter);
      audio.limiter.connect(audio.ctx.destination);

      audio.connected = true;
      applyState();
      startNormalizerLoop();
      clearGraphRetryBlock(video);
      return true;
    } catch (err) {
      console.warn("[치즈 서치 오디오 믹서] 그래프 구성 실패:", err);
      handleGraphBuildFailure(video, err);
      return false;
    }
  }

  function getMediaElementSource(video) {
    const cached = mediaSourceCache.get(video);
    if (cached) return cached;
    const source = audio.ctx.createMediaElementSource(video);
    mediaSourceCache.set(video, source);
    return source;
  }

  function canStartAudioContext() {
    if (audio.ctx && audio.ctx.state === "running") return true;
    return Boolean(navigator.userActivation?.isActive);
  }

  function isGraphRetryBlocked(video) {
    if (!video) return false;
    if (graphRetryBlock.video !== video) return false;
    if (graphRetryBlock.pageKey !== currentPageKey) return false;
    if (Date.now() < graphRetryBlock.until) return true;
    graphRetryBlock.video = null;
    graphRetryBlock.pageKey = "";
    graphRetryBlock.until = 0;
    return false;
  }

  function clearGraphRetryBlock(video = null) {
    if (video && graphRetryBlock.video !== video) return;
    graphRetryBlock.video = null;
    graphRetryBlock.pageKey = "";
    graphRetryBlock.until = 0;
  }

  function handleGraphBuildFailure(video, err) {
    stopNormalizerLoop();
    restoreSourceToDestination();
    audio.connected = false;
    audio.video = video || null;
    state.enabled = false;
    // 실패를 두 종류로 구분한다:
    //  1) 진짜 충돌(InvalidStateError): createMediaElementSource는 video당 1회만 가능.
    //     다른 확장이 이미 같은 video로 source를 만들었으면 우리는 절대 만들 수 없다
    //     → 영구 차단 + 충돌 안내(무한 재시도 방지).
    //  2) 일시적 실패(그 외): userActivation 창 놓침·video 미준비 등. 이땐 영구 차단하면
    //     재클릭해도 계속 실패("되다 안되다"의 원인)하므로, 짧게만 차단해 재시도를 허용한다.
    const isConflict =
      err &&
      (err.name === "InvalidStateError" ||
        // 일부 브라우저는 이름 대신 메시지로만 알린다.
        /already connected|InvalidStateError|createMediaElementSource/i.test(
          String(err && err.message),
        ));
    if (isConflict) {
      graphRetryBlock = {
        video,
        pageKey: currentPageKey || "",
        until: Number.POSITIVE_INFINITY,
      };
      graphConflict = true;
    } else {
      // 일시적 실패: 1.5초만 차단(연타 폭주 방지) 후 재시도 허용. 충돌 아님.
      graphRetryBlock = {
        video,
        pageKey: currentPageKey || "",
        until: Date.now() + 1500,
      };
      graphConflict = false;
    }
    saveState();
    if (ui?.panel) refreshPanelContent();
    else syncUI();
  }

  function teardownGraph() {
    if (!audio.connected) return;
    stopNormalizerLoop();
    restoreSourceToDestination();
    audio.connected = false;
  }

  function restoreSourceToDestination() {
    try {
      if (!audio.source || !audio.ctx) return;
      audio.source.disconnect();
      audio.source.connect(audio.ctx.destination); // 원음 복구
    } catch {}
  }

  // 노멀라이저: AnalyserNode로 입력 RMS를 측정해 목표 레벨에 맞도록 normGain을
  // 부드럽게(setTargetAtTime) 조정한다. 느린 스무딩으로 펌핑을 방지한다.
  const NORM_TARGET_RMS = 0.12; // 목표 RMS(대략 -18 dBFS 부근)
  const NORM_MAX_GAIN = 4; // 과증폭 방지 상한
  const NORM_MIN_GAIN = 0.25;
  const NORM_SMOOTH = 0.6; // setTargetAtTime 시간상수(초) — 클수록 더 천천히

  function startNormalizerLoop() {
    stopNormalizerLoop();
    // 노멀라이저가 꺼져 있으면 루프를 아예 돌리지 않는다(믹서만 켜도 노멀라이저 미사용
    // 프리셋에서 60fps rAF 가 헛돌며 메인스레드/영상 렌더와 경쟁하던 부하 제거).
    // 노멀라이저를 켜면 applyState 가 이 함수를 다시 불러 루프를 시작한다.
    if (!audio.connected || !state.normalizer?.enabled) return;
    const buf = new Float32Array(audio.analyser.fftSize);
    // 백그라운드 탭에선 requestAnimationFrame 이 완전히 멈춰(계측: 최대 19초 정지) 노멀라이저
    // 게인이 '멈추기 직전 낮은 값'에 얼어붙어 소리가 절반으로 줄었다(탭 전환 시 소리 작아짐
    // 의 실제 원인). setInterval 은 백그라운드에서도 계속 돌아 게인이 얼지 않는다. 노멀라이저
    // 는 느린 스무딩이라 100ms 간격으로 충분하다.
    const NORM_INTERVAL_MS = 100;
    const step = () => {
      if (!audio.connected || !state.normalizer?.enabled) {
        stopNormalizerLoop(); // 내부에서 게인 1 복귀 + 타이머 정리
        return;
      }
      audio.analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      if (rms > 0.0008) {
        // 무음 구간은 건드리지 않음(노이즈 과증폭 방지)
        const target = state.normalizer.target ?? NORM_TARGET_RMS;
        let desired = target / rms;
        desired = Math.min(NORM_MAX_GAIN, Math.max(NORM_MIN_GAIN, desired));
        audio.normGain.gain.setTargetAtTime(
          desired,
          audio.ctx.currentTime,
          NORM_SMOOTH,
        );
      }
    };
    audio.normTimer = setInterval(step, NORM_INTERVAL_MS);
  }

  function stopNormalizerLoop() {
    if (audio.normTimer) {
      clearInterval(audio.normTimer);
      audio.normTimer = 0;
    }
    if (audio.normGain && audio.ctx) {
      try {
        audio.normGain.gain.setTargetAtTime(1, audio.ctx.currentTime, 0.1);
      } catch {}
    }
  }

  // 탭이 백그라운드로 가거나(다른 탭/최소화) 창이 포커스를 잃으면(alt+tab) 브라우저가
  // requestAnimationFrame 을 throttle/정지시켜 노멀라이저 루프가 멈춘다. 이때 normGain 은
  // '멈추기 직전 마지막 보정값'에 고정되는데, 그 값은 그 순간 소리에 맞는 올바른 보정이라
  // 그대로 두면 소리 크기가 유지된다. (계측 결과: 조용한 구간이면 normGain 이 최대 4배까지
  // 증폭 중이었고, 이를 억지로 1로 되돌리면 오히려 소리가 확 작아졌다 — '소리 작아짐'의
  // 실제 원인은 백그라운드에서 normGain 을 1로 리셋하던 로직 자체였다.) 따라서 백그라운드/
  // blur 시엔 normGain 을 건드리지 않는다. 복귀 시엔 ctx 가 suspend 됐으면 재개만 하고,
  // 루프는 rAF 가 자연히 재개돼 이어서 조정한다.
  function resumeAudioForForeground() {
    if (!audio.connected || !audio.ctx) return;
    if (audio.ctx.state !== "running") {
      audio.ctx.resume().catch(() => {});
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) resumeAudioForForeground();
  });
  window.addEventListener("focus", resumeAudioForForeground);

  function applyState() {
    if (!audio.connected) return;
    audio.inputGain.gain.value = state.gain;
    state.eq.forEach((db, i) => {
      if (audio.eqFilters[i]) audio.eqFilters[i].gain.value = db;
    });
    const c = state.comp;
    // 컴프레서 OFF면 사실상 무압축(threshold 0, ratio 1)
    audio.comp.threshold.value = c.enabled ? c.threshold : 0;
    audio.comp.knee.value = c.knee;
    audio.comp.ratio.value = c.enabled ? c.ratio : 1;
    audio.comp.attack.value = c.attack;
    audio.comp.release.value = c.release;
    // Makeup gain: 컴프로 줄어든 음량을 컴프 뒤(outputGain)에서 보정. dB→배율.
    // 컴프 OFF면 보정하지 않는다(1배).
    const makeupDb = c.enabled ? (c.makeup ?? 0) : 0;
    audio.outputGain.gain.value = Math.pow(10, makeupDb / 20);
    audio.limiter.threshold.value = state.limiter.enabled
      ? state.limiter.threshold
      : 0;
    audio.limiter.ratio.value = state.limiter.enabled ? 20 : 1;
    // 노멀라이저 on/off 에 맞춰 분석 루프를 시작/정지(꺼지면 rAF 부하 0).
    if (state.normalizer?.enabled) {
      if (!audio.normTimer) startNormalizerLoop();
    } else if (audio.normTimer) {
      stopNormalizerLoop();
    }
  }

  function setEnabled(enabled) {
    state.enabled = enabled;
    if (enabled) {
      graphConflict = false;
      clearGraphRetryBlock();
      const video = findVideo();
      if (!video) {
        state.enabled = false;
        syncUI();
        return;
      }
      // buildGraph 실패(충돌) 시 handleGraphBuildFailure가 enabled를 다시 false로
      // 되돌리고 graphConflict를 세운다.
      buildGraph(video);
    } else {
      teardownGraph();
    }
    saveState();
    syncUI();
  }

  function ensureEnabledGraph() {
    if (!state.enabled) return;
    const video = findVideo();
    if (!video) return;
    // 이미 연결돼 있어도, 화면의 video가 우리가 연결한 video와 '다르면' 재연결한다.
    // PIP(미니플레이어) 전환·플레이어 재렌더로 video 요소가 교체되면 audio.connected는
    // true인데 그래프는 옛 video에 붙어 있어 소리에 효과가 안 걸린다(클릭해야 재적용
    // 되던 원인). video가 바뀌었으면 teardown 후 새 video로 다시 잇는다.
    if (audio.connected) {
      if (audio.video === video) {
        // 같은 video인데 컨텍스트가 멈춰 있으면(PIP 전환 등) 재개 시도.
        if (audio.ctx && audio.ctx.state !== "running") {
          audio.ctx.resume().catch(() => {});
        }
        return;
      }
      teardownGraph(); // 옛 video 그래프 정리 → 아래에서 새로 연결
    }
    // buildGraph가 성공했을 때만 syncUI한다. 실패(사용자 활성화 없음/재시도 차단/충돌)
    // 시 syncUI가 DOM을 건드리면 전역 MutationObserver→tick→ensureEnabledGraph가
    // 다시 돌며 무한루프가 된다(audio.connected는 계속 false이므로 매번 재진입).
    if (buildGraph(video)) syncUI();
  }

  // 프리셋 선택/값 조정 시 믹서가 꺼져 있어도 자동으로 켠다(꺼진 상태에선 applyState가
  // audio.connected=false라 값이 실제로 반영되지 않으므로). buildGraph가 충돌 등으로
  // 실패하면 setEnabled가 enabled를 다시 false로 되돌린다.
  function ensureMixerEnabled() {
    if (state.enabled && audio.connected) return;
    setEnabled(true);
  }

  // '항상 켜기'가 켜져 있고 첫 사용자 제스처가 있었으면 믹서를 자동 활성화한다.
  // 충돌(graphConflict)/믹서 숨김(featureFlags.audioMixer)/이미 켜짐/video 미준비
  // 시엔 시도하지 않는다. 충돌이면 setEnabled→buildGraph 실패가 graphConflict를
  // 세워 재시도가 멈추므로 무한 루프가 되지 않는다.
  function maybeAutoEnableMixer() {
    if (!mixerAlwaysOn) return;
    if (!userGestureSeen) return; // 제스처 전엔 대기
    if (!stateLoaded) return; // 저장 프리셋 로드 전엔 대기(기본 프리셋 오활성 방지)
    if (state.userDisabled) return; // 이 채널은 사용자가 직접 끔(opt-out)
    if (featureFlags.audioMixer) return; // 믹서 기능 숨김 상태면 자동 활성 안 함
    if (graphConflict) return; // 이미 충돌 판정 → 재시도 금지
    if (state.enabled && audio.connected) return; // 이미 동작 중
    if (!isElementRendered(findVideo())) return; // video 준비 전이면 다음 기회
    setEnabled(true);
  }

  function applyPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    // '기본' 칩이 커스텀으로 대체돼 있으면(defaultCustomId), 그 커스텀 스냅샷을 적용한다.
    // preset 키는 "default"로 두어 칩 활성/라벨이 '기본'에 머물게 한다.
    if (key === "default") {
      const custom = effectiveDefaultCustom();
      if (custom) {
        ensureMixerEnabled();
        state.preset = "default";
        const snapshot = cloneMixerSnapshot(custom.snapshot);
        state.gain = snapshot.gain;
        state.eq = snapshot.eq;
        state.comp = snapshot.comp;
        state.limiter = snapshot.limiter;
        state.normalizer = snapshot.normalizer;
        clearPresetDirty();
        state.userPickedPreset = true; // 사용자가 직접 고름
        channelBaseState = snapshotChannelPreset(); // 사용자 선택 → 채널 원본 갱신
        applyState();
        saveState();
        syncUI();
        return;
      }
    }
    ensureMixerEnabled();
    state.preset = key;
    // builtInPresetSnapshot과 같은 정규화로 적용해 '동일여부 비교'와 어긋나지 않게 한다.
    const snapshot = builtInPresetSnapshot(p);
    state.gain = snapshot.gain;
    state.eq = snapshot.eq;
    state.comp = snapshot.comp;
    state.normalizer = snapshot.normalizer;
    state.limiter = snapshot.limiter;
    clearPresetDirty();
    // 사용자가 직접 프리셋을 골랐으므로 채널의 '원래 선택'을 이 값으로 갱신하고
    // userPickedPreset을 세운다(전역 기본값이 켜져 있어도, 이 선택이 채널 저장·전역
    // 해제 시 복원값이 되고, '직접 선택 우선' 모드에선 재진입 시 이 값이 적용되게).
    state.userPickedPreset = true;
    channelBaseState = snapshotChannelPreset();
    applyState();
    saveState();
    syncUI();
  }

  // '기본' 칩을 대체하는 커스텀 프리셋 객체(유효할 때만). 없으면 null → PRESETS.default.
  function effectiveDefaultCustom() {
    const id = String(state.defaultCustomId || "");
    if (!id) return null;
    return (
      normalizeCustomPresets(state.customPresets).find((p) => p.id === id) ||
      null
    );
  }

  // '기본' 프리셋 칩에 표시할 라벨. 커스텀으로 대체됐으면 "기본 (이름)".
  function defaultPresetLabel() {
    const custom = effectiveDefaultCustom();
    return custom
      ? `${PRESETS.default.label} (${custom.name})`
      : PRESETS.default.label;
  }

  function normalizeGlobalDefaultPreset(value) {
    const config = value && typeof value === "object" ? value : {};
    return {
      enabled: config.enabled === true,
      preset: String(config.preset || "default"),
    };
  }

  function customPresetById(id) {
    return (
      normalizeCustomPresets(state.customPresets).find((p) => p.id === id) ||
      null
    );
  }

  function snapshotForPresetKey(key) {
    if (!key || key === "custom") return null;
    if (PRESETS[key]) {
      if (key === "default") {
        const custom = effectiveDefaultCustom();
        if (custom) return cloneMixerSnapshot(custom.snapshot);
      }
      return builtInPresetSnapshot(PRESETS[key]);
    }
    const custom = customPresetById(key);
    return custom ? cloneMixerSnapshot(custom.snapshot) : null;
  }

  function applySnapshotToState(key, snapshot) {
    if (!snapshot) return false;
    state.preset = key;
    state.gain = snapshot.gain;
    state.eq = [...snapshot.eq];
    state.comp = { ...snapshot.comp };
    state.limiter = { ...snapshot.limiter };
    state.normalizer = { ...snapshot.normalizer };
    clearPresetDirty();
    return true;
  }

  function applyGlobalDefaultPreset() {
    if (mixerBeginner) return false; // 초보자 모드는 기본 프리셋 고정 → 전역 기본값 무시
    if (!globalDefaultPreset.enabled) return false;
    const key = globalDefaultPreset.preset || "default";
    const snapshot = snapshotForPresetKey(key);
    if (!snapshot) return false;
    return applySnapshotToState(key, snapshot);
  }

  // 기본값 등록/해제.
  function setDefaultCustomPreset(id) {
    const exists = normalizeCustomPresets(state.customPresets).some(
      (p) => p.id === id,
    );
    if (!exists) return;
    state.defaultCustomId = id;
    saveState({ forcePresets: true });
    refreshPanelContent();
  }

  function unsetDefaultCustomPreset() {
    if (!state.defaultCustomId) return;
    state.defaultCustomId = "";
    saveState({ forcePresets: true });
    refreshPanelContent();
  }

  // head의 "초기화": 값 조정 전에 적용돼 있던 프리셋 값으로 되돌린다.
  // dirtyFromKey가 내장 키면 applyPreset, 커스텀 id면 applyCustomPreset이
  // 스냅샷을 다시 적용하고 dirty를 해제한다.
  function resetToBasePreset() {
    if (!presetDirty || !dirtyFromKey) return;
    const key = dirtyFromKey;
    if (PRESETS[key]) {
      applyPreset(key);
    } else if (isRealPreset(key)) {
      applyCustomPreset(key);
    } else {
      return; // 원본 프리셋이 사라짐(삭제 등) → 아무 것도 하지 않음
    }
    // 현재 보고 있는 탭(고급/전문가)을 유지해 되돌려진 값이 슬라이더에 바로 보이게 한다.
    refreshPanelContent();
  }

  function readFiniteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function normalizePresetLimiter(limiter, fallback) {
    if (limiter === false) {
      return { ...fallback, enabled: false };
    }
    if (typeof limiter === "number") {
      return {
        ...fallback,
        enabled: true,
        threshold: readFiniteNumber(limiter, fallback.threshold),
      };
    }
    if (limiter && typeof limiter === "object") {
      return {
        ...fallback,
        enabled:
          typeof limiter.enabled === "boolean"
            ? limiter.enabled
            : fallback.enabled,
        threshold: readFiniteNumber(limiter.threshold, fallback.threshold),
      };
    }
    return { ...fallback };
  }

  // state.preset이 실제 프리셋(내장 키 또는 커스텀 id)인지. "custom"/빈 값은
  // '아무 프리셋도 아님'을 뜻한다.
  function isRealPreset(key) {
    if (!key || key === "custom") return false;
    if (PRESETS[key]) return true;
    return normalizeCustomPresets(state.customPresets).some(
      (preset) => preset.id === key,
    );
  }

  // 프리셋 키(내장 라벨 또는 커스텀 id) → 표시 이름. 없으면 빈 문자열.
  function presetDisplayName(key) {
    if (!key || key === "custom") return "";
    if (PRESETS[key]) return PRESETS[key].label;
    const custom = normalizeCustomPresets(state.customPresets).find(
      (preset) => preset.id === key,
    );
    return custom ? custom.name : "";
  }

  // 슬라이더/EQ/토글 수정으로 프리셋에서 벗어날 때 호출. 직전이 실제 프리셋이면
  // dirty로 표시해 head에 "프리셋 추가" 버튼을 띄운다.
  function enterCustomFromEdit() {
    // 꺼진 상태에서 값을 조정하면 자동으로 켠다(꺼져 있으면 applyState가
    // audio.connected=false라 조정값이 실제로 반영되지 않으므로).
    ensureMixerEnabled();
    if (isRealPreset(state.preset)) {
      presetDirty = true;
      // 수정 전 프리셋 키/이름을 보관(state.preset이 곧 "custom"으로 덮인다).
      // 단, 이미 dirty라면 첫 수정 때 잡아둔 원본을 유지한다(state.preset은 이미
      // "custom"이라 여기 들어오지 않지만, 방어적으로).
      dirtyFromKey = state.preset;
      dirtyFromName = presetDisplayName(state.preset);
    }
    // 저장 mode 판정: 전문가 탭에서 수정한 적이 한 번이라도 있으면 expert로
    // 승격(sticky)하고, 그 외(고급에서만 수정)는 advanced로 둔다. dirtyMode는
    // 프리셋 적용/clear 시 advanced로 리셋된다.
    if (activeTab === "expert") dirtyMode = "expert";
    state.preset = "custom";
  }

  function clearPresetDirty() {
    presetDirty = false;
    dirtyFromName = "";
    dirtyFromKey = "";
    quickSaveOpen = false;
    dirtyMode = "advanced";
  }

  function createMixerSnapshot() {
    return {
      gain: state.gain,
      eq: [...state.eq],
      comp: { ...state.comp },
      limiter: { ...state.limiter },
      normalizer: { ...state.normalizer },
    };
  }

  // 내장 프리셋 정의(p) → 정규화된 믹서 스냅샷. applyPreset과 동일한 변환을 써서
  // '되돌리기/동일여부 비교'가 실제 적용값과 정확히 일치하게 한다.
  function builtInPresetSnapshot(p) {
    const defaultState = DEFAULT_STATE();
    return cloneMixerSnapshot({
      gain: p.gain,
      eq: [...p.eq],
      comp: { ...p.comp },
      limiter: normalizePresetLimiter(p.limiter, defaultState.limiter),
      normalizer: {
        ...defaultState.normalizer,
        enabled: Boolean(p.normalizer),
        target: readFiniteNumber(p.targetLevel, defaultState.normalizer.target),
      },
    });
  }

  // dirtyFromKey가 가리키는 '값 조정 전 프리셋'의 스냅샷. 없으면 null.
  function baseSnapshotForDirty() {
    if (!dirtyFromKey) return null;
    if (PRESETS[dirtyFromKey])
      return builtInPresetSnapshot(PRESETS[dirtyFromKey]);
    const custom = normalizeCustomPresets(state.customPresets).find(
      (preset) => preset.id === dirtyFromKey,
    );
    return custom ? cloneMixerSnapshot(custom.snapshot) : null;
  }

  // 두 스냅샷이 (부동소수 오차 허용) 같은지. EQ 배열 + 중첩 객체까지 비교.
  function snapshotsEqual(a, b) {
    if (!a || !b) return false;
    const EPS = 1e-4;
    const numEq = (x, y) => Math.abs((x ?? 0) - (y ?? 0)) <= EPS;
    if (!numEq(a.gain, b.gain)) return false;
    if (!Array.isArray(a.eq) || !Array.isArray(b.eq)) return false;
    if (a.eq.length !== b.eq.length) return false;
    for (let i = 0; i < a.eq.length; i++) {
      if (!numEq(a.eq[i], b.eq[i])) return false;
    }
    const objEq = (oa, ob) => {
      const keys = new Set([
        ...Object.keys(oa || {}),
        ...Object.keys(ob || {}),
      ]);
      for (const k of keys) {
        const va = oa?.[k];
        const vb = ob?.[k];
        if (typeof va === "boolean" || typeof vb === "boolean") {
          if (Boolean(va) !== Boolean(vb)) return false;
        } else if (!numEq(va, vb)) {
          return false;
        }
      }
      return true;
    };
    return (
      objEq(a.comp, b.comp) &&
      objEq(a.limiter, b.limiter) &&
      objEq(a.normalizer, b.normalizer)
    );
  }

  // 수정 후 호출: 현재 값이 '값 조정 전 프리셋'과 같아졌으면 dirty를 해제하고
  // state.preset을 그 프리셋으로 되돌린다(추가/초기화 버튼이 사라진다). 같지 않으면
  // 그대로 두고 false. 같아져서 정리했으면 true를 반환한다.
  function reconcileDirtyAgainstBase() {
    if (!presetDirty || !dirtyFromKey) return false;
    const base = baseSnapshotForDirty();
    if (!base || !snapshotsEqual(createMixerSnapshot(), base)) return false;
    state.preset = dirtyFromKey;
    clearPresetDirty();
    return true;
  }

  function cloneMixerSnapshot(snapshot) {
    return {
      gain: Number.isFinite(snapshot?.gain) ? snapshot.gain : 1,
      eq: Array.isArray(snapshot?.eq)
        ? [...DEFAULT_STATE().eq].map((value, index) =>
            Number.isFinite(snapshot.eq[index]) ? snapshot.eq[index] : value,
          )
        : [...DEFAULT_STATE().eq],
      comp: { ...DEFAULT_STATE().comp, ...(snapshot?.comp || {}) },
      limiter: { ...DEFAULT_STATE().limiter, ...(snapshot?.limiter || {}) },
      normalizer: {
        ...DEFAULT_STATE().normalizer,
        ...(snapshot?.normalizer || {}),
      },
    };
  }

  function normalizeCustomPresets(value) {
    if (Array.isArray(value)) {
      return value.map(normalizeCustomPreset).filter(Boolean);
    }

    // 1.0.5 개발 중 잠깐 사용했던 advanced/expert 단일 슬롯 구조 마이그레이션.
    if (value && typeof value === "object") {
      return ["advanced", "expert"]
        .filter((mode) => value[mode])
        .map((mode) =>
          normalizeCustomPreset({
            id: createPresetId(),
            name: mode === "advanced" ? "고급 커스텀" : "전문가 커스텀",
            mode,
            snapshot: value[mode],
          }),
        )
        .filter(Boolean);
    }
    return [];
  }

  function normalizeCustomPreset(preset) {
    if (!preset || typeof preset !== "object") return null;
    const mode = preset.mode === "expert" ? "expert" : "advanced";
    const name = normalizePresetName(preset.name);
    if (!name) return null;
    return {
      id: String(preset.id || createPresetId()),
      name,
      mode,
      snapshot: cloneMixerSnapshot(preset.snapshot || preset),
    };
  }

  function createPresetId() {
    return `custom-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  }

  function normalizePresetName(value) {
    return String(value || "")
      .trim()
      .slice(0, CUSTOM_PRESET_NAME_MAX_LENGTH);
  }

  // 드래프트 진입 전 상태를 저장해 두었다가 취소 시 그대로 되돌린다.
  function captureDraftBackup() {
    draftBackup = {
      snapshot: createMixerSnapshot(),
      preset: state.preset,
      presetDirty,
      dirtyFromName,
      dirtyFromKey,
      dirtyMode,
    };
  }

  // 드래프트 백업을 state에 복원하고 그래프/표시에 반영한다.
  function restoreDraftBackup() {
    if (!draftBackup) return;
    const { snapshot, preset } = draftBackup;
    state.gain = snapshot.gain;
    state.eq = [...snapshot.eq];
    state.comp = { ...snapshot.comp };
    state.limiter = { ...snapshot.limiter };
    state.normalizer = { ...snapshot.normalizer };
    state.preset = preset;
    presetDirty = draftBackup.presetDirty;
    dirtyFromName = draftBackup.dirtyFromName;
    dirtyFromKey = draftBackup.dirtyFromKey;
    dirtyMode = draftBackup.dirtyMode;
    draftBackup = null;
    applyState();
  }

  function beginCustomPreset(mode, preset = null) {
    captureDraftBackup();
    const name = normalizePresetName(preset?.name);
    customDraft = {
      id: preset?.id || createPresetId(),
      name,
      mode: mode === "expert" ? "expert" : "advanced",
      editing: Boolean(preset),
    };
    if (preset) applyCustomPreset(preset.id, { keepDraft: true });
    activeTab = customDraft.mode;
    refreshPanelContent();
  }

  function saveCustomDraft() {
    if (!customDraft) return;
    const name = normalizePresetName(customDraft.name);
    if (!name) return;
    const nextPreset = {
      id: customDraft.id || createPresetId(),
      name,
      mode: customDraft.mode === "expert" ? "expert" : "advanced",
      snapshot: createMixerSnapshot(),
    };
    const presets = normalizeCustomPresets(state.customPresets);
    const index = presets.findIndex((preset) => preset.id === nextPreset.id);
    if (index >= 0) presets[index] = nextPreset;
    else presets.push(nextPreset);
    state.customPresets = presets;
    state.preset = nextPreset.id;
    customDraft = null;
    draftBackup = null; // 저장됐으니 복원 불필요
    saveState({ forcePresets: true });
    activeTab = "custom";
    refreshPanelContent();
  }

  function cancelCustomDraft() {
    customDraft = null;
    // 드래프트 중 바뀐 값을 버리고 진입 전 프리셋/설정으로 되돌린다.
    restoreDraftBackup();
    activeTab = "custom";
    refreshPanelContent();
  }

  function openQuickSaveModal() {
    quickSaveOpen = true;
    refreshPanelContent();
    ui?.panel?.querySelector("[data-quicksave-name]")?.focus();
  }

  function closeQuickSaveModal() {
    quickSaveOpen = false;
    refreshPanelContent();
  }

  // "프리셋 추가" 빠른 저장: 현재 설정을 그대로 커스텀 프리셋으로 등록한다.
  function confirmQuickSave(panel) {
    const input = panel.querySelector("[data-quicksave-name]");
    const name = normalizePresetName(input?.value);
    if (!name) {
      input?.focus();
      return;
    }
    const nextPreset = {
      id: createPresetId(),
      name,
      mode: dirtyMode === "expert" ? "expert" : "advanced",
      snapshot: createMixerSnapshot(),
    };
    const presets = normalizeCustomPresets(state.customPresets);
    presets.push(nextPreset);
    state.customPresets = presets;
    state.preset = nextPreset.id;
    quickSaveOpen = false;
    presetDirty = false;
    dirtyFromName = "";
    dirtyFromKey = "";
    saveState({ forcePresets: true });
    // 저장된 프리셋이 적용된 상태로 표시 갱신(탭은 그대로 유지).
    refreshPanelContent();
  }

  function applyCustomPreset(id, options = {}) {
    const saved = normalizeCustomPresets(state.customPresets).find(
      (preset) => preset.id === id,
    );
    if (!saved) return;
    // 편집 미리보기(keepDraft)가 아닌 실제 선택일 때만 자동으로 켠다.
    if (!options.keepDraft) ensureMixerEnabled();
    const snapshot = cloneMixerSnapshot(saved.snapshot);
    state.gain = snapshot.gain;
    state.eq = snapshot.eq;
    state.comp = snapshot.comp;
    state.limiter = snapshot.limiter;
    state.normalizer = snapshot.normalizer;
    state.preset = saved.id;
    clearPresetDirty();
    applyState();
    if (!options.keepDraft) saveState();
    syncUI();
  }

  function deleteCustomPreset(id) {
    state.customPresets = normalizeCustomPresets(state.customPresets).filter(
      (preset) => preset.id !== id,
    );
    const wasActive = state.preset === id;
    // 기본값으로 등록돼 있던 커스텀이 삭제되면 원래 기본(PRESETS.default)으로 복귀.
    const wasDefault = state.defaultCustomId === id;
    if (wasDefault) state.defaultCustomId = "";
    if (customDraft?.id === id) {
      customDraft = null;
      draftBackup = null; // 편집 중이던 프리셋이 삭제됨 → 복원 대상 무효
    }
    if (wasActive) {
      // 적용 중이던 커스텀이 삭제됨 → '아무 프리셋도 아닌' 상태로 두면 값 조정 시
      // 추가/초기화 버튼이 안 뜬다. 기본 프리셋으로 되돌려 다시 dirty 추적이 되게 한다.
      applyPreset("default");
    }
    // 삭제는 항상 customPresets 를 저장(applyPreset 의 저장은 forcePresets 가 아니므로).
    saveState({ forcePresets: true });
    refreshPanelContent();
  }

  function openCustomPresetCreator() {
    customCreatorOpen = true;
    refreshPanelContent();
  }

  function closeCustomPresetCreator() {
    customCreatorOpen = false;
    refreshPanelContent();
  }

  function openCustomDialog(type, id) {
    customCreatorOpen = false;
    customDialog = { type, id };
    refreshPanelContent();
  }

  function closeCustomDialog() {
    customDialog = null;
    refreshPanelContent();
  }

  // ── 커스텀 프리셋 내보내기/불러오기 ─────────────────────────────────────
  function openCustomExport() {
    customImportOpen = false;
    customCreatorOpen = false;
    customDialog = null;
    customShareMsg = null;
    // 기본으로 전부 선택해 둔다(공유 흐름에서 흔한 케이스).
    customExportSelected = new Set(
      normalizeCustomPresets(state.customPresets).map((p) => p.id),
    );
    customExportOpen = true;
    refreshPanelContent();
  }

  function openCustomImport() {
    customExportOpen = false;
    customCreatorOpen = false;
    customDialog = null;
    customShareMsg = null;
    customImportText = "";
    customImportOpen = true;
    refreshPanelContent();
  }

  function closeCustomShare() {
    customExportOpen = false;
    customImportOpen = false;
    customShareMsg = null;
    refreshPanelContent();
  }

  function toggleExportPick(id, picked) {
    if (picked) customExportSelected.add(id);
    else customExportSelected.delete(id);
    // 안내 메시지는 선택이 바뀌면 지운다(복사 카운트만 갱신).
    customShareMsg = null;
    refreshPanelContent();
  }

  function toggleExportSelectAll() {
    const presets = normalizeCustomPresets(state.customPresets);
    if (customExportSelected.size === presets.length) {
      customExportSelected = new Set();
    } else {
      customExportSelected = new Set(presets.map((p) => p.id));
    }
    customShareMsg = null;
    refreshPanelContent();
  }

  // 선택한 프리셋을 공유용 JSON으로 직렬화. id는 빼고(불러올 때 새로 발급) name/mode/
  // snapshot만 담는다.
  function buildExportJson() {
    const selected = normalizeCustomPresets(state.customPresets).filter((p) =>
      customExportSelected.has(p.id),
    );
    return JSON.stringify(
      {
        type: PRESET_SHARE_TYPE,
        version: PRESET_SHARE_VERSION,
        presets: selected.map((p) => ({
          name: p.name,
          mode: p.mode,
          snapshot: p.snapshot,
        })),
      },
      null,
      2,
    );
  }

  async function copyExportJson() {
    if (!customExportSelected.size) return;
    try {
      await copyShareText(buildExportJson());
      customShareMsg = {
        kind: "ok",
        text: `${customExportSelected.size}개 프리셋을 복사했어요. 공유할 곳에 붙여넣으세요.`,
      };
    } catch {
      customShareMsg = {
        kind: "error",
        text: "복사에 실패했어요. 다시 시도해 주세요.",
      };
    }
    refreshPanelContent();
  }

  // 클립보드 복사(콘텐츠 스크립트 패턴과 동일: clipboard API → textarea+execCommand 폴백).
  async function copyShareText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("copy failed");
  }

  // 붙여넣은 JSON을 검증해 유효한 프리셋만 커스텀에 추가한다.
  function confirmCustomImport(panel) {
    const raw = (
      panel.querySelector("[data-import-text]")?.value ?? customImportText
    ).trim();
    customImportText = raw;
    if (!raw) {
      customShareMsg = { kind: "error", text: "붙여넣은 JSON이 비어 있어요." };
      refreshPanelContent();
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      customShareMsg = { kind: "error", text: "JSON 형식이 올바르지 않아요." };
      refreshPanelContent();
      return;
    }
    // 공유 봉투({type,version,presets}) 또는 프리셋 배열, 단일 프리셋 객체 모두 허용.
    let rawPresets;
    if (Array.isArray(parsed)) {
      rawPresets = parsed;
    } else if (parsed && Array.isArray(parsed.presets)) {
      if (parsed.type && parsed.type !== PRESET_SHARE_TYPE) {
        customShareMsg = {
          kind: "error",
          text: "오디오 믹서 프리셋 형식이 아니에요.",
        };
        refreshPanelContent();
        return;
      }
      rawPresets = parsed.presets;
    } else if (parsed && typeof parsed === "object") {
      rawPresets = [parsed];
    } else {
      customShareMsg = { kind: "error", text: "프리셋을 찾을 수 없어요." };
      refreshPanelContent();
      return;
    }
    // normalizeCustomPreset이 검증·정규화·클램프까지 한다(유효치 않으면 null). id는
    // 충돌 방지를 위해 항상 새로 발급한다.
    const valid = rawPresets
      .map((p) =>
        normalizeCustomPreset(
          p && typeof p === "object" ? { ...p, id: createPresetId() } : p,
        ),
      )
      .filter(Boolean);
    if (!valid.length) {
      customShareMsg = {
        kind: "error",
        text: "유효한 프리셋이 없어요. JSON을 다시 확인해 주세요.",
      };
      refreshPanelContent();
      return;
    }
    const existing = normalizeCustomPresets(state.customPresets);
    state.customPresets = [...existing, ...valid];
    saveState({ forcePresets: true }); // 커스텀 가져오기 → 반드시 저장
    customImportOpen = false;
    customImportText = "";
    customShareMsg = {
      kind: "ok",
      text: `${valid.length}개 프리셋을 추가했어요.`,
    };
    refreshPanelContent();
  }

  function confirmCustomPresetEdit(panel, id) {
    const preset = normalizeCustomPresets(state.customPresets).find(
      (item) => item.id === id,
    );
    if (!preset) return;
    const name = normalizePresetName(
      panel.querySelector("[data-custom-edit-name]")?.value,
    );
    if (!name) return;
    customDialog = null;
    beginCustomPreset(preset.mode, { ...preset, name });
  }

  function startCustomPresetFromForm(panel) {
    const name = panel.querySelector("[data-custom-new-name]")?.value || "";
    const mode =
      panel.querySelector(".cheese-mixer-mode-option.is-active")?.dataset
        .customNewMode || "advanced";
    const trimmedName = normalizePresetName(name);
    if (!trimmedName) return;
    customDraft = {
      id: createPresetId(),
      name: trimmedName,
      mode: mode === "expert" ? "expert" : "advanced",
      editing: false,
    };
    customCreatorOpen = false;
    activeTab = customDraft.mode;
    refreshPanelContent();
  }

  // ── 설정 저장/복원 (content script에 위임) ───────────────────────────────
  // 채널id 확보 전에 사용자가 설정을 바꿨는지. true면 뒤늦게 도착한 저장 설정을
  // 로드해 현재 변경을 덮어쓰지 않는다.
  let pendingUserEdit = false;

  // forcePresets: 사용자가 커스텀 프리셋을 직접 추가/수정/삭제한 저장(반드시 customPresets
  // 를 함께 저장). 그 외 자동 저장은 로드 전이면 customPresets 를 생략(빈 배열로 전역
  // 프리셋 덮어쓰기 방지).
  function saveState(opts) {
    if (!currentMediaId) {
      // 채널id 확보 전 변경 — 확보되면 그때 저장한다.
      pendingUserEdit = true;
      return;
    }
    window.postMessage(
      {
        source: "cheese-audio-mixer",
        type: "save",
        channelId: currentMediaId,
        state: serializeState(opts),
      },
      location.origin,
    );
  }

  // 현재 state에서 '채널이 저장할 프리셋/값' 부분만 스냅샷.
  function snapshotChannelPreset() {
    return {
      preset: state.preset,
      gain: state.gain,
      eq: [...state.eq],
      comp: { ...state.comp },
      limiter: { ...state.limiter },
      normalizer: { ...state.normalizer },
    };
  }

  function serializeState(opts) {
    // 전역 기본값이 켜져 있으면 현재 state.preset/값은 '전역값'이므로, 채널 저장엔
    // 채널의 원래 선택(channelBaseState)을 쓴다(전역값이 채널 저장을 덮어쓰지 않게).
    // enabled/userDisabled/customPresets 등 나머지는 현재 state를 저장한다.
    const preset =
      globalDefaultPreset.enabled && channelBaseState
        ? channelBaseState
        : snapshotChannelPreset();
    const out = {
      enabled: state.enabled,
      userDisabled: state.userDisabled === true,
      userPickedPreset: state.userPickedPreset === true,
      preset: preset.preset,
      gain: preset.gain,
      eq: [...preset.eq],
      comp: { ...preset.comp },
      limiter: { ...preset.limiter },
      normalizer: { ...preset.normalizer },
    };
    // customPresets 저장 조건: 사용자가 직접 커스텀 변경(forcePresets)했거나 이미 로드
    // 완료(stateLoaded). 채널 전환 직후 로드 전 자동 저장에서만 생략해, DEFAULT_STATE 로
    // 비워진 빈 customPresets 가 전역 프리셋(audioMixer:presets)을 지우지 않게 한다.
    if (opts?.forcePresets || stateLoaded) {
      out.customPresets = normalizeCustomPresets(state.customPresets);
      out.defaultCustomId = String(state.defaultCustomId || "");
    }
    return out;
  }

  function requestState(mediaId) {
    window.postMessage(
      { source: "cheese-audio-mixer", type: "load", channelId: mediaId },
      location.origin,
    );
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "cheese-audio-mixer-content")
      return;
    if (e.data.type === "loaded" && e.data.channelId === currentMediaId) {
      const saved = e.data.state;
      if (saved && typeof saved === "object") {
        state = {
          ...DEFAULT_STATE(),
          ...saved,
          comp: { ...DEFAULT_STATE().comp, ...(saved.comp || {}) },
          limiter: { ...DEFAULT_STATE().limiter, ...(saved.limiter || {}) },
          normalizer: {
            ...DEFAULT_STATE().normalizer,
            ...(saved.normalizer || {}),
          },
          customPresets: normalizeCustomPresets(saved.customPresets),
          defaultCustomId: String(saved.defaultCustomId || ""),
        };
        globalDefaultPreset = normalizeGlobalDefaultPreset(saved.globalDefault);
        // 기본값으로 등록된 커스텀이 더 이상 없으면(삭제됨) 등록 해제 → 원래 기본 복귀.
        if (
          state.defaultCustomId &&
          !state.customPresets.some((p) => p.id === state.defaultCustomId)
        ) {
          state.defaultCustomId = "";
        }
        // '기본' 칩이 활성(preset==="default")인 채널에 기본값 커스텀이 등록돼
        // 있으면, 그 커스텀 스냅샷을 기본값으로 반영한다(저장된 audio 값은 PRESETS.
        // default 기준이라 자동으로는 안 바뀌므로 여기서 덮어쓴다).
        if (state.preset === "default") {
          const custom = effectiveDefaultCustom();
          if (custom) {
            const snapshot = cloneMixerSnapshot(custom.snapshot);
            state.gain = snapshot.gain;
            state.eq = snapshot.eq;
            state.comp = snapshot.comp;
            state.limiter = snapshot.limiter;
            state.normalizer = snapshot.normalizer;
          }
        }
        // 채널의 '원래 선택'(전역 적용 전)을 보관 — 전역 기본값이 켜진 동안 채널
        // 저장이 전역값으로 덮어써지지 않게 하고, 전역 해제 시 이 값으로 복원한다.
        channelBaseState = snapshotChannelPreset();
        // 전역 기본값 적용 여부: 'channel'(직접 선택 우선) 모드이고 이 채널에서 사용자가
        // 프리셋을 직접 골랐으면(userPickedPreset) 채널값을 유지, 그 외엔 전역값 적용.
        // (기본 'global' 모드는 항상 전역값.) enabled/userDisabled는 채널값 유지.
        const useChannelPick =
          globalDefaultMode === "channel" && state.userPickedPreset === true;
        if (!useChannelPick) applyGlobalDefaultPreset();
        // userDisabled 채널인데 로드 전 자동 활성화가 먼저 켰을 수 있다(레이스).
        // 저장된 의사를 존중해 확실히 끈다.
        if (state.userDisabled && audio.connected) {
          state.enabled = false;
          teardownGraph();
        }
        if (state.enabled) ensureEnabledGraph();
        else applyState();
        syncUI();
      }
      // 저장 설정 로드 완료 → 이제부터 '항상 켜기' 자동 활성화 허용(저장된 프리셋이
      // 이미 state에 반영돼 있으므로 자동으로 켜도 그 프리셋이 적용된다).
      stateLoaded = true;
      maybeAutoEnableMixer();
      // 저장된 enabled 채널도 클릭 없이 복원되도록 재생 기반 resume 을 시도한다.
      bindVideoAutoEnable();
    } else if (e.data.type === "globals-changed") {
      const prevEnabled = globalDefaultPreset.enabled;
      const next = e.data.state || {};
      state.customPresets = normalizeCustomPresets(next.customPresets);
      state.defaultCustomId = String(next.defaultCustomId || "");
      if (
        state.defaultCustomId &&
        !state.customPresets.some((p) => p.id === state.defaultCustomId)
      ) {
        state.defaultCustomId = "";
      }
      globalDefaultPreset = normalizeGlobalDefaultPreset(next.globalDefault);
      if (!globalDefaultPreset.enabled) {
        if (prevEnabled && currentMediaId) requestState(currentMediaId);
        return;
      }
      if (applyGlobalDefaultPreset()) {
        if (state.enabled) ensureEnabledGraph();
        else applyState();
        syncUI();
      }
    }
  });

  // ── UI ──────────────────────────────────────────────────────────────────
  let ui = null;
  let panelAnchorTimer = 0;
  let panelAnchorCloseTimer = 0;

  // 닫기(X) 아이콘. 윈도우에서 ✕ 글리프가 OS마다 위치/크기가 달라지는 문제를
  // 피하려고 텍스트 대신 SVG를 쓴다(댓글 타임스탬프 패널과 동일 path).
  function closeIcon() {
    return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"></path></svg>`;
  }

  function mixerIcon() {
    return `
      <svg class="pzp-ui-icon__svg" focusable="false" xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
        <circle class="cheese-audio-mixer-active-dot" cx="28" cy="25" r="3"/>
        <path d="M12 9v8m0 4v6M18 9v13m0 4v1M24 9v4m0 4v10" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
        <circle cx="12" cy="19" r="2.5" fill="currentColor"/>
        <circle cx="18" cy="24" r="2.5" fill="currentColor"/>
        <circle cx="24" cy="15" r="2.5" fill="currentColor"/>
      </svg>`;
  }

  // 게인 범위는 설정에서 조절 가능(전역). 기본 0.5~2(50%~200%). content.js가
  // feature-flags 브리지로 mixerGainMin/mixerGainMax를 전달하면 갱신한다.
  let GAIN_MIN = 0.5;
  let GAIN_MAX = 2;
  // ⚠ 레이스 방어: 사용자가 설정한 게인 범위(예: 최소 10%)를 아직 브리지로 못 받았는데
  // 그 전에 채널 상태가 로드되면, 로드된 저장 게인(예: 30%)이 '기본 하한 50%' 기준으로
  // 클램프돼 50%로 튀어오를 수 있다(피드백: 50% 미만이 새로고침/방송전환 시 50%로 복귀).
  // 실제 범위를 받기 전엔 클램프하지 않고, 받은 뒤 clampLoadedGain 으로 한 번 정리한다.
  let gainRangeReceived = false;
  function clampGain(g) {
    // 범위 미수신 상태에선 저장값을 보존한다(기본 하한으로 성급히 깎지 않음).
    if (!gainRangeReceived) return g;
    return Math.max(GAIN_MIN, Math.min(GAIN_MAX, g));
  }
  function gainToNorm(g) {
    const n = (g - GAIN_MIN) / (GAIN_MAX - GAIN_MIN);
    return Math.max(0, Math.min(1, n));
  }
  function normToGain(n) {
    const g = GAIN_MIN + n * (GAIN_MAX - GAIN_MIN);
    return Math.round(g * 20) / 20;
  }
  // 설정에서 받은 게인 범위를 반영한다. 유효값만 채택하고(min<max, 상식 범위),
  // 실제로 바뀐 경우에만 현재 게인을 새 범위로 클램프 후 슬라이더/패널을 갱신한다.
  function updateGainRange(rawMin, rawMax) {
    let min = Number(rawMin);
    let max = Number(rawMax);
    if (!Number.isFinite(min) || min < 0 || min > 1) min = 0.5; // 0~100%
    if (!Number.isFinite(max) || max < 1 || max > 4) max = 2; // 100~400%
    if (max <= min) {
      min = 0.5;
      max = 2;
    } // 잘못된 조합이면 기본값
    const firstReceive = !gainRangeReceived;
    const unchanged = min === GAIN_MIN && max === GAIN_MAX;
    gainRangeReceived = true; // 이제부터 클램프 유효(실제 범위 확정).
    // 범위가 그대로여도, '처음 수신'이면 그동안 보류했던 로드 게인 정리를 위해 계속 진행한다.
    if (unchanged && !firstReceive) return;
    GAIN_MIN = min;
    GAIN_MAX = max;
    // 현재 게인이 새 범위를 벗어나면 클램프하고 적용(그래프에도 반영).
    const clamped = clampGain(state.gain);
    if (clamped !== state.gain) {
      state.gain = clamped;
      if (typeof applyState === "function") applyState();
    }
    // 컴팩트 슬라이더 채움/툴팁 + 열려 있는 패널(고급 슬라이더 min/max)을 갱신.
    if (typeof syncMasterGain === "function") syncMasterGain();
    if (typeof refreshPanelContent === "function" && ui?.panel) {
      refreshPanelContent();
    }
  }
  // 게인 슬라이더 마크업(치지직 native 볼륨 슬라이더 클래스 그대로 → native CSS
  // 적용). 게인 0.5~2를 0~1 정규화해 progress/handler에 반영.
  function gainSliderMarkup() {
    const n = gainToNorm(state.gain);
    const pct = Math.round(n * 1000) / 10;
    return `<div role="slider" tabindex="0" data-master-gain style="display: none;" class="pzp-pc__volume-slider pzp-pc-volume-slider pzp-ui-slider--volume pzp-ui-slider" aria-label="음량" aria-live="polite" aria-valuemin="0" aria-valuenow="${Math.round(n * 100)}" aria-valuemax="100" aria-valuetext="${Math.round(n * 100)}%"><input type="range" max="1" tabindex="-1" class="pzp-ui-slider__aria-range"><div class="pzp-ui-slider__wrap"><div class="pzp-ui-progress__div pzp-ui-progress pzp-ui-progress__entire-background" style="--pzp-ui-progress__scale: 1;"></div><div class="pzp-ui-progress__div pzp-ui-progress pzp-ui-progress__volume" style="--pzp-ui-progress__scale: ${n};"></div><div class="pzp-ui-slider__handler-wrap" style="left: ${pct}%;"><span role="none presentation" class="pzp-ui-slider__handler"></span></div></div></div>`;
  }

  // 버튼 + 슬라이더를 native 볼륨 컨트롤(.pzp-pc__volume-control)로 감싼다.
  // 이렇게 하면 치지직 native CSS가 그대로 적용돼 버튼 옆에 가로 슬라이더가
  // 펼쳐진다. 별도 CSS 불필요.
  // 게인 툴팁은 슬라이더가 아니라 래퍼(.cheese-audio-mixer-control) 직속에 둔다 —
  // 슬라이더 안에 두면 믹서 버튼 native 툴팁이 뜰 때 슬라이더가 밀려 함께 출렁였다.
  // 래퍼는 하단 바 flex 아이템이라 세로 위치가 안정적이다(음량 툴팁과 동일 전략).
  function createButtonControl() {
    const wrap = document.createElement("div");
    wrap.className = `${CONTROL_CLASS} pzp-pc__volume-control`;
    const gainPct = Math.round(state.gain * 100);
    wrap.innerHTML = `<button class="${BUTTON_CLASS} pzp-pc__volume-button pzp-button pzp-pc-ui-button" type="button" aria-label="오디오 믹서 (Shift+A)" aria-expanded="false"><span class="pzp-button__tooltip pzp-button__tooltip--top">오디오 믹서 (Shift+A)</span><span class="pzp-ui-icon">${mixerIcon()}</span><span class="pzp-button__label">오디오 믹서</span></button>${gainSliderMarkup()}<span class="${VOLUME_TOOLTIP_CLASS} cheese-gain-tooltip" data-gain-tooltip>${gainPct}%</span>`;
    return wrap;
  }

  function ensureButton() {
    // native 왼쪽 컨트롤 그룹에 넣어 자동 숨김/표시에 함께 묶이도록 한다.
    const controls =
      document.querySelector(".pzp-pc__bottom-buttons-left") ||
      findPlayer()?.querySelector(".pzp-pc__bottom-buttons-left");
    if (!controls) return;
    let wrap = document.querySelector(`.${CONTROL_CLASS}`);
    if (!wrap) {
      wrap = createButtonControl();
    }
    // 이미 이 좌측 그룹 안에 있으면 위치를 강제하지 않는다. ⚠ 예전엔 '네이티브 볼륨
    // 바로 뒤' 불변식을 매 tick 강제했는데, 사용자가 볼륨과 믹서 사이에 되감기/앞으로를
    // 끼워 배치하면 arrangePlayerButtons(seek 을 볼륨 뒤로)와 여기(믹서를 볼륨 바로 뒤로)가
    // 서로 상대를 밀어내 무한 재삽입 → 호버 시 깜빡임·클릭 불가가 됐다. 믹서는 '존재'만
    // 보장하고, 그룹 내 상대 순서는 arrangePlayerButtons 의 앵커 체계에 맡긴다.
    if (wrap.parentElement === controls) return;
    // 최초 삽입 위치: 네이티브 볼륨(우리 것이 아닌) 바로 뒤. 없으면 그룹 맨 앞.
    const nativeVolume = Array.from(
      controls.querySelectorAll(".pzp-pc__volume-control"),
    ).find((el) => !el.classList.contains(CONTROL_CLASS));
    if (nativeVolume) {
      nativeVolume.insertAdjacentElement("afterend", wrap);
    } else {
      controls.insertBefore(wrap, controls.firstChild);
    }
    syncUI();
  }

  function removeButton() {
    document.querySelectorAll(`.${CONTROL_CLASS}`).forEach((el) => el.remove());
  }

  function togglePanel() {
    if (ui?.panel && document.body.contains(ui.panel)) {
      closePanel();
    } else {
      openPanel();
    }
  }

  // 믹서 버튼 클릭 처리. 기본은 패널만 토글. '클릭 시 즉시 활성' 옵션이 켜져 있으면
  // 클릭 = 믹서 활성 + 패널 열기, 재클릭 = 비활성 + 패널 닫기(패널 열림 상태 기준).
  function handleMixerButtonClick() {
    // 초보자용 원클릭(최우선): clickActivate/noPanel/전역기본값과 무관하게 패널 없이
    // '기본 프리셋으로 바로 on/off'. 켤 때 기본 프리셋을 강제 적용해 항상 동일 동작.
    if (mixerBeginner) {
      if (state.enabled && audio.connected) {
        setEnabled(false);
      } else if (!graphConflict) {
        // 그래프를 '먼저' 켠다(클릭 직후 = 사용자 활성화가 살아 있을 때 buildGraph 성공률↑).
        // 그다음 기본 프리셋 값을 반영한다(connected 면 값만 적용). 순서를 뒤집으면
        // applyPreset 내부 처리 뒤에 buildGraph 가 불려 userActivation 창을 놓쳐 '되다
        // 안되다' 하던 문제를 줄인다.
        setEnabled(true);
        if (state.enabled && audio.connected) applyPreset("default");
      }
      return;
    }
    if (!mixerClickActivate) {
      togglePanel();
      return;
    }
    // '패널 안 열기' 하위 옵션: 패널은 건드리지 않고 효과 enabled 만 토글한다(판정도
    // 패널 열림이 아니라 state.enabled 기준). 클릭은 사용자 제스처라 AudioContext 활성화 가능.
    if (mixerClickNoPanel) {
      if (state.enabled) setEnabled(false);
      else if (!graphConflict) setEnabled(true);
      return;
    }
    const panelOpen = !!(ui?.panel && document.body.contains(ui.panel));
    if (panelOpen) {
      // 열려 있으면 끄고 닫는다. (믹서 숨김 기능이 아니라 효과 비활성)
      if (state.enabled) setEnabled(false);
      closePanel();
    } else {
      // 닫혀 있으면 켜고 연다. 클릭은 사용자 제스처라 AudioContext 활성화 가능.
      if (!state.enabled && !graphConflict) setEnabled(true);
      openPanel();
    }
  }

  function openPanel() {
    closePanel();
    activeTab = "presets";
    customCreatorOpen = false;
    customDialog = null;
    // 이름 입력창은 닫힌 상태로 시작한다(dirty 상태/버튼 표시는 유지).
    quickSaveOpen = false;
    const button = document.querySelector(`.${BUTTON_CLASS}`);
    const root = getPanelRoot(button) || findPlayer();
    if (!root) {
      // 플레이어가 아직 준비되지 않았으면 잠시 후 한 번 더 시도한다.
      setTimeout(() => {
        if (!document.getElementById(PANEL_ID) && getPageKey()) openPanel();
      }, 200);
      return;
    }
    if (getComputedStyle(root).position === "static") {
      root.style.position = "relative";
    }
    root.style.overflow = "visible";
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.className = "cheese-audio-mixer-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "오디오 믹서");
    panel.innerHTML = renderPanel();
    // 패널을 플레이어 내부에 absolute로 마운트 → 페이지 스크롤과 무관하게
    // 플레이어 기준으로 고정되고, 전체화면에서도 함께 보인다.
    root.appendChild(panel);
    ui = { panel, root };
    // 패널이 열린 동안 native 컨트롤이 자동으로 숨겨지지 않도록 유지한다.
    keepControlsVisible(root, "mixer");
    bindPanelEvents(panel);
    positionPanel(panel, root);
    startPanelAnchorMonitor();
    button?.setAttribute("aria-expanded", "true");
    syncUI();
  }

  function closePanel() {
    stopPanelAnchorMonitor();
    closeInfoPopover(ui?.panel);
    releaseControlsVisible("mixer");
    document.getElementById(PANEL_ID)?.remove();
    document
      .querySelector(`.${BUTTON_CLASS}`)
      ?.setAttribute("aria-expanded", "false");
    ui = null;
  }

  // 치지직은 마우스 비활성 시 플레이어 루트(.pzp-pc)에서 `pzp-pc--controls`
  // 클래스를 제거해 하단 컨트롤을 숨긴다. 패널이 열린 동안 이 클래스를 강제로
  // 유지하면 native 표시 로직을 그대로 활용해 어떤 숨김 방식이든 막을 수 있다.
  const CONTROLS_CLASS = "pzp-pc--controls";
  let controlsObserver = null;
  let controlsRoot = null;
  // 컨트롤 유지를 요청한 사유들(오디오 패널/스트림 패널/따라잡기 등). 하나라도
  // 있으면 유지하고, 모두 비워지면 해제한다(서로의 유지를 끊지 않도록).
  const controlsHolders = new Set();

  function keepControlsVisible(root, reason = "panel") {
    controlsHolders.add(reason);
    // 루트가 바뀌었거나 observer가 없으면 (재)설정.
    if (controlsRoot !== root || !controlsObserver) {
      if (controlsObserver) controlsObserver.disconnect();
      controlsRoot = root;
      controlsObserver = new MutationObserver(() => {
        if (controlsRoot && !controlsRoot.classList.contains(CONTROLS_CLASS)) {
          controlsRoot.classList.add(CONTROLS_CLASS);
        }
      });
      controlsObserver.observe(root, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }
    if (!root.classList.contains(CONTROLS_CLASS)) {
      root.classList.add(CONTROLS_CLASS);
    }
  }

  function releaseControlsVisible(reason = "panel") {
    controlsHolders.delete(reason);
    if (controlsHolders.size > 0) return; // 아직 유지를 원하는 사유가 남음
    if (controlsObserver) {
      controlsObserver.disconnect();
      controlsObserver = null;
    }
    controlsRoot = null;
  }

  function refreshPanelContent() {
    const panel = ui?.panel;
    if (!panel) return;
    panel.innerHTML = renderPanel();
    // 위임 리스너는 panel에 한 번만 붙어 있으므로 재바인딩하지 않는다(중복 누적 방지).
    syncUI();
    repositionOpenPanel();
  }

  function getPanelRoot(anchor) {
    return (
      anchor?.closest(".pzp-pc") ||
      anchor?.closest(".webplayer-internal-core") ||
      anchor?.closest("[class*='player']") ||
      findPlayer()
    );
  }

  function startPanelAnchorMonitor() {
    stopPanelAnchorMonitor();
    panelAnchorTimer = window.setInterval(() => {
      if (!isPanelAnchorAvailable()) {
        schedulePanelAnchorClose();
        return;
      }
      clearPanelAnchorCloseTimer();
      repositionOpenPanel();
    }, PANEL_ANCHOR_CHECK_MS);
  }

  function stopPanelAnchorMonitor() {
    if (!panelAnchorTimer) return;
    window.clearInterval(panelAnchorTimer);
    panelAnchorTimer = 0;
    clearPanelAnchorCloseTimer();
  }

  function schedulePanelAnchorClose() {
    if (panelAnchorCloseTimer) return;
    panelAnchorCloseTimer = window.setTimeout(() => {
      panelAnchorCloseTimer = 0;
      if (isPanelAnchorAvailable()) return;
      closePanel();
    }, PANEL_AUTO_CLOSE_DELAY_MS);
  }

  function clearPanelAnchorCloseTimer() {
    if (!panelAnchorCloseTimer) return;
    window.clearTimeout(panelAnchorCloseTimer);
    panelAnchorCloseTimer = 0;
  }

  function isPanelAnchorAvailable() {
    const panel = document.getElementById(PANEL_ID);
    const button = document.querySelector(`.${BUTTON_CLASS}`);
    // 버튼이 잠시 숨겨져도(컨트롤 자동 숨김) 패널은 닫지 않는다. 버튼이 DOM에
    // 존재하고 영상이 '있으면' 유지한다. 렌더 가시성(opacity/rect)까지 따지면
    // 컨트롤 전환·전체화면 토글·버퍼링 등 일시적 비가시 상태에서 오탐으로 패널이
    // 저절로 닫혀버린다(가만둬도 사라지는 문제). 그래서 '탈착(navigation)'만 본다.
    return (
      Boolean(panel) &&
      button instanceof HTMLElement &&
      document.documentElement.contains(button) &&
      isVideoAttached()
    );
  }

  // 영상이 DOM에 붙어 있는지만 본다(가시성 무관). 페이지 이동으로 플레이어/영상이
  // 제거되면 false → 그때만 패널을 자동으로 닫는다.
  function isVideoAttached() {
    const v = findVideo();
    return v instanceof HTMLElement && document.documentElement.contains(v);
  }

  function isElementRendered(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (!document.documentElement.contains(element)) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    let current = element;
    while (current && current !== document.documentElement) {
      const style = getComputedStyle(current);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0
      ) {
        return false;
      }
      current = current.parentElement;
    }
    return true;
  }

  function positionPanel(panel, root) {
    if (!panel || !root) return;
    const rootRect = root.getBoundingClientRect();
    const viewportAvailableHeight =
      window.innerHeight -
      Math.max(PANEL_TOP_GAP_PX, rootRect.top) -
      PANEL_BOTTOM_PX -
      PANEL_TOP_GAP_PX;
    const rootAvailableHeight =
      rootRect.height - PANEL_BOTTOM_PX - PANEL_TOP_GAP_PX;
    const maxHeight = Math.max(
      PANEL_MIN_HEIGHT_PX,
      Math.min(
        PANEL_MAX_HEIGHT_PX,
        viewportAvailableHeight,
        rootAvailableHeight,
      ),
    );

    panel.style.left = `${PANEL_RIGHT_PX}px`;
    panel.style.bottom = `${PANEL_BOTTOM_PX}px`;
    panel.style.maxHeight = `${Math.floor(maxHeight)}px`;
  }

  function repositionOpenPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const root = getPanelRoot(document.querySelector(`.${BUTTON_CLASS}`));
    if (!root) return;
    positionPanel(panel, root);
  }

  // head 영역. 프리셋에서 벗어나 수정된 상태(presetDirty)면 "프리셋 추가" 버튼을
  // 보여준다(클릭 시 패널 위 모달로 이름 입력 — renderQuickSaveModal 참고).
  function renderHeadInner() {
    const canReset = presetDirty && Boolean(dirtyFromKey);
    return `
      <strong>오디오 믹서</strong>
      ${
        canReset
          ? `<button type="button" class="cheese-mixer-reset-button" data-action="preset-reset" title="${escapeAttribute(presetDisplayName(dirtyFromKey))} 값으로 되돌리기">↺ 초기화</button>`
          : ""
      }
      ${
        presetDirty
          ? `<button type="button" class="cheese-mixer-quicksave-button" data-action="quicksave-open">+ 프리셋 추가</button>`
          : ""
      }
      <label class="cheese-mixer-power" data-tooltip="${state.enabled ? "끄기" : "켜기"}" aria-label="${state.enabled ? "끄기" : "켜기"}">
        <input type="checkbox" data-action="power" ${state.enabled ? "checked" : ""}>
        <i aria-hidden="true"></i>
      </label>
      <button type="button" class="cheese-mixer-close" data-action="close" aria-label="닫기">${closeIcon()}</button>`;
  }

  // head만 다시 그린다(슬라이더 드래그 중 전체 재렌더를 피하기 위함).
  function syncHead() {
    const head = ui?.panel?.querySelector(".cheese-mixer-head");
    if (!head) return;
    head.innerHTML = renderHeadInner();
  }

  function renderPanel() {
    const presetButtons = Object.entries(PRESETS)
      .map(
        ([key, p]) =>
          `<button type="button" class="cheese-mixer-preset" data-preset="${key}">${key === "default" ? escapeHtml(defaultPresetLabel()) : p.label}</button>`,
      )
      .join("");
    const eqSliders = EQ_BANDS.map(
      (freq, i) => `
      <div class="cheese-mixer-eq-band">
        <output class="cheese-mixer-eq-value" data-eq-output="${i}">${fmtDb(state.eq[i])}</output>
        <input type="range" min="-12" max="12" step="0.1" value="${state.eq[i]}" data-eq="${i}" orient="vertical">
        <span>${freq >= 1000 ? `${freq / 1000}k` : freq}</span>
      </div>`,
    ).join("");

    return `
      <div class="cheese-mixer-head">
        ${renderHeadInner()}
      </div>
      ${
        graphConflict
          ? `<p class="cheese-mixer-conflict">다른 확장 프로그램이 이 영상의 오디오를 이미 사용 중이라 오디오 믹서를 켤 수 없습니다. 해당 확장을 끄거나 컴프레서를 비활성화한 뒤 새로고침해 주세요.</p>`
          : ""
      }
      <div class="cheese-mixer-tabs" role="tablist">
        <button type="button" class="cheese-mixer-tab ${activeTab === "presets" ? "is-active" : ""}" data-tab="presets">프리셋</button>
        <button type="button" class="cheese-mixer-tab ${activeTab === "custom" ? "is-active" : ""}" data-tab="custom">커스텀</button>
        <button type="button" class="cheese-mixer-tab ${activeTab === "advanced" ? "is-active" : ""}" data-tab="advanced">고급</button>
        <button type="button" class="cheese-mixer-tab ${activeTab === "expert" ? "is-active" : ""}" data-tab="expert">전문가</button>
      </div>
      <div class="cheese-mixer-body">
        <section class="cheese-mixer-pane ${activeTab === "presets" ? "is-active" : ""}" data-pane="presets">
          <p class="cheese-mixer-hint">방송 유형에 맞는 음향 프리셋을 선택하세요.</p>
          <div class="cheese-mixer-presets">${presetButtons}</div>
        </section>
        <section class="cheese-mixer-pane ${activeTab === "custom" ? "is-active" : ""}" data-pane="custom">
          ${renderCustomPresetPane()}
        </section>
        <section class="cheese-mixer-pane ${activeTab === "advanced" ? "is-active" : ""}" data-pane="advanced">
          ${renderCustomDraftBar("advanced")}
          ${renderAdvancedRow("음량 (게인)", "gain", GAIN_MIN, GAIN_MAX, 0.05, state.gain)}
          ${renderAdvancedRow("저음", "bass", -12, 12, 0.1, state.eq[0])}
          ${renderAdvancedRow("고음", "treble", -12, 12, 0.1, state.eq[8])}
          ${renderAdvancedRow("음성 선명도", "clarity", -12, 12, 0.1, state.eq[4])}
          ${renderToggleRow("음량 균일화 (노멀라이저)", "normalizer", "normalizer-toggle", state.normalizer.enabled)}
          ${renderToggleRow("다이내믹 압축 (컴프레서)", "comp", "comp-toggle", state.comp.enabled)}
          ${renderToggleRow("최대 음량 제한 (리미터)", "limiter", "limiter-toggle", state.limiter.enabled)}
        </section>
        <section class="cheese-mixer-pane ${activeTab === "expert" ? "is-active" : ""}" data-pane="expert">
          ${renderCustomDraftBar("expert")}
          ${groupHeading("이퀄라이저 (10밴드)", "group-eq")}
          <div class="cheese-mixer-eq">${eqSliders}</div>

          ${groupHeading("음량", "group-gain")}
          <div class="cheese-mixer-expert-group">
            ${renderAdvancedRow("음량 (게인)", "gain", GAIN_MIN, GAIN_MAX, 0.05, state.gain)}
          </div>

          ${groupHeading("컴프레서", "group-comp")}
          <div class="cheese-mixer-expert-group">
            ${renderAdvancedRow("Threshold (dB)", "comp-threshold", -100, 0, 0.1, state.comp.threshold)}
            ${renderAdvancedRow("Knee (dB)", "comp-knee", 0, 40, 0.1, state.comp.knee)}
            ${renderAdvancedRow("Ratio", "comp-ratio", 1, 20, 0.1, state.comp.ratio)}
            ${renderAdvancedRow("Attack (s)", "comp-attack", 0, 1, 0.001, state.comp.attack)}
            ${renderAdvancedRow("Release (s)", "comp-release", 0, 1, 0.01, state.comp.release)}
            ${renderAdvancedRow("Makeup (dB)", "comp-makeup", 0, 24, 0.1, state.comp.makeup ?? 0)}
          </div>

          ${groupHeading("리미터", "group-limiter")}
          <div class="cheese-mixer-expert-group">
            ${renderAdvancedRow("Limiter (dB)", "limiter-threshold", -20, 0, 0.1, state.limiter.threshold)}
          </div>

          ${groupHeading("노멀라이저", "group-normalizer")}
          <div class="cheese-mixer-expert-group">
            ${renderAdvancedRow("목표 레벨", "normalizer-target", 0.04, 0.3, 0.01, state.normalizer.target)}
          </div>
        </section>
      </div>
      ${renderQuickSaveModal()}`;
  }

  // "프리셋 추가" 클릭 시 패널 위에 뜨는 이름 입력 모달.
  function renderQuickSaveModal() {
    if (!quickSaveOpen) return "";
    return `
      <div class="cheese-mixer-modal-backdrop" data-action="quicksave-cancel">
        <div class="cheese-mixer-modal" role="dialog" aria-label="프리셋 저장" data-modal-stop>
          <strong>커스텀 프리셋 저장</strong>
          <input type="text" data-quicksave-name maxlength="${CUSTOM_PRESET_NAME_MAX_LENGTH}" placeholder="프리셋 이름" autocomplete="off">
          <div class="cheese-mixer-modal-actions">
            <button type="button" class="cheese-mixer-custom-button is-primary" data-action="quicksave-confirm">저장</button>
            <button type="button" class="cheese-mixer-custom-button" data-action="quicksave-cancel">취소</button>
          </div>
        </div>
      </div>`;
  }

  function renderCustomPresetPane() {
    const presets = normalizeCustomPresets(state.customPresets);
    const list = presets.length
      ? presets.map(renderCustomPresetItem).join("")
      : `<p class="cheese-mixer-empty">저장된 커스텀 프리셋이 없습니다.</p>`;
    const hasPresets = presets.length > 0;
    return `
      <div class="cheese-mixer-custom-head">
        <button type="button" class="cheese-mixer-custom-button is-primary" data-action="custom-new">프리셋 추가</button>
        <button type="button" class="cheese-mixer-custom-button" data-action="custom-export-open" ${hasPresets ? "" : "disabled"} title="${hasPresets ? "선택한 프리셋을 JSON으로 복사" : "내보낼 프리셋이 없습니다"}">내보내기</button>
        <button type="button" class="cheese-mixer-custom-button" data-action="custom-import-open" title="공유받은 JSON으로 프리셋 추가">불러오기</button>
      </div>
      ${customCreatorOpen ? renderCustomPresetCreator() : ""}
      ${customExportOpen ? renderCustomExport() : ""}
      ${customImportOpen ? renderCustomImport() : ""}
      ${customDialog ? renderCustomDialog() : ""}
      <div class="cheese-mixer-custom-list">${list}</div>`;
  }

  // 내보내기 패널: 프리셋 목록을 체크박스로 선택 → "JSON 복사"로 클립보드 복사.
  function renderCustomExport() {
    const presets = normalizeCustomPresets(state.customPresets);
    const rows = presets
      .map((preset) => {
        const checked = customExportSelected.has(preset.id) ? "checked" : "";
        const modeLabel = preset.mode === "expert" ? "전문가" : "고급";
        return `
          <label class="cheese-mixer-share-row">
            <input type="checkbox" data-export-pick="${escapeAttribute(preset.id)}" ${checked}>
            <span class="cheese-mixer-share-row-name">${escapeHtml(preset.name)}</span>
            <span class="cheese-mixer-share-row-mode">${modeLabel}</span>
          </label>`;
      })
      .join("");
    const count = customExportSelected.size;
    return `
      <div class="cheese-mixer-share" role="group" aria-label="프리셋 내보내기">
        <div class="cheese-mixer-share-head">
          <strong>내보내기</strong>
          <button type="button" class="cheese-mixer-share-selectall" data-action="custom-export-selectall">${count === presets.length ? "선택 해제" : "전체 선택"}</button>
        </div>
        <div class="cheese-mixer-share-list">${rows}</div>
        ${customShareMsg ? renderShareMsg() : ""}
        <div class="cheese-mixer-share-actions">
          <button type="button" class="cheese-mixer-custom-button is-primary" data-action="custom-export-copy" ${count ? "" : "disabled"}>JSON 복사 (${count})</button>
          <button type="button" class="cheese-mixer-custom-button" data-action="custom-share-close">닫기</button>
        </div>
      </div>`;
  }

  // 불러오기 패널: JSON 붙여넣기 → 검증 → 유효 프리셋을 커스텀에 추가.
  function renderCustomImport() {
    return `
      <div class="cheese-mixer-share" role="group" aria-label="프리셋 불러오기">
        <div class="cheese-mixer-share-head">
          <strong>불러오기</strong>
        </div>
        <textarea class="cheese-mixer-share-input" data-import-text placeholder="공유받은 프리셋 JSON을 붙여넣으세요.">${escapeHtml(customImportText)}</textarea>
        ${customShareMsg ? renderShareMsg() : ""}
        <div class="cheese-mixer-share-actions">
          <button type="button" class="cheese-mixer-custom-button is-primary" data-action="custom-import-confirm">불러오기</button>
          <button type="button" class="cheese-mixer-custom-button" data-action="custom-share-close">닫기</button>
        </div>
      </div>`;
  }

  function renderShareMsg() {
    if (!customShareMsg) return "";
    const cls = customShareMsg.kind === "error" ? "is-error" : "is-ok";
    return `<p class="cheese-mixer-share-msg ${cls}">${escapeHtml(customShareMsg.text)}</p>`;
  }

  function renderCustomPresetCreator() {
    return `
      <div class="cheese-mixer-custom-creator">
        <input type="text" data-custom-new-name maxlength="${CUSTOM_PRESET_NAME_MAX_LENGTH}" placeholder="프리셋 이름">
        <div class="cheese-mixer-mode-picker" role="radiogroup" aria-label="설정 모드">
          <button type="button" class="cheese-mixer-mode-option is-active" data-action="custom-mode-select" data-custom-new-mode="advanced" role="radio" aria-checked="true">고급 슬라이더</button>
          <button type="button" class="cheese-mixer-mode-option" data-action="custom-mode-select" data-custom-new-mode="expert" role="radio" aria-checked="false">전문가 모드</button>
        </div>
        <button type="button" class="cheese-mixer-custom-button is-primary" data-action="custom-create-start">설정 시작</button>
        <button type="button" class="cheese-mixer-custom-button" data-action="custom-create-cancel">취소</button>
      </div>`;
  }

  function renderCustomDialog() {
    const preset = normalizeCustomPresets(state.customPresets).find(
      (item) => item.id === customDialog.id,
    );
    if (!preset) return "";
    if (customDialog.type === "edit") {
      return `
        <div class="cheese-mixer-custom-dialog">
          <strong>프리셋 이름 수정</strong>
          <input type="text" data-custom-edit-name maxlength="${CUSTOM_PRESET_NAME_MAX_LENGTH}" value="${escapeAttribute(preset.name)}">
          <div class="cheese-mixer-custom-dialog-actions">
            <button type="button" class="cheese-mixer-custom-button is-primary" data-action="custom-edit-confirm" data-custom-id="${escapeAttribute(preset.id)}">확인</button>
            <button type="button" class="cheese-mixer-custom-button" data-action="custom-dialog-cancel">취소</button>
          </div>
        </div>`;
    }
    return `
      <div class="cheese-mixer-custom-dialog">
        <strong>프리셋 삭제</strong>
        <p>${escapeHtml(preset.name)} 프리셋을 삭제할까요?</p>
        <div class="cheese-mixer-custom-dialog-actions">
          <button type="button" class="cheese-mixer-custom-button is-danger" data-action="custom-delete-confirm" data-custom-id="${escapeAttribute(preset.id)}">삭제</button>
          <button type="button" class="cheese-mixer-custom-button" data-action="custom-dialog-cancel">취소</button>
        </div>
      </div>`;
  }

  function renderCustomPresetItem(preset) {
    const modeLabel = preset.mode === "expert" ? "전문가" : "고급";
    const isDefault = state.defaultCustomId === preset.id;
    // 별 아이콘: 채움=기본값으로 등록됨(클릭 시 해제), 비움=등록 가능(클릭 시 등록).
    const starIcon = isDefault
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.9L12 16.9 6.8 19.2l1-5.9L3.5 9.2l5.9-.9L12 3Z"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.9L12 16.9 6.8 19.2l1-5.9L3.5 9.2l5.9-.9L12 3Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
    return `
      <div class="cheese-mixer-custom-item">
        <div class="cheese-mixer-custom-select ${state.preset === preset.id ? "is-active" : ""}">
          <button type="button" class="cheese-mixer-custom-apply" data-action="custom-apply" data-custom-id="${escapeAttribute(preset.id)}">
            <strong>${escapeHtml(preset.name)}</strong>
            <span>${modeLabel}</span>
          </button>
          <div class="cheese-mixer-custom-actions">
            <button type="button" class="cheese-mixer-custom-icon-button ${isDefault ? "is-default" : ""}" data-action="${isDefault ? "custom-unset-default" : "custom-set-default"}" data-custom-id="${escapeAttribute(preset.id)}" aria-label="${isDefault ? "기본값 해제" : "기본값으로 등록"}" title="${isDefault ? "기본값 해제" : "기본값으로 등록"}">
              ${starIcon}
            </button>
            <button type="button" class="cheese-mixer-custom-icon-button" data-action="custom-edit" data-custom-id="${escapeAttribute(preset.id)}" aria-label="수정">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 20h4.2L19 9.2 14.8 5 4 15.8V20Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
                <path d="m13.7 6.1 4.2 4.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </button>
            <button type="button" class="cheese-mixer-custom-icon-button is-danger" data-action="custom-delete" data-custom-id="${escapeAttribute(preset.id)}" aria-label="삭제">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 7h14M10 11v6M14 11v6M8 7l1-3h6l1 3M7 7l1 13h8l1-13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      </div>`;
  }

  function renderCustomDraftBar(mode) {
    if (!customDraft || customDraft.mode !== mode) return "";
    return `
      <div class="cheese-mixer-draft-bar">
        <div>
          <strong>${escapeHtml(customDraft.name)}</strong>
          <span>${customDraft.editing ? "프리셋 수정 중" : "새 프리셋 설정 중"}</span>
        </div>
        <button type="button" class="cheese-mixer-custom-button is-primary" data-action="custom-draft-save">저장</button>
        <button type="button" class="cheese-mixer-custom-button" data-action="custom-draft-cancel">취소</button>
      </div>`;
  }

  function renderAdvancedRow(label, key, min, max, step, value) {
    const info = INFO_TEXT[key] ? infoIcon(key) : "";
    return `
      <div class="cheese-mixer-row">
        <label class="cheese-mixer-row-label">${label}${info}</label>
        <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-slider="${key}">
        <output data-output="${key}">${fmtNum(value)}</output>
      </div>`;
  }

  // 슬라이더 표시값 정리: 0.1/0.001 step 등에서 생기는 부동소수점 오차를 없애고
  // 불필요한 끝자리 0을 제거한다(예: 0.30000004 → "0.3", 1.50 → "1.5").
  function fmtNum(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "0";
    return String(Math.round(n * 1000) / 1000);
  }

  // 토글 행: info 아이콘을 label 바깥에 두어 체크박스 토글과 분리한다.
  function renderToggleRow(label, infoKey, action, checked) {
    const info = INFO_TEXT[infoKey] ? infoIcon(infoKey) : "";
    return `
      <div class="cheese-mixer-toggle-row">
        <span class="cheese-mixer-toggle-label">${label}${info}</span>
        <label class="cheese-mixer-switch">
          <input type="checkbox" data-action="${action}" ${checked ? "checked" : ""}>
          <i aria-hidden="true"></i>
        </label>
      </div>`;
  }

  function groupHeading(label, infoKey) {
    const info = infoKey && INFO_TEXT[infoKey] ? infoIcon(infoKey) : "";
    return `<h4 class="cheese-mixer-group-heading">${label}${info}</h4>`;
  }

  // EQ 값 표시: +가 붙는 부호 + 소수 한 자리(0은 "0")
  function fmtDb(db) {
    const v = Math.round(db * 10) / 10;
    if (v === 0) return "0";
    return `${v > 0 ? "+" : ""}${v}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => {
      switch (char) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return char;
      }
    });
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  function bindPanelEvents(panel) {
    // 위임 리스너는 panel 엘리먼트(재렌더에도 그대로 유지)에 단 한 번만 붙인다.
    // refreshPanelContent가 innerHTML만 교체하므로, 매 렌더마다 다시 부르면 같은
    // 핸들러가 누적돼 이벤트가 N배로 실행되며 페이지가 버벅이다 멈춘다.
    if (panel.dataset.eventsBound === "1") return;
    panel.dataset.eventsBound = "1";

    // .cheese-mixer-body는 재렌더로 교체되므로 capture 단계로 panel에서 잡는다
    // (scroll은 버블링하지 않지만 capture로는 전파된다).
    panel.addEventListener(
      "scroll",
      (e) => {
        if (e.target.classList?.contains("cheese-mixer-body")) {
          closeInfoPopover(panel);
        }
      },
      { passive: true, capture: true },
    );

    panel.addEventListener(
      "keydown",
      (e) => {
        if (isEditableMixerTarget(e.target)) e.stopPropagation();
        // 빠른 저장 이름 입력: Enter로 저장, Esc로 취소
        if (e.target.matches?.("[data-quicksave-name]")) {
          if (e.key === "Enter") {
            e.preventDefault();
            confirmQuickSave(panel);
          } else if (e.key === "Escape") {
            e.preventDefault();
            closeQuickSaveModal();
          }
        }
      },
      true,
    );
    panel.addEventListener(
      "keyup",
      (e) => {
        if (isEditableMixerTarget(e.target)) e.stopPropagation();
      },
      true,
    );
    panel.addEventListener(
      "keypress",
      (e) => {
        if (isEditableMixerTarget(e.target)) e.stopPropagation();
      },
      true,
    );

    // info 아이콘 클릭 → 설명 팝오버 토글
    panel.addEventListener("click", (e) => {
      // 탭 전환 / 내장 프리셋 적용도 위임으로 처리한다(재렌더로 버튼이 교체돼도
      // 핸들러가 패널에 한 번만 붙어 있으므로 중복 누적되지 않는다).
      const tab = e.target.closest(".cheese-mixer-tab");
      if (tab) {
        switchTab(panel, tab.dataset.tab);
        return;
      }
      const presetBtn = e.target.closest(".cheese-mixer-preset");
      if (presetBtn) {
        applyPreset(presetBtn.dataset.preset);
        return;
      }
      // 클릭으로 처리하는 버튼형 액션(체크박스 토글 power/*-toggle은 change에서
      // 처리하므로 제외). 매칭되면 항상 전파를 막아, 패널 재렌더로 e.target이
      // 분리돼 document 바깥클릭 닫기 핸들러가 패널을 닫는 문제를 방지한다.
      const actionButton = e.target.closest(
        "[data-action]:not([type='checkbox'])",
      );
      if (actionButton) {
        const action = actionButton.dataset.action;
        // backdrop의 quicksave-cancel은 모달 내부 클릭에는 적용하지 않는다.
        if (
          action === "quicksave-cancel" &&
          actionButton.classList.contains("cheese-mixer-modal-backdrop") &&
          e.target.closest("[data-modal-stop]")
        ) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        if (action === "close") {
          closePanel();
          return;
        }
        if (action === "preset-reset") {
          resetToBasePreset();
          return;
        }
        if (action === "quicksave-open") {
          openQuickSaveModal();
          return;
        }
        if (action === "quicksave-confirm") {
          confirmQuickSave(panel);
          return;
        }
        if (action === "quicksave-cancel") {
          closeQuickSaveModal();
          return;
        }
        if (handleCustomPresetAction(panel, actionButton)) {
          return;
        }
      }

      const info = e.target.closest(".cheese-mixer-info");
      if (info) {
        e.preventDefault();
        e.stopPropagation();
        toggleInfoPopover(panel, info);
      } else if (!e.target.closest(".cheese-mixer-info-popover")) {
        closeInfoPopover(panel);
      }
    });

    panel.addEventListener("input", (e) => {
      const t = e.target;
      if (t.dataset.importText != null) {
        // 재렌더 간 내용 유지(재렌더는 일으키지 않음 — 커서/포커스 보존).
        customImportText = t.value;
      } else if (
        t.matches?.(
          "[data-custom-new-name], [data-custom-edit-name], [data-quicksave-name]",
        )
      ) {
        t.value = t.value.slice(0, CUSTOM_PRESET_NAME_MAX_LENGTH);
      } else if (t.dataset.slider) {
        handleSlider(t.dataset.slider, parseFloat(t.value));
        // 같은 행의 output만 갱신한다. gain처럼 같은 key가 두 탭에 중복
        // 존재해도 querySelector가 엉뚱한(숨겨진) output을 잡지 않도록 한다.
        const out = t
          .closest(".cheese-mixer-row")
          ?.querySelector("[data-output]");
        if (out) out.textContent = fmtNum(t.value);
      } else if (t.dataset.eq != null) {
        const idx = parseInt(t.dataset.eq, 10);
        handleEqBand(idx, parseFloat(t.value));
        const out = panel.querySelector(`[data-eq-output="${idx}"]`);
        if (out) out.textContent = fmtDb(parseFloat(t.value));
      }
    });
    panel.addEventListener("change", (e) => {
      const t = e.target;
      if (t.dataset.exportPick) {
        // 내보내기 선택 체크박스. (다른 토글 분기로 떨어지지 않도록 먼저 처리)
        toggleExportPick(t.dataset.exportPick, t.checked);
        return;
      }
      if (t.dataset.action === "power") {
        // 사용자가 직접 끄면 이 채널은 '항상 켜기' 자동 활성화에서 제외(opt-out).
        // 다시 켜면 해제. per-channel로 저장돼 새로고침 후에도 의사 유지.
        state.userDisabled = !t.checked;
        setEnabled(t.checked);
      } else if (t.dataset.action === "comp-toggle") {
        state.comp.enabled = t.checked;
        enterCustomFromEdit();
        reconcileDirtyAgainstBase();
        applyState();
        commitUserEditToChannelBase();
        saveState();
        syncUI();
      } else if (t.dataset.action === "limiter-toggle") {
        state.limiter.enabled = t.checked;
        enterCustomFromEdit();
        reconcileDirtyAgainstBase();
        applyState();
        commitUserEditToChannelBase();
        saveState();
        syncUI();
      } else if (t.dataset.action === "normalizer-toggle") {
        state.normalizer.enabled = t.checked;
        enterCustomFromEdit();
        reconcileDirtyAgainstBase();
        // 노멀라이저는 rAF 루프가 normGain을 조정한다(applyState 불필요).
        commitUserEditToChannelBase();
        saveState();
        syncUI();
      }
    });
  }

  function isEditableMixerTarget(target) {
    return Boolean(
      target?.closest?.(
        ".cheese-audio-mixer-panel input, .cheese-audio-mixer-panel textarea, .cheese-audio-mixer-panel select",
      ),
    );
  }

  function stopMixerEditableShortcutLeak(e) {
    if (!isEditableMixerTarget(e.target)) return;
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function handleCustomPresetAction(panel, button) {
    const action = button.dataset.action;
    if (!action?.startsWith("custom-")) return false;
    const id = button.dataset.customId;
    if (action === "custom-new") {
      openCustomPresetCreator();
      return true;
    }
    if (action === "custom-export-open") {
      openCustomExport();
      return true;
    }
    if (action === "custom-import-open") {
      openCustomImport();
      return true;
    }
    if (action === "custom-share-close") {
      closeCustomShare();
      return true;
    }
    if (action === "custom-export-selectall") {
      toggleExportSelectAll();
      return true;
    }
    if (action === "custom-export-copy") {
      copyExportJson();
      return true;
    }
    if (action === "custom-import-confirm") {
      confirmCustomImport(panel);
      return true;
    }
    if (action === "custom-mode-select") {
      const picker = button.closest(".cheese-mixer-mode-picker");
      picker
        ?.querySelectorAll(".cheese-mixer-mode-option")
        .forEach((option) => {
          const selected = option === button;
          option.classList.toggle("is-active", selected);
          option.setAttribute("aria-checked", String(selected));
        });
      return true;
    }
    if (action === "custom-create-start") {
      startCustomPresetFromForm(panel);
      return true;
    }
    if (action === "custom-create-cancel") {
      closeCustomPresetCreator();
      return true;
    }
    if (action === "custom-apply" && id) {
      applyCustomPreset(id);
      return true;
    }
    if (action === "custom-edit" && id) {
      openCustomDialog("edit", id);
      return true;
    }
    if (action === "custom-delete" && id) {
      openCustomDialog("delete", id);
      return true;
    }
    if (action === "custom-set-default" && id) {
      setDefaultCustomPreset(id);
      return true;
    }
    if (action === "custom-unset-default") {
      unsetDefaultCustomPreset();
      return true;
    }
    if (action === "custom-edit-confirm" && id) {
      confirmCustomPresetEdit(panel, id);
      return true;
    }
    if (action === "custom-delete-confirm" && id) {
      customDialog = null;
      deleteCustomPreset(id);
      return true;
    }
    if (action === "custom-dialog-cancel") {
      closeCustomDialog();
      return true;
    }
    if (action === "custom-draft-save") {
      saveCustomDraft();
      return true;
    }
    if (action === "custom-draft-cancel") {
      cancelCustomDraft();
      return true;
    }
    return false;
  }

  // info 아이콘 설명 팝오버 ───────────────────────────────────────────────
  // 팝오버는 body에 fixed로 띄워 패널 overflow에 잘리지 않게 한다.
  function toggleInfoPopover(panel, infoBtn) {
    const key = infoBtn.dataset.info;
    const existing = document.querySelector(".cheese-mixer-info-popover");
    // 같은 아이콘을 다시 누르면 닫기(토글)
    if (existing && existing.dataset.for === key) {
      closeInfoPopover(panel);
      return;
    }
    closeInfoPopover(panel);
    const text = INFO_TEXT[key];
    if (!text) return;

    const pop = document.createElement("div");
    pop.className = "cheese-mixer-info-popover";
    pop.dataset.for = key;
    pop.textContent = text;
    document.body.appendChild(pop);

    // 플레이어 패널 overflow에 잘리지 않도록 body에 fixed로 띄운다.
    const iconRect = infoBtn.getBoundingClientRect();
    let left = iconRect.left;
    const maxLeft = window.innerWidth - pop.offsetWidth - 12;
    left = Math.max(8, Math.min(left, Math.max(8, maxLeft)));
    pop.style.left = `${left}px`;

    const spaceBelow = window.innerHeight - iconRect.bottom;
    const above = INFO_ABOVE.has(key) || spaceBelow < pop.offsetHeight + 12;
    if (above) {
      const top = iconRect.top - pop.offsetHeight - 6;
      pop.style.top = `${top}px`;
      pop.classList.add("is-above");
    } else {
      const top = iconRect.bottom + 6;
      pop.style.top = `${top}px`;
    }
    infoBtn.setAttribute("aria-expanded", "true");
  }

  function closeInfoPopover(panel) {
    const pop = document.querySelector(".cheese-mixer-info-popover");
    if (pop) {
      panel
        ?.querySelector(`.cheese-mixer-info[data-info="${pop.dataset.for}"]`)
        ?.setAttribute("aria-expanded", "false");
      document
        .querySelector(`.cheese-mixer-info[data-info="${pop.dataset.for}"]`)
        ?.setAttribute("aria-expanded", "false");
      pop.remove();
    }
  }

  // 고급 그룹 슬라이더 값을 밴드별 가중치로 EQ에 반영한다.
  function applyEqGroup(groupKey, value) {
    const g = EQ_GROUPS[groupKey];
    if (!g) return;
    g.bands.forEach((band, i) => {
      state.eq[band] = Math.round(value * g.weights[i] * 10) / 10;
    });
  }

  function handleSlider(key, value) {
    switch (key) {
      case "gain":
        state.gain = clampGain(value);
        break;
      case "bass":
        applyEqGroup("bass", value);
        break;
      case "treble":
        applyEqGroup("treble", value);
        break;
      case "clarity":
        applyEqGroup("clarity", value);
        break;
      case "comp-threshold":
        state.comp.threshold = value;
        break;
      case "comp-knee":
        state.comp.knee = value;
        break;
      case "comp-ratio":
        state.comp.ratio = value;
        break;
      case "comp-attack":
        state.comp.attack = value;
        break;
      case "comp-release":
        state.comp.release = value;
        break;
      case "comp-makeup":
        state.comp.makeup = value;
        break;
      case "limiter-threshold":
        state.limiter.threshold = value;
        break;
      case "normalizer-target":
        state.normalizer.target = value;
        break;
      default:
        return;
    }
    enterCustomFromEdit();
    reconcileDirtyAgainstBase(); // 값이 원래 프리셋과 같아지면 dirty 해제
    applyState();
    syncPresetSelection();
    syncHead();
    syncMasterGain();
    commitUserEditToChannelBase(); // 직접 조절 = 이 채널의 새 원본
    saveState();
  }

  // 사용자가 슬라이더/EQ를 직접 조절하면, 그 값이 '이 채널의 원본 선택'이 된다.
  // 전역 기본값이 켜져 있으면 serializeState가 channelBaseState를 저장하므로, 여기서
  // 갱신하지 않으면 직접 조절한 값이 저장되지 않고 유실된다(전역값/이전값으로 덮임).
  function commitUserEditToChannelBase() {
    channelBaseState = snapshotChannelPreset();
    state.userPickedPreset = true; // 이 채널은 사용자가 직접 정함(전역값에 안 덮이게)
  }

  function handleEqBand(index, value) {
    state.eq[index] = value;
    enterCustomFromEdit();
    reconcileDirtyAgainstBase(); // 값이 원래 프리셋과 같아지면 dirty 해제
    applyState();
    syncPresetSelection();
    syncHead();
    commitUserEditToChannelBase(); // 직접 조절 = 이 채널의 새 원본
    saveState();
  }

  function switchTab(panel, name) {
    if (!panel || !name) return;
    activeTab = name;
    customDialog = null;
    // 탭을 떠나면 내보내기/불러오기 UI도 닫는다(상태가 다른 탭으로 따라오지 않게).
    customExportOpen = false;
    customImportOpen = false;
    customShareMsg = null;
    closeInfoPopover(panel);
    panel
      .querySelectorAll(".cheese-mixer-tab")
      .forEach((t) => t.classList.toggle("is-active", t.dataset.tab === name));
    panel
      .querySelectorAll(".cheese-mixer-pane")
      .forEach((p) => p.classList.toggle("is-active", p.dataset.pane === name));
    syncUI();
  }

  // 슬라이더 key → 현재 state 값. handleSlider와 짝을 이룬다.
  function sliderValue(key) {
    switch (key) {
      case "gain":
        return state.gain;
      // 그룹의 대표 밴드(가중치 1.0)를 표시값으로 쓴다.
      case "bass":
        return state.eq[0];
      case "treble":
        return state.eq[8];
      case "clarity":
        return state.eq[4];
      case "comp-threshold":
        return state.comp.threshold;
      case "comp-knee":
        return state.comp.knee;
      case "comp-ratio":
        return state.comp.ratio;
      case "comp-attack":
        return state.comp.attack;
      case "comp-release":
        return state.comp.release;
      case "comp-makeup":
        return state.comp.makeup ?? 0;
      case "limiter-threshold":
        return state.limiter.threshold;
      case "normalizer-target":
        return state.normalizer.target;
      default:
        return null;
    }
  }

  // 내장·커스텀 프리셋의 선택 표시만 가볍게 갱신한다. 슬라이더 드래그 중에도
  // 부를 수 있도록 슬라이더/EQ는 건드리지 않는다(값 튐 방지).
  function syncPresetSelection() {
    const panel = ui?.panel;
    if (!panel) return;
    panel
      .querySelectorAll(".cheese-mixer-preset")
      .forEach((b) =>
        b.classList.toggle("is-active", b.dataset.preset === state.preset),
      );
    // 커스텀 프리셋의 활성 표시는 .cheese-mixer-custom-select에 걸린다(CSS도
    // 이 요소를 스타일링). 내부 custom-apply 버튼의 custom-id로 현재 프리셋과
    // 비교한다.
    panel.querySelectorAll(".cheese-mixer-custom-select").forEach((el) => {
      const id = el.querySelector("[data-action='custom-apply']")?.dataset
        .customId;
      el.classList.toggle("is-active", Boolean(id) && id === state.preset);
    });
  }

  // 버튼의 마스터 음량 슬라이더를 현재 게인과 동기화(드래그 중이면 건드리지 않음).
  function syncMasterGain() {
    const slider = document.querySelector(
      `.${CONTROL_CLASS} [data-master-gain]`,
    );
    if (!slider) return;
    // 슬라이더는 믹서 활성화 시에만 노출(native는 display로 토글).
    slider.style.display = state.enabled ? "" : "none";
    if (!gainDragging) updateGainSliderVisual(slider);
  }

  // 버튼 툴팁/aria-label에 적용 중인 프리셋을 병기한다.
  //  - 꺼짐: "오디오 믹서"
  //  - 실제 프리셋 적용 중: "오디오 믹서 (OOO)"
  //  - 프리셋을 수정한 상태(저장 안 함/게인 슬라이더 조절 포함): "오디오 믹서  (수정된 OOO)"
  //  - 베이스 프리셋 없이 직접 설정한 상태: "오디오 믹서 (사용자 설정)"
  function mixerButtonLabel() {
    const base = "오디오 믹서";
    // 꺼짐 상태에는 단축키를 병기해 기능(과 토글 방법)이 있음을 알린다.
    if (!state.enabled) return `${base} (Shift+A)`;
    if (presetDirty) {
      return dirtyFromName
        ? `${base} (수정된 ${dirtyFromName})`
        : `${base} (사용자 설정)`;
    }
    const name = presetDisplayName(state.preset);
    if (name) return `${base} (${name})`;
    return `${base} (사용자 설정)`;
  }

  function syncMixerButtonLabel() {
    const button = document.querySelector(`.${BUTTON_CLASS}`);
    if (!button) return;
    const label = mixerButtonLabel();
    button.setAttribute("aria-label", label);
    const tip = button.querySelector(".pzp-button__tooltip");
    if (tip) tip.textContent = label;
  }

  function syncUI() {
    const button = document.querySelector(`.${BUTTON_CLASS}`);
    button?.classList.toggle("is-active", state.enabled);
    button?.setAttribute("aria-pressed", String(state.enabled));
    syncMixerButtonLabel();
    syncMasterGain();

    const panel = ui?.panel;
    if (!panel) return;

    // head(프리셋 추가 버튼/전원 토글 포함)를 현재 상태로 갱신.
    syncHead();

    syncPresetSelection();

    // 고급/전문가 슬라이더와 output을 현재 state로 갱신(프리셋·복원 반영).
    // output은 같은 행에서만 찾는다(gain 등 중복 key가 두 탭에 있어도 안전).
    panel.querySelectorAll("[data-slider]").forEach((input) => {
      const v = sliderValue(input.dataset.slider);
      if (v == null) return;
      input.value = v;
      const out = input
        .closest(".cheese-mixer-row")
        ?.querySelector("[data-output]");
      if (out) out.textContent = fmtNum(v);
    });

    // 전문가 EQ 슬라이더 + 값 표시 갱신
    panel.querySelectorAll("[data-eq]").forEach((input) => {
      const i = parseInt(input.dataset.eq, 10);
      if (Number.isInteger(i) && state.eq[i] != null) {
        input.value = state.eq[i];
        const out = panel.querySelector(`[data-eq-output="${i}"]`);
        if (out) out.textContent = fmtDb(state.eq[i]);
      }
    });

    // 노멀라이저/컴프레서/리미터 토글 갱신
    const normToggle = panel.querySelector('[data-action="normalizer-toggle"]');
    if (normToggle) normToggle.checked = state.normalizer.enabled;
    const compToggle = panel.querySelector('[data-action="comp-toggle"]');
    if (compToggle) compToggle.checked = state.comp.enabled;
    const limiterToggle = panel.querySelector('[data-action="limiter-toggle"]');
    if (limiterToggle) limiterToggle.checked = state.limiter.enabled;
  }

  // 믹서 버튼 클릭을 document 레벨 위임으로 처리한다. 라이브 플레이어가 컨트롤
  // DOM을 재렌더링하며 버튼을 옮기거나 복제해도(첫 로드 시 클릭이 안 먹던 원인)
  // 항상 토글이 동작한다.
  document.addEventListener("click", (e) => {
    // 마스터 음량 슬라이더 클릭은 패널 토글로 이어지지 않게 막는다.
    if (e.target.closest?.("[data-master-gain]")) {
      e.stopPropagation();
      return;
    }
    const btn = e.target.closest?.(`.${BUTTON_CLASS}`);
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      // ⚠ 마우스 클릭 후 버튼에 포커스가 남으면, 이후 스페이스(재생/일시정지 습관)가
      // 브라우저의 '포커스된 버튼 활성화'로 click 을 합성해 믹서가 저절로 켜졌다
      // ('클릭 시 바로 켜기' 옵션 사용자 피드백). 그 키보드 유발 클릭만 무시한다.
      // ⚠ 예전엔 detail===0 만으로 걸렀는데, 스크린리더/음성제어/일부 트랙패드·펜 입력은
      // '진짜 클릭'인데도 detail===0 이라 클릭이 통째로 무시돼(패널이 안 열림) 버렸다.
      // 키보드 합성 클릭은 detail===0 '이면서' 좌표가 전부 0 이다(포인터 위치 없음).
      // 이 버튼은 컨트롤바 안에 있어 실제 클릭이 (0,0)일 수 없으므로 좌표까지 봐서 구분한다.
      const keyboardSynth =
        e.detail === 0 &&
        e.isTrusted &&
        e.screenX === 0 &&
        e.screenY === 0 &&
        e.clientX === 0 &&
        e.clientY === 0;
      if (keyboardSynth) {
        btn.blur();
        return;
      }
      handleMixerButtonClick();
      btn.blur();
      return;
    }
    // 패널이 열려 있고, 버튼·패널 바깥을 '사용자가' 클릭하면 닫는다. 합성 클릭
    // (isTrusted=false)은 무시한다 — 팔로잉 자동 새로고침 등 코드가 쏘는 .click()이
    // document로 전파돼 패널이 저절로 닫히던 문제를 막는다.
    if (!e.isTrusted) return;
    const panel = ui?.panel;
    if (panel && !e.target.closest?.(`#${PANEL_ID}`)) {
      closePanel();
    }
  });

  // 마스터 음량 슬라이더(native div 구조) 드래그 처리. 세로 슬라이더이므로 위쪽이
  // 큰 값. pointer 위치를 0~1로 정규화해 게인으로 변환.
  let gainDragging = false;
  let gainDragTarget = null;
  function gainFromPointer(slider, clientX) {
    const wrap = slider.querySelector(".pzp-ui-slider__wrap") || slider;
    const rect = wrap.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const n = (clientX - rect.left) / rect.width; // 왼=0, 오른=1
    return normToGain(Math.max(0, Math.min(1, n)));
  }
  function applyGainFromPointer(slider, clientX) {
    const g = gainFromPointer(slider, clientX);
    if (g == null) return;
    handleSlider("gain", g);
    updateGainSliderVisual(slider);
  }
  function updateGainSliderVisual(slider) {
    const n = gainToNorm(state.gain);
    const vol = slider.querySelector(".pzp-ui-progress__volume");
    if (vol) vol.style.setProperty("--pzp-ui-progress__scale", String(n));
    const handle = slider.querySelector(".pzp-ui-slider__handler-wrap");
    if (handle) handle.style.left = `${Math.round(n * 1000) / 10}%`;
    slider.setAttribute("aria-valuenow", String(Math.round(n * 100)));
    // 게인 툴팁은 실제 게인(0.5~2.0)을 %로 표시(100%=원본). 텍스트만 갱신.
    // 툴팁은 슬라이더 형제(래퍼 직속)이므로 래퍼에서 찾는다.
    const tip = gainTooltipOf(slider);
    if (tip) {
      const next = `${Math.round(state.gain * 100)}%`;
      if (tip.textContent !== next) tip.textContent = next;
    }
  }
  // 게인 슬라이더 툴팁 표시 제어. 음량 슬라이더와 동일 동작: 호버 중엔 계속 표시,
  // 벗어나면 잠시 뒤 숨김. 이미 보이는 중엔 is-visible을 다시 안 붙여 떨림 방지.
  let gainTooltipHideTimer = 0;
  let gainTooltipHovering = false;
  function gainTooltipOf(slider) {
    // 툴팁은 슬라이더 형제(래퍼 .cheese-audio-mixer-control 직속)에 있다.
    const wrap = slider?.closest?.(`.${CONTROL_CLASS}`);
    return wrap?.querySelector?.("[data-gain-tooltip]") || null;
  }
  function showGainTooltip(slider) {
    const tip = gainTooltipOf(slider);
    if (!tip) return;
    updateGainSliderVisual(slider); // 텍스트(슬라이더 채움 등) 최신화는 유지
    if (!gainPctOn) {
      // % 표시 끔 → 툴팁만 숨긴다(슬라이더 시각은 위에서 갱신됨).
      tip.classList.remove("is-visible");
      return;
    }
    if (!tip.classList.contains("is-visible")) tip.classList.add("is-visible");
    scheduleGainTooltipHide(tip);
  }
  function scheduleGainTooltipHide(tip) {
    if (gainTooltipHideTimer) {
      clearTimeout(gainTooltipHideTimer);
      gainTooltipHideTimer = 0;
    }
    if (gainTooltipHovering || gainDragging) return; // 호버/드래그 중엔 유지
    gainTooltipHideTimer = setTimeout(() => {
      tip.classList.remove("is-visible");
      gainTooltipHideTimer = 0;
    }, VOLUME_TOOLTIP_HIDE_MS);
  }

  document.addEventListener("pointerdown", (e) => {
    const slider = e.target.closest?.("[data-master-gain]");
    if (!slider) return;
    e.preventDefault();
    e.stopPropagation();
    gainDragging = true;
    gainDragTarget = slider;
    applyGainFromPointer(slider, e.clientX);
    showGainTooltip(slider);
  });
  document.addEventListener("pointermove", (e) => {
    if (!gainDragging || !gainDragTarget) return;
    applyGainFromPointer(gainDragTarget, e.clientX);
    showGainTooltip(gainDragTarget);
  });
  document.addEventListener("pointerup", () => {
    const target = gainDragTarget;
    gainDragging = false;
    gainDragTarget = null;
    // 드래그 끝나면 호버 아닐 때 숨김 예약.
    const tip = gainTooltipOf(target);
    if (tip) scheduleGainTooltipHide(tip);
  });
  // 호버 표시(delegation: 슬라이더가 버튼과 함께 재생성돼도 동작).
  document.addEventListener("mouseover", (e) => {
    const slider = e.target.closest?.("[data-master-gain]");
    if (!slider) return;
    gainTooltipHovering = true;
    showGainTooltip(slider);
  });
  document.addEventListener("mouseout", (e) => {
    const slider = e.target.closest?.("[data-master-gain]");
    if (!slider) return;
    // 슬라이더 내부 요소 간 이동은 무시(관련 타깃이 여전히 슬라이더 안).
    if (slider.contains(e.relatedTarget)) return;
    gainTooltipHovering = false;
    const tip = gainTooltipOf(slider);
    if (tip) scheduleGainTooltipHide(tip);
  });

  function handleUserGestureForAudioContext() {
    // 첫 제스처 기록 → '항상 켜기' 자동 활성화 조건 충족. 다음 틱에 시도(현재
    // 이벤트 디스패치를 막지 않도록 setTimeout 0).
    if (!userGestureSeen) {
      userGestureSeen = true;
      window.setTimeout(() => maybeAutoEnableMixer(), 0);
    }
    if (!state.enabled) return;
    // 제스처가 있는 지금이 AudioContext를 만들/재개할 유일한 기회다. 이미 연결돼
    // 있어도 컨텍스트가 멈췄으면 재개하고, 연결이 끊겼으면(재진입·PIP 등) 재연결한다.
    // (audio.connected면 조기 return하던 것을 완화 — 그래서 컨텍스트가 죽은 채로
    // 남아 음소거/해제를 한 번 더 해야 걸리던 문제를 줄인다.)
    if (audio.connected && audio.ctx && audio.ctx.state !== "running") {
      audio.ctx.resume().catch(() => {});
    }
    if (!audio.connected) {
      window.setTimeout(() => ensureEnabledGraph(), 0);
    }
  }

  document.addEventListener(
    "pointerdown",
    handleUserGestureForAudioContext,
    true,
  );
  document.addEventListener("keydown", handleUserGestureForAudioContext, true);

  // 클릭/키 제스처 없이 진입해도(직전 페이지 클릭으로 자동재생 허용된 경우 등) 방송이
  // 재생되면 AudioContext resume 을 시도한다. 자동재생 정책이 허용하면 resume 이 성공해
  // (state=running) 클릭 없이도 '항상 켜기' 믹서가 걸리고, 허용 안 되면 조용히 실패해
  // 기존처럼 첫 클릭을 기다린다(무해). SPA 로 video 가 교체돼도 매번 새로 바인딩한다.
  // 클릭 없이 자동 활성이 필요한 상황: '항상 켜기'(mixerAlwaysOn) 또는 이 채널에 저장된
  // enabled=true(사용자가 예전에 켠 채널). 둘 다 저장 프리셋 로드(stateLoaded) 후 판단.
  function wantsAutoEnable() {
    if (userGestureSeen) return false;
    if (state.userDisabled) return false; // 이 채널은 직접 끔
    if (mixerAlwaysOn) return true;
    return stateLoaded && state.enabled === true; // 저장된 켠 상태
  }
  const boundAutoEnableVideos = new WeakSet();
  // 자동재생이 이미 허용됐는지 추정: video가 소리를 내며 재생 중이거나 navigator의
  // 사용자 활성화가 있으면 AudioContext가 running 으로 생성돼 콘솔 경고가 안 뜬다.
  function autoplayLikelyAllowed(video) {
    if (navigator.userActivation?.isActive) return true;
    return !!(video && !video.paused && !video.muted && video.volume > 0);
  }
  function tryAutoEnableFromPlayback(video) {
    if (!wantsAutoEnable()) return;
    if (state.enabled && audio.connected) return;
    // 제스처 없이 AudioContext를 '새로' 만들면 자동재생 정책 경고가 콘솔에 찍힌다.
    // 이미 컨텍스트가 있으면 resume만 시도하고, 없으면 '자동재생이 허용된 것으로
    // 보일 때'(소리 재생 중/사용자 활성화)만 생성한다 → 실패할 환경에선 만들지 않아
    // 경고가 안 남고, 첫 클릭의 handleUserGestureForAudioContext가 생성/resume한다.
    if (!audio.ctx) {
      if (!autoplayLikelyAllowed(video)) return;
      try {
        audio.ctx = new AudioContext();
      } catch {
        return;
      }
    }
    try {
      const proceed = () => {
        if (audio.ctx && audio.ctx.state === "running") {
          userGestureSeen = true; // resume 성공 = 오디오 시작 가능 상태
          // 항상 켜기면 maybeAutoEnableMixer, 저장된 enabled면 그래프만 복원.
          if (mixerAlwaysOn) maybeAutoEnableMixer();
          if (state.enabled && !audio.connected) ensureEnabledGraph();
        }
      };
      if (audio.ctx.state === "running") {
        proceed();
      } else {
        audio.ctx
          .resume()
          .then(proceed)
          .catch(() => {});
      }
    } catch {}
  }
  function bindVideoAutoEnable() {
    if (!wantsAutoEnable()) return;
    const video = findVideo();
    if (!(video instanceof HTMLVideoElement)) return;
    if (!boundAutoEnableVideos.has(video)) {
      boundAutoEnableVideos.add(video);
      video.addEventListener("playing", () => tryAutoEnableFromPlayback(video));
    }
    if (!video.paused && video.readyState >= 2)
      tryAutoEnableFromPlayback(video);
  }
  window.addEventListener("keydown", stopMixerEditableShortcutLeak, true);
  window.addEventListener("keyup", stopMixerEditableShortcutLeak, true);
  window.addEventListener("keypress", stopMixerEditableShortcutLeak, true);
  window.addEventListener("scroll", () => closeInfoPopover(ui?.panel), true);

  // ══ 스트림 정보 (비디오/오디오 통계) ═══════════════════════════════════════
  // 재생바 우측 버튼 앞에 정보 아이콘을 두고, 클릭 시 해상도/FPS/비트레이트/코덱/
  // 레이턴시(라이브)와 오디오 정보를 보여준다. 값은 치지직 내부 플레이어 객체
  // (React fiber의 _corePlayer)에서 얻는다.
  function getReactFiber(node) {
    if (!node) return null;
    const key = Object.keys(node).find((k) => k.startsWith("__reactFiber$"));
    return key ? node[key] : null;
  }

  function findCorePlayer() {
    const node =
      document.getElementById("live_player_layout") ||
      document.getElementById("player_layout") ||
      findPlayer();
    let fiber = getReactFiber(node);
    if (!fiber) return null;
    fiber = fiber.return;
    let guard = 0;
    while (fiber && guard++ < 2000) {
      let state = fiber.memoizedState;
      while (state) {
        let value = state.memoizedState;
        if (state.queue?.pending?.hasEagerState) {
          value = state.queue.pending.eagerState;
        } else if (state.baseQueue?.hasEagerState) {
          value = state.baseQueue.eagerState;
        }
        if (value && value._corePlayer) return value._corePlayer;
        state = state.next;
      }
      fiber = fiber.return;
    }
    return null;
  }

  // ── 최대 화질 자동 고정 ────────────────────────────────────────────────────
  // corePlayer.videoTracks 에서 고정 화질(abr/자동 제외) 중 가장 높은 height 트랙에
  // selected=true 를 직접 설정한다(공개 setQuality API 가 없어 이 방식이 유효함을 확인).
  // 이미 그 화질이 선택돼 있으면 아무것도 안 한다(멱등 → 불필요한 개입/재요청 방지).
  function trackHeight(t) {
    const h = Number(t?.height ?? t?._height);
    return Number.isFinite(h) ? h : 0;
  }
  function trackIsAbr(t) {
    const q = String(
      t?._videoQuality || t?.encodingOptionID || t?.label || "",
    ).toLowerCase();
    return q.includes("abr") || q.includes("auto") || q.includes("자동");
  }
  function trackSelected(t) {
    return !!(t?.selected || t?._selected);
  }

  // 화질 메뉴 항목(li) prefix 텍스트에서 height 파싱("1080p(원본)"→1080, "자동"→0).
  function qualityItemHeight(li) {
    const txt = String(
      li?.querySelector?.(".pzp-ui-setting-quality-item__prefix")
        ?.textContent || "",
    );
    if (/auto|자동|abr/i.test(txt)) return 0;
    const m = txt.match(/(\d{3,4})\s*p/i);
    return m ? Number(m[1]) : 0;
  }
  // 화질 메뉴에서 '최고 화질 항목이 이미 선택(--checked)돼 있는지'.
  function isMaxQualityMenuChecked() {
    const list = document.querySelector(
      ".pzp-setting-quality-pane__list-container",
    );
    if (!list) return false;
    let bestLi = null;
    let bestH = 0;
    for (const li of list.querySelectorAll("li.pzp-ui-setting-quality-item")) {
      const h = qualityItemHeight(li);
      if (h > bestH) {
        bestH = h;
        bestLi = li;
      }
    }
    return (
      !!bestLi && bestLi.classList.contains("pzp-ui-setting-pane-item--checked")
    );
  }
  let maxQualityMenuClickAt = 0; // 마지막 메뉴 클릭 시각(중복 클릭 억제)
  // 최고 화질 메뉴 항목(li)을 클릭해 치지직의 정상 화질 변경 경로를 태운다. 이 경로만이
  // 그리드(P2P) 초기화를 정상 실행한다(실측: selected=true 직접 설정은 그리드가 안 붙어
  // Windows 지연 8~10초, 클론 교체 클릭은 그리드 정상+화질 전환+컨트롤바 유지 모두 확인).
  //
  // 클론 교체 트릭: 원본 li 를 클론으로 잠깐 대체해 DOM 에서 빼고, DOM 밖 원본을 .click()
  // 한 뒤 다음 프레임에 원복한다. 이렇게 해야 (a) 치지직이 이 합성 클릭을 정상 화질 변경
  // 으로 처리하고(그리드 포함), (b) 화질 메뉴 UI 가 열리는 부작용을 감춘다. 메뉴를 열고
  // 붙어있는 li 를 그냥 .click() 하면 무반응이다(실측) — 클론 교체가 핵심.
  // 성공(클릭 실행/이미 최고) 시 true.
  function clickMaxQualityMenuItem() {
    const list = document.querySelector(
      ".pzp-setting-quality-pane__list-container",
    );
    if (!list) return false;
    let bestLi = null;
    let bestH = 0;
    for (const li of list.querySelectorAll("li.pzp-ui-setting-quality-item")) {
      const h = qualityItemHeight(li);
      if (h > bestH) {
        bestH = h;
        bestLi = li;
      }
    }
    if (!bestLi || bestH <= 0) return false;
    // 이미 최고 항목이 체크돼 있으면 클릭하지 않는다(멱등).
    if (bestLi.classList.contains("pzp-ui-setting-pane-item--checked"))
      return true;
    // 클릭 직후~--checked 반영 전 사이에 tick/이벤트가 또 클릭하지 않도록 짧게 억제.
    if (Date.now() - maxQualityMenuClickAt < 1500) return true;
    try {
      const parent = bestLi.parentElement;
      if (parent) {
        const clone = bestLi.cloneNode(true);
        parent.replaceChild(clone, bestLi); // 원본을 클론으로 대체(원본은 DOM 밖)
        bestLi.click(); // DOM 밖 원본 클릭 → 정상 화질 변경 경로(그리드 포함)
        requestAnimationFrame(() => {
          try {
            if (clone.parentElement === parent)
              parent.replaceChild(bestLi, clone); // 원복
          } catch {}
        });
      } else {
        bestLi.click();
      }
      maxQualityMenuClickAt = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  // 수동 화질 존중: 사용자가 이 미디어에서 직접 낮은 고정 화질을 고르면 그 뒤론 다시
  // 최고로 올리지 않는다. 미디어(currentPageKey)가 바뀌면 리셋된다.
  let maxQualitySetHeight = 0; // 우리가 마지막으로 고정한 height
  let maxQualityRespectedPage = null; // 사용자 수동 선택을 존중하기로 한 미디어 키
  function applyMaxQuality() {
    if (!maxQualityAuto) return;
    // 백그라운드(숨김) 탭에는 최대화질을 강제하지 않는다. 여러 방송 탭을 켜두는 사용자의
    // 경우, 모든 탭을 1080p60(≈8Mbps)으로 강제하면 대역폭·디코드·미디어 메모리가 탭 수만큼
    // 증폭돼 시스템 메모리 폭증 + 간헐적 수 초 버퍼링을 유발했다(실사용 계측: JS 힙/버퍼는
    // 정상인데 탭당 렌더러 1GB+ = 미디어 파이프라인 부하). 숨김 탭은 치지직 기본 ABR 에
    // 맡기고, 탭이 다시 보이면 timeupdate/tick 경로가 이 함수를 다시 불러 그때 최대화질을
    // 건다(가시 탭만 최대화질).
    if (document.hidden) return;
    // 재생이 아직 시작되지 않았거나(자동재생 대기/사용자 제스처 전) 준비 전이면 개입하지
    // 않는다. 이 시점에 화질을 전환(스트림 재초기화)하면 플레이어 초기화가 깨진다.
    //
    // 안전 게이트: paused=false + readyState>=3 + currentTime>=안정시간 + 플레이어가
    // 'beforeplay/loading 국면이 아님'.
    //  1) currentTime=0(첫 playing 직후)에 전환하면 재생 파이프라인이 끊겨 video 가
    //     readyState=0 으로 죽는다.
    //  2) 결정적: 라이브 입장 시 치지직 플레이어는 재생이 진행돼도(currentTime≈28,
    //     readyState=4) 한동안 루트(.pzp-pc)에 `pzp-pc--beforeplay`/`--loading` 클래스를
    //     유지한다. 이 국면에서 화질을 전환하면(selected=true 든 메뉴 클릭이든) 플레이어가
    //     통째로 재초기화되며 video 가 죽고(readyState=0) 컨트롤바가 사라진다(후킹 로그로
    //     확정: 1080p selected=true 시점 before 가 beforeplay:true·loading:true, 100ms 뒤
    //     readyState=0). currentTime 임계만으론 이 국면을 못 걸러냈다 → beforeplay/loading
    //     클래스가 사라진(=플레이어가 재생 안정 상태) 뒤에만 전환한다.
    // 이벤트(timeupdate)로 계속 재시도하므로, 이 조건을 만족하는 첫 순간 바로 걸린다.
    const MAX_QUALITY_MIN_PLAYED = 1.5;
    const video = findVideo();
    if (
      !video ||
      video.paused ||
      video.readyState < 3 ||
      !(video.currentTime >= MAX_QUALITY_MIN_PLAYED)
    )
      return;
    // 플레이어가 아직 입장 로딩 국면(beforeplay/loading)이면 전환을 미룬다.
    const pzp = findPlayer();
    if (
      pzp &&
      (pzp.classList.contains("pzp-pc--beforeplay") ||
        pzp.classList.contains("pzp-pc--loading"))
    ) {
      return;
    }
    const core = findCorePlayer();
    if (!core) return;
    const tracks = Array.from(core.videoTracks || []);
    if (!tracks.length) return;
    // 고정 화질(abr 제외) 중 최고 height. 없으면(전부 abr) 개입 안 함.
    const fixed = tracks.filter((t) => !trackIsAbr(t) && trackHeight(t) > 0);
    if (!fixed.length) return;
    let best = fixed[0];
    for (const t of fixed) if (trackHeight(t) > trackHeight(best)) best = t;
    const bestH = trackHeight(best);
    const selected = tracks.find((t) => trackSelected(t));
    const selH = selected && !trackIsAbr(selected) ? trackHeight(selected) : 0;

    // '수동 변경 존중' 옵션: 우리가 최고로 올려둔 상태(maxQualitySetHeight)에서 선택이
    // '더 낮은 고정 화질'로 바뀌었으면 = 사용자가 직접 낮춤 → 이 미디어 동안 존중.
    if (
      maxQualityRespectManual &&
      maxQualitySetHeight > 0 &&
      selected &&
      !trackIsAbr(selected) &&
      selH > 0 &&
      selH < maxQualitySetHeight
    ) {
      maxQualityRespectedPage = currentPageKey;
    }
    if (maxQualityRespectManual && maxQualityRespectedPage === currentPageKey) {
      return; // 이 미디어는 사용자가 고른 화질을 존중
    }

    // 이미 최고 고정 화질이면 손대지 않는다(멱등). 트랙 selected 반영이 늦어도, 화질
    // 메뉴상 최고 항목이 이미 체크돼 있으면 전환된 것이니 중복 클릭하지 않는다.
    if (selH >= bestH || isMaxQualityMenuChecked()) {
      maxQualitySetHeight = bestH;
      return;
    }
    // 화질 전환: 화질 메뉴 최고 항목을 '클론 교체 트릭'으로 클릭한다.
    //
    // 검증 히스토리(모두 실측):
    //  - 클론 교체 .click(): 치지직의 정상 화질 변경 경로를 타 그리드(P2P)까지 초기화되고,
    //    화질 전환·컨트롤바 유지도 정상(수동 1회 실행으로 확인: 480p→1080p, beforeplay=false,
    //    controls=true, 그리드 실행). 1.18.0 에서 쓰던 방식.
    //  - 붙어있는 li 를 그냥 .click()(클론 교체 없이): 무반응(화질 안 바뀜). 클론 교체가 핵심.
    //  - selected=true 직접 설정: 화질은 바뀌지만 정상 경로를 우회해 그리드가 안 붙고 지연이
    //    8~10초 남는다 → 클릭 실패 시의 폴백으로만 쓴다.
    //
    // 과거 이 방식이 컨트롤바를 깼던 건 클론 교체 자체가 아니라, 재초기화 과도 상태
    // (beforeplay/loading)에서 클릭이 걸렸기 때문이다. 위 안전 게이트(beforeplay/loading
    // 없음 + currentTime>=1.5)가 그 타이밍을 막으므로 이제 안전하다.
    if (!clickMaxQualityMenuItem()) {
      // 폴백: 메뉴를 못 찾는 등 클릭 실패 시 트랙 selected 직접 설정(그리드 미보장).
      try {
        best.selected = true;
      } catch {}
    }
    maxQualitySetHeight = bestH; // 우리가 올린 기준값 기록
    // 화질 전환은 스트림을 재초기화한다. 입장 후 480p 로 재생되던 중 전환하면 재초기화가
    // 라이브 엣지가 아니라 과거 지점에서 재개돼 지연이 남을 수 있다(실측). 라이브 페이지에
    // 한해 전환 뒤 따라잡기로 엣지에 복귀시킨다.
    if (currentPageKey && currentPageKey.startsWith("live:")) {
      scheduleMaxQualityLiveEdgeCatchup();
    }
  }

  // 화질 전환 뒤 라이브 엣지 복귀. 전환 직후엔 스트림이 아직 재초기화 중이라 seek 이
  // 안 먹을 수 있어, 짧은 간격으로 몇 번 재시도하며 '지연이 충분히 줄면' 종료한다.
  // 미디어 전환/기능 해제 시 다음 tick 의 currentPageKey 검사로 자연 소진된다.
  let maxQualityCatchupTimer = 0;
  // 화질 전환 뒤 라이브 엣지 복귀.
  //
  // 계측 로그로 확인한 사실: 화질 전환(스트림 재초기화)은 새 타임라인을 currentTime≈0
  // 으로 다시 시작하는데, 그 시작점이 '현재 라이브 엣지'가 아니라 '수십 초 전 버퍼
  // 시작점'일 수 있다(비결정적: 5번 중 3번은 지연 ~30초, 2번은 3~4초).
  //
  // 처리: 재초기화가 안정돼 지연이 관측되기 시작하면, 기존 라이브 따라잡기(startSyncCatchUp)
  // 를 한 번 발동시킨다. 이 함수가 '큰 지연(SYNC_JUMP_LATENCY_S=12초 이상)이면 라이브 엣지로
  // 즉시 점프, 그 미만이면 1.5배속으로 목표(syncCfg.target)까지 부드럽게 따라잡기'를 이미
  // 다 한다(스톨 감지·안전 시간·컨트롤 유지 포함). 직접 seek 을 만들지 않고 검증된 경로를
  // 재사용한다 → 큰 지연만 점프, 중간 지연은 배속으로 자연스럽게(화면 급전환 최소화).
  //
  // 주의: 전환 직후엔 재초기화 중이라 currentTime/seekable/_getLiveLatency 가 null·0·출렁이는
  // 과도 상태다. 이 구간에 개입하면 무의미/역효과이므로, '재생이 진행 중이고 지연이 실제로
  // 관측될 때'까지 기다렸다가 발동한다.
  function scheduleMaxQualityLiveEdgeCatchup() {
    if (maxQualityCatchupTimer) return; // 이미 진행 중
    const startedPageKey = currentPageKey;
    let tries = 0;
    const MAX_TRIES = 16; // 재초기화 안정까지 넉넉히(약 12초)
    const FIRST_DELAY = 1500; // 재초기화가 끝나 지연이 관측되기 시작할 시간
    const RETRY_INTERVAL = 700;
    const step = () => {
      maxQualityCatchupTimer = 0;
      // 페이지가 바뀌었거나 기능이 꺼졌으면 중단.
      if (!maxQualityAuto || currentPageKey !== startedPageKey) return;
      const video = findVideo();
      const lat = getLiveLatencySeconds();
      // 아직 재초기화 과도 상태(지연 미관측/재생 정지/seekable 없음)면 기다린다.
      if (
        lat == null ||
        !video ||
        video.paused ||
        video.readyState < 3 ||
        !video.seekable?.length
      ) {
        if (++tries < MAX_TRIES) {
          maxQualityCatchupTimer = window.setTimeout(step, RETRY_INTERVAL);
        }
        return;
      }
      // 사용자가 되감기로 과거를 보는 중(hlsSeekLocked)이면 라이브로 끌어당기지 않는다
      // (화질 전환이 되감기 중에 트리거돼도 원점 복귀 방지).
      if (hlsSeekLocked) return;
      // 지연이 관측됨 → 따라잡기 발동(내부에서 점프/배속을 지연 크기에 따라 선택). 이미
      // 엣지 근처(lat < syncCfg.enable)면 startSyncCatchUp 이 스스로 no-op 한다.
      startSyncCatchUp();
      // 발동은 한 번이면 충분(startSyncCatchUp 이 목표까지 자체 루프로 따라잡는다).
    };
    maxQualityCatchupTimer = window.setTimeout(step, FIRST_DELAY);
  }

  // 최대 화질 고정을 '재생이 안정되는 즉시' 걸기 위해 video 이벤트에 바인딩한다.
  // 폴링 tick(주기적) 만 의존하면 최고화질 전환이 늦어 저화질 구간이 길어진다.
  // 핵심은 timeupdate — currentTime 이 0을 벗어나는 첫 순간(applyMaxQuality 의 안전
  // 게이트를 통과하는 가장 이른 시점)에 곧바로 호출돼 전환이 빨리 걸린다. playing/
  // loadeddata 는 게이트(currentTime>0)에 대부분 막히지만, 이미 진행 중인 영상에 늦게
  // 바인딩된 경우를 위한 보조 트리거로 함께 둔다. applyMaxQuality 는 멱등이라 이미
  // 최고화질이면 no-op(timeupdate 가 자주 와도 비용 미미).
  const boundMaxQualityVideos = new WeakSet();
  function bindMaxQualityEvents() {
    if (!maxQualityAuto) return;
    const video = findVideo();
    if (!(video instanceof HTMLVideoElement)) return;
    if (!boundMaxQualityVideos.has(video)) {
      boundMaxQualityVideos.add(video);
      // 이벤트 경로는 '진입 직후 최고화질을 빨리 걸기' 용도다. 한 번 걸고 나면
      // (maxQualitySetHeight>0) 이후 드리프트 보정은 tick 폴링이 담당하므로, timeupdate
      // (초당 여러 번)마다 applyMaxQuality 의 fiber 탐색(findCorePlayer)을 반복하지 않게
      // 조기 반환한다 — 여러 방송 탭을 켰을 때의 누적 CPU 부하를 줄인다.
      const onProgress = () => {
        if (maxQualitySetHeight > 0) return;
        applyMaxQuality();
      };
      video.addEventListener("timeupdate", onProgress);
      video.addEventListener("playing", onProgress);
      video.addEventListener("loadeddata", onProgress);
    }
    // 이미 안정 재생 중(이벤트를 놓친 뒤 바인딩됐을 수 있음)이면 즉시 1회 시도.
    // 실제 임계 판정은 applyMaxQuality 내부 게이트가 하므로 여기선 대략만 거른다.
    if (!video.paused && video.readyState >= 3 && video.currentTime > 0) {
      applyMaxQuality();
    }
  }

  // 라이브 지연(초). _getLiveLatency()는 ms를 반환한다. core를 받으면 재사용.
  function getLiveLatencySeconds(core = null) {
    try {
      const c = core || findCorePlayer();
      const ms = c?.srcObject?._getLiveLatency?.();
      return Number.isFinite(ms) ? ms / 1000 : null;
    } catch {
      return null;
    }
  }

  // 라이브 엣지로 즉시 점프(타임머신으로 멀리 과거에 있을 때 1.5배속은 비현실적).
  // corePlayer API → video.seekable.end 순으로 시도. 성공 시 true.
  function jumpToLiveEdge(core = null, video = null) {
    const c = core || findCorePlayer();
    const v = video || findVideo();
    // 라이브 엣지로 복귀하므로 되감기 hls 락을 해제(강제 동기화·버퍼 설정 원복).
    unlockHlsForRewind();
    // corePlayer가 라이브 엣지 이동 API를 노출하면 그걸 우선 사용.
    try {
      if (c && typeof c.seekToLive === "function") {
        c.seekToLive();
        return true;
      }
    } catch {}
    // 폴백: seekable 끝(라이브 엣지)에서 약간 뒤(목표 지연)로 seek.
    try {
      if (v?.seekable?.length) {
        const end = v.seekable.end(v.seekable.length - 1);
        if (Number.isFinite(end) && end > 0) {
          ourSeekUntil = Date.now() + 1500; // 곧 발생할 seeked는 우리 것 → 무시
          v.currentTime = Math.max(0, end - syncCfg.target);
          return true;
        }
      }
    } catch {}
    return false;
  }

  // ── 되감기 중 hls.js 라이브 엣지 강제 동기화 방지 ─────────────────────────────
  // 치지직 라이브는 hls.js 로 재생되는데, 재생 지연이 hls 의 라이브 지연 상한
  // (liveMaxLatencyDuration/liveSyncDurationCount 기반)을 넘으면 streamController 의
  // synchronizeToLiveEdge 가 media.currentTime 을 라이브 엣지로 '강제 점프'시킨다. 그래서
  // 사용자가 되감기로 지연을 ~30초까지 키우면 원점(라이브)으로 튕겨 되감기가 무의미해진다
  // (실측: FWD 843→875 가 player-vendor 의 synchronizeToLiveEdge 에서 발생).
  //
  // 되감기(사용자가 과거를 보는 중)일 때만 그 강제 동기화를 무력화한다. 라이브 엣지로
  // 복귀하면 원복한다. hls 내부 API 접근은 방어적으로.
  //
  // ⚠ 버퍼 설정(backBufferLength/maxBufferLength)은 절대 건드리지 않는다. 과거
  // backBufferLength=Infinity + maxBufferLength=600 으로 늘렸다가, 여러 방송 시청 시
  // 재생 지난 미디어가 무한 보존돼(시간당 ~수 GB/탭) 메모리가 수십 GB 까지 치솟고
  // SourceBuffer 비대화로 비주기적 수 초 멈춤이 생기는 심각한 문제가 있었다(실사용 재현).
  // 우리 되감기는 서버측 DVR 윈도우(video.seekable) 안에서 seek 해 세그먼트를 서버에서
  // 다시 받으므로 클라이언트 back buffer 보존이 필요 없다 — sync 무력화만으로 충분하다.
  let hlsSeekLocked = false;
  function getLiveHls(core = null) {
    try {
      const c = core || findCorePlayer();
      const hls = c?.player?._mediaController?._hls;
      return hls && hls.config && hls.streamController ? hls : null;
    } catch {
      return null;
    }
  }
  // synchronizeToLiveEdge 를 no-op 으로 교체(원본 보관). 1회만 패치.
  function patchHlsSync(hls) {
    const sc = hls.streamController;
    if (sc.__cheeseSyncPatched) return;
    sc.__cheeseSyncOriginal = sc.synchronizeToLiveEdge;
    sc.synchronizeToLiveEdge = function () {}; // 되감기 중엔 아무것도 안 함
    sc.__cheeseSyncPatched = true;
  }
  function unpatchHlsSync(hls) {
    const sc = hls?.streamController;
    if (sc?.__cheeseSyncPatched && sc.__cheeseSyncOriginal) {
      sc.synchronizeToLiveEdge = sc.__cheeseSyncOriginal;
      sc.__cheeseSyncPatched = false;
      sc.__cheeseSyncOriginal = null;
    }
  }
  // 되감기 락 걸기: 라이브 엣지 강제 동기화만 무력화(버퍼 설정은 위 주석대로 불변).
  function lockHlsForRewind() {
    if (hlsSeekLocked) return;
    const hls = getLiveHls();
    if (!hls) return;
    patchHlsSync(hls);
    hlsSeekLocked = true;
  }
  // 락 해제(라이브 엣지 복귀 시): 강제 동기화 원복.
  function unlockHlsForRewind() {
    if (!hlsSeekLocked) return;
    unpatchHlsSync(getLiveHls());
    hlsSeekLocked = false;
  }

  // 코덱 문자열에서 사람이 읽기 쉬운 이름 추출(예: avc1.4d401f → H.264, mp4a.40.2 → AAC).
  function prettyCodec(codec) {
    if (!codec) return null;
    const c = String(codec).toLowerCase();
    // 치지직이 '알 수 없음'으로 넘기는 값(UNK 등)은 코덱 미상으로 취급 → null 반환해
    // 상위 폴백(오디오 프로파일/audioOnly 트랙/MPD)이 채우게 하고, 그래도 없으면 —(대시)로
    // 표시한다(사용자가 UNK 같은 원문 노출을 보지 않도록).
    if (c === "unk" || c === "unknown" || c === "none" || c === "-")
      return null;
    // 표준 코덱 문자열(avc1.xxx, mp4a.40.2 등)과 함께, 치지직이 720p/1080p(그리드 경유)에서
    // 주는 사람이 읽는 축약형("H264","h264" 등)도 인식한다.
    if (
      c.startsWith("avc1") ||
      c.startsWith("avc3") ||
      c === "h264" ||
      c === "avc"
    )
      return "H.264 (AVC)";
    if (
      c.startsWith("hev1") ||
      c.startsWith("hvc1") ||
      c === "h265" ||
      c === "hevc"
    )
      return "H.265 (HEVC)";
    if (c.startsWith("av01") || c === "av1") return "AV1";
    if (c.startsWith("vp9") || c.startsWith("vp09") || c === "vp9")
      return "VP9";
    if (c.startsWith("vp8") || c === "vp8") return "VP8";
    if (c.startsWith("mp4a") || c === "aac") return "AAC";
    if (c.startsWith("opus") || c === "opus") return "Opus";
    if (c.startsWith("ac-3") || c === "ac3") return "AC-3";
    return codec;
  }

  // 객체에서 여러 후보 키 중 첫 유효 값을 숫자로(문자열 "60"도 60으로) 반환.
  function pickNum(obj, ...keys) {
    if (!obj) return null;
    for (const k of keys) {
      const n = Number(obj[k]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  }

  function pickStr(obj, ...keys) {
    if (!obj) return null;
    for (const k of keys) {
      const v = obj[k];
      if (v != null && v !== "") return v;
    }
    return null;
  }

  // 비트레이트 값을 kbps로 정규화: 100000 이상이면 bps로 보고 1000으로 나눔.
  function toKbps(n) {
    if (!Number.isFinite(n) || n <= 0) return null;
    return n >= 100000 ? Math.round(n / 1000) : Math.round(n);
  }

  // DASH MPD(srcObject._mpd)에서 현재 재생 해상도(video.videoHeight)에 가장
  // 가까운 비디오 Representation을 찾는다. 다시보기 ABR의 비트레이트/FPS 보강용.
  function findMpdRepresentation(core, video) {
    try {
      const mpd = (core._srcObject || core.srcObject)?._mpd;
      if (!mpd) return null;
      const periods = Array.isArray(mpd.Period) ? mpd.Period : [mpd.Period];
      const reps = [];
      for (const period of periods) {
        if (!period) continue;
        const asets = Array.isArray(period.AdaptationSet)
          ? period.AdaptationSet
          : [period.AdaptationSet];
        for (const as of asets) {
          if (!as) continue;
          const list = Array.isArray(as.Representation)
            ? as.Representation
            : [as.Representation];
          for (const r of list) {
            if (!r || !r["@width"]) continue; // 비디오 표현만(@width 존재)
            reps.push({
              width: Number(r["@width"]),
              height: Number(r["@height"]),
              bandwidth: r["@bandwidth"],
              frameRate: r["@frameRate"],
              codecs: r["@codecs"],
            });
          }
        }
      }
      if (!reps.length) return null;
      const targetH = video?.videoHeight || 0;
      // 현재 해상도와 height 차이가 가장 작은 표현 선택.
      return reps.reduce((best, r) =>
        Math.abs(r.height - targetH) < Math.abs(best.height - targetH)
          ? r
          : best,
      );
    } catch {
      return null;
    }
  }

  // 라디오 모드(오디오 전용) 오디오 비트레이트(kbps). selected가 ABR이라 비면,
  // ① 실제 트랙들 중 audioBitrate 보유분 ② MPD 오디오 표현 순으로 찾는다.
  function findMpdAudioBitrate(core) {
    try {
      // ① videoTracks(=오디오 전용이어도 트랙 목록은 여기에 있음)에서 실제 값.
      const tracks = Array.from(core.videoTracks || []);
      for (const t of tracks) {
        const br =
          pickNum(t, "audioBitrate", "_audioBitrate") ||
          pickNum(t.dataset || {}, "audioBitRate");
        const k = toKbps(br);
        if (k) return k;
      }
      // ② MPD 오디오 AdaptationSet/Representation(@audioSamplingRate 또는 audio mime).
      const mpd = (core._srcObject || core.srcObject)?._mpd;
      if (mpd) {
        const periods = Array.isArray(mpd.Period) ? mpd.Period : [mpd.Period];
        for (const period of periods) {
          if (!period) continue;
          const asets = Array.isArray(period.AdaptationSet)
            ? period.AdaptationSet
            : [period.AdaptationSet];
          for (const as of asets) {
            if (!as) continue;
            const list = Array.isArray(as.Representation)
              ? as.Representation
              : [as.Representation];
            for (const r of list) {
              if (!r) continue;
              const isAudio =
                r["@audioSamplingRate"] ||
                /audio/i.test(r["@mimeType"] || as["@mimeType"] || "");
              if (!isAudio || r["@width"]) continue; // 비디오 표현 제외
              const k = toKbps(Number(r["@bandwidth"]));
              if (k) return k;
            }
          }
        }
      }
    } catch {}
    return null;
  }

  // 실제 height를 표준 화질 등급(예: 1080→"1080p")으로 매핑한다. 표준 등급에서
  // ±32px 이내면 그 등급으로 본다(인코딩 편차 흡수).
  function heightToGrade(h) {
    if (!Number.isFinite(h) || h <= 0) return null;
    const grades = [144, 240, 360, 480, 720, 1080, 1440, 2160];
    for (const g of grades) {
      if (Math.abs(h - g) <= 32) return `${g}p`;
    }
    return `${h}p`;
  }

  // 출력 장치 샘플레이트(Hz). 믹서 AudioContext가 없을 때 폴백용. 임시 컨텍스트로
  // 1회 읽고 닫은 뒤 캐싱한다(컨텍스트 남발 방지).
  let cachedOutputSampleRate = 0;
  function getOutputSampleRate() {
    if (cachedOutputSampleRate) return cachedOutputSampleRate;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return 0;
      const tmp = new Ctx();
      cachedOutputSampleRate = tmp.sampleRate || 0;
      tmp.close?.();
    } catch {}
    return cachedOutputSampleRate;
  }

  function collectStreamInfo() {
    const video = findVideo();
    const info = {
      resolution: null,
      fps: null,
      videoBitrate: null,
      videoCodec: null,
      latency: null,
      audioBitrate: null,
      audioCodec: null,
      audioChannels: null,
      audioSampleRate: null,
      isLive: location.pathname.startsWith("/live/"),
      audioOnly: false, // 라디오 모드(오디오 전용)
      // 아래 _접두 필드는 내부 계산용 원시값(표시 안 함).
      _rawVideoCodec: null,
      _w: 0,
      _h: 0,
      _fpsNum: 0,
      _bitrateNum: 0,
    };

    // 1) <video> 표준 API 폴백
    if (video?.videoWidth && video?.videoHeight) {
      info.resolution = `${video.videoWidth}×${video.videoHeight}`;
      info._w = video.videoWidth;
      info._h = video.videoHeight;
    }

    // 2) 치지직 내부 플레이어에서 상세 정보
    try {
      const core = findCorePlayer();
      if (core) {
        const selected =
          Array.from(core.videoTracks || []).find((t) => t.selected) ||
          Array.from(core.videoTracks || []).find((t) => t._selected);
        // 라이브는 selected.dataset에 정밀한 값들이 들어있다.
        const ds = selected?.dataset || {};

        if (selected) {
          // 해상도: width×height를 기본으로, 깨끗한 화질 등급(예: 1080p)을 병기.
          // label("1080pavc1.64002a")엔 코덱이 섞여 있으니 토큰만 추출하고,
          // 다시보기 ABR("Auto")처럼 등급을 못 얻으면 실제 height에서 도출한다.
          const w =
            pickNum(selected, "width", "_width") || pickNum(ds, "videoWidth");
          const h =
            pickNum(selected, "height", "_height") ||
            pickNum(ds, "videoHeight") ||
            video?.videoHeight ||
            null;
          // 화질 등급 원본(고정이면 "1080p", 자동이면 "Auto").
          const rawQuality =
            pickStr(selected, "_videoQuality", "encodingOptionID") ||
            pickStr(selected, "label") ||
            "";
          const isAbr = /^auto$|^abr$/i.test(rawQuality.trim());
          // 표시용 등급: 고정이면 그 등급, 자동이면 실제 height에서 도출.
          let grade = String(rawQuality).match(/\d{3,4}p/)?.[0] || null;
          if (!grade) grade = heightToGrade(h);
          // 자동이면 "자동 · 1080p", 고정이면 "1080p"로 병기.
          const tag = grade
            ? isAbr
              ? `자동 · ${grade}`
              : grade
            : isAbr
              ? "자동"
              : null;
          if (w && h) {
            info.resolution = tag ? `${w}×${h} (${tag})` : `${w}×${h}`;
          } else if (!info.resolution && tag) {
            info.resolution = tag;
          }
          if (w) info._w = w;
          if (h) info._h = h;

          // FPS: 문자열 "60"도 처리(언더스코어/dataset 포함)
          const fps =
            pickNum(selected, "videoFrameRate", "_videoFrameRate") ||
            pickNum(ds, "videoFrameRate");
          if (fps) {
            info.fps = `${Math.round(fps)} fps`;
            info._fpsNum = fps;
          }

          // 비디오 비트레이트(kbps 정규화)
          const vbr =
            pickNum(selected, "videoBitrate", "_videoBitrate") ||
            pickNum(ds, "videoBitRate");
          if (vbr) info._bitrateNum = vbr;
          info.videoBitrate = toKbps(vbr)
            ? `${numberFormat(toKbps(vbr))} kbps`
            : null;

          // 오디오 비트레이트
          const abr =
            pickNum(selected, "audioBitrate", "_audioBitrate") ||
            pickNum(ds, "audioBitRate");
          info.audioBitrate = toKbps(abr)
            ? `${numberFormat(toKbps(abr))} kbps`
            : null;

          // 오디오 채널/샘플속도: dataset 우선
          const ch = pickNum(ds, "audioChannel");
          if (ch) info.audioChannels = `${ch}ch`;
          const sr = pickNum(ds, "audioSamplingRate");
          if (sr) info.audioSampleRate = `${(sr / 1000).toFixed(1)} kHz`;

          // 코덱: track의 codec 필드 우선
          const rawVCodec = pickStr(selected, "videoCodec", "_videoCodec");
          if (rawVCodec) info._rawVideoCodec = rawVCodec;
          info.videoCodec = prettyCodec(rawVCodec) || info.videoCodec;
          info.audioCodec =
            prettyCodec(pickStr(selected, "audioCodec", "_audioCodec")) ||
            info.audioCodec;
          // 치지직이 720p/1080p(그리드 경유)에서 audioCodec 을 "UNK"로 주는 경우
          // prettyCodec 이 null 이 된다. 이때 audioProfile 로 코덱을 추론한다: "LC"/"HE"
          // 등은 AAC 프로파일이므로 AAC 로 표시(로그 확인: audioCodec=UNK 여도
          // audioProfile=LC, audioSamplingRate=48000, 같은 스트림 audioOnly 트랙=AAC).
          if (!info.audioCodec) {
            const ap = pickStr(selected, "audioProfile", "_audioProfile");
            if (ap && /^(lc|he|hev2|main|ltp|ld|eld|aac)/i.test(ap)) {
              info.audioCodec = "AAC";
            }
          }
        }

        // _currentCodecs 폴백 + 채널 보강.
        const codecs = core._currentCodecs;
        if (codecs) {
          if (!info._rawVideoCodec && codecs.video)
            info._rawVideoCodec = codecs.video;
          info.videoCodec = info.videoCodec || prettyCodec(codecs.video);
          info.audioCodec = info.audioCodec || prettyCodec(codecs.audio);
          const ch = pickNum(codecs, "audioChannel");
          if (!info.audioChannels && ch) info.audioChannels = `${ch}ch`;
        }

        // 오디오 코덱 폴백: 아직 못 얻었으면(선택 트랙·_currentCodecs 모두 UNK) 같은
        // 스트림의 audioOnly 트랙 코덱을 쓴다. 로그상 media[].encodingTrack 의
        // audioOnly 트랙은 실제 오디오 코덱(AAC)을 정상 값으로 담고 있다.
        if (!info.audioCodec) {
          try {
            const mediaList = core.srcObject?.data?.media;
            if (Array.isArray(mediaList)) {
              for (const m of mediaList) {
                const at = (m?.encodingTrack || []).find((t) =>
                  /audio/i.test(t?.encodingTrackId || ""),
                );
                const ac = prettyCodec(
                  pickStr(at, "audioCodec", "_audioCodec"),
                );
                if (ac) {
                  info.audioCodec = ac;
                  break;
                }
              }
            }
          } catch {}
        }

        // 라디오 모드(오디오 전용) 감지: 비디오 코덱이 없고 오디오만 있으며 실제
        // 영상 크기도 없는 경우. 이때 비디오 정보는 의미가 없으니 비운다.
        info.audioOnly =
          !!codecs?.audio &&
          !codecs?.video &&
          !info.videoCodec &&
          !(video?.videoWidth > 0);
        if (info.audioOnly) {
          info.resolution = null;
          info.fps = null;
          info.videoBitrate = null;
          info.videoCodec = null;
          // 오디오 비트레이트가 비면 MPD에서 오디오 표현을 찾아 보강.
          if (!info.audioBitrate) {
            const arep = findMpdAudioBitrate(core);
            if (arep) info.audioBitrate = `${numberFormat(arep)} kbps`;
          }
        }

        if (
          info.isLive &&
          typeof core.srcObject?._getLiveLatency === "function"
        ) {
          const lat = core.srcObject._getLiveLatency();
          if (Number.isFinite(lat))
            info.latency = `${numberFormat(Math.floor(lat))} ms`;
        }

        // 다시보기(ABR)는 트랙에 비트레이트/FPS가 없다 → DASH MPD에서 현재 재생
        // 해상도에 맞는 Representation을 찾아 채운다.
        if (!info.videoBitrate || !info.fps) {
          const rep = findMpdRepresentation(core, video);
          if (rep) {
            if (!info.fps && pickNum(rep, "frameRate"))
              info.fps = `${Math.round(pickNum(rep, "frameRate"))} fps`;
            const bw = pickNum(rep, "bandwidth");
            if (!info.videoBitrate && toKbps(bw))
              info.videoBitrate = `${numberFormat(toKbps(bw))} kbps`;
            // muxed Representation의 codecs는 "video,audio" 형태
            const repCodecs = String(rep.codecs || "").split(",");
            if (!info.videoCodec && repCodecs[0])
              info.videoCodec = prettyCodec(repCodecs[0].trim());
            if (!info.audioCodec && repCodecs[1])
              info.audioCodec = prettyCodec(repCodecs[1].trim());
          }
        }
      }
    } catch {}

    // 3) 폴백 — 샘플속도: 믹서 AudioContext가 없으면(믹서 미사용) 출력 장치
    // 샘플레이트를 가볍게 조회한다.
    if (!info.audioSampleRate) {
      const sr = audio.ctx?.sampleRate || getOutputSampleRate();
      if (sr) info.audioSampleRate = `${(sr / 1000).toFixed(1)} kHz`;
    }
    try {
      if (!info.audioChannels && audio.source?.channelCount)
        info.audioChannels = `${audio.source.channelCount}ch`;
    } catch {}

    return info;
  }

  // ── 하드웨어(GPU) 가속 감지 ────────────────────────────────────────────────
  // chrome://gpu 의 가속 상태를 읽는 확장 API 는 없다. 대신 WebGL 의 실제 렌더러
  // 문자열(WEBGL_debug_renderer_info)을 읽어 '소프트웨어 렌더러'인지로 가속 여부를
  // 판정한다(chrome://gpu 결론과 대부분 일치). 렌더러는 세션 중 안 바뀌므로 1회만
  // 조회해 캐시한다(작은 canvas 1개 생성 후 폐기 — 지속 부하 없음).
  let gpuAccelCache = null;
  function getGpuAccelInfo() {
    if (gpuAccelCache) return gpuAccelCache;
    let renderer = "";
    let accelerated = null; // true/false/null(판정 불가)
    try {
      const canvas = document.createElement("canvas");
      const gl =
        canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (gl) {
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        renderer = dbg
          ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "")
          : "";
        // 소프트웨어 렌더러 = 가속 꺼짐(거의 확정). 그 외 실제 GPU = 켜짐.
        const sw =
          /swiftshader|llvmpipe|software|basic render|microsoft basic/i.test(
            renderer,
          );
        if (renderer) accelerated = !sw;
        // 컨텍스트 즉시 정리(리소스 남기지 않음).
        gl.getExtension("WEBGL_lose_context")?.loseContext?.();
      } else {
        // WebGL 자체가 없으면 가속이 꺼졌을 가능성이 높지만 확정은 못 함.
        accelerated = false;
        renderer = "no-webgl";
      }
    } catch {
      accelerated = null;
    }
    gpuAccelCache = { accelerated, renderer };
    return gpuAccelCache;
  }
  // 스트림 정보 패널용 표시 문자열. 켜짐/꺼짐/불명.
  function gpuAccelLabel() {
    const { accelerated } = getGpuAccelInfo();
    if (accelerated === true) return "사용 중";
    if (accelerated === false) return "꺼짐";
    return null; // 불명 → 행에서 "—"
  }

  function numberFormat(n) {
    return Number(n).toLocaleString("ko-KR");
  }

  function statsIcon() {
    return `<svg class="pzp-ui-icon__svg" focusable="false" xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <circle cx="18" cy="18" r="9.5" stroke="currentColor" stroke-width="2"></circle>
      <path d="M18 16.4v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
      <circle cx="18" cy="13" r="1.3" fill="currentColor"></circle>
    </svg>`;
  }

  function createStatsButton() {
    const btn = document.createElement("button");
    btn.className = `${STATS_BUTTON_CLASS} pzp-pc__setting-button pzp-button pzp-pc-ui-button`;
    btn.type = "button";
    btn.setAttribute("aria-label", "스트림 정보");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = `<span class="pzp-button__tooltip pzp-button__tooltip--top">스트림 정보 (Shift+I)</span><span class="pzp-ui-icon">${statsIcon()}</span>`;
    return btn;
  }

  // 버튼 key 의 배치 설정("left"|"right")에 맞는 컨트롤 컨테이너를 반환.
  // 버튼 key → 그 key 를 이루는 버튼 클래스들. 되감기/앞으로는 각각 독립 key.
  const PLAYER_BTN_KEY_CLASSES = {
    streamStats: [STATS_BUTTON_CLASS],
    tabMute: [TAB_MUTE_BUTTON_CLASS],
    screenshot: [SCREENSHOT_BUTTON_CLASS],
    rewind: [REWIND_BUTTON_CLASS],
    forward: [FORWARD_BUTTON_CLASS],
    sync: [SYNC_BUTTON_CLASS],
  };

  // 네이티브 볼륨 컨트롤(우리 믹서/필터 래퍼가 아닌 것)만 반환. ⚠ 믹서 버튼 래퍼도
  // pzp-pc__volume-control 클래스를 달고 있어, 단순 :scope > .pzp-pc__volume-control 은
  // 믹서까지 매칭한다. seek '볼륨 뒤' 앵커가 믹서 래퍼를 잡아버리면 배치가 뒤엉켜
  // 무한 재삽입이 났다. 그래서 네이티브 볼륨만 콕 집어 앵커로 쓴다.
  function nativeVolumeControl(controls) {
    return (
      Array.from(
        controls.querySelectorAll(":scope > .pzp-pc__volume-control"),
      ).find(
        (el) =>
          !el.classList.contains(CONTROL_CLASS) &&
          !el.classList.contains("cheese-video-filter-control"),
      ) || null
    );
  }

  function sideControls(player, key) {
    const side = playerButtonSide.side[key] === "left" ? "left" : "right";
    return (
      player.querySelector(`.pzp-pc__bottom-buttons-${side}`) ||
      player.querySelector(".pzp-pc__bottom-buttons-right") ||
      player.querySelector(".pzp-pc__bottom-buttons-left")
    );
  }

  // 버튼이 왼쪽으로 배치될 때의 삽입 앵커: 우리 오디오 믹서/비디오 필터 컨트롤 '뒤'에
  // 넣는다(볼륨 컨트롤 다음). left 컨테이너가 아니거나 앵커 기준이 없으면 null(=맨 끝
  // append). 이렇게 하면 왼쪽으로 옮긴 버튼들이 믹서·필터 뒤에 순서대로 붙는다.
  function leftInsertAnchor(controls) {
    if (
      !controls ||
      !controls.classList.contains("pzp-pc__bottom-buttons-left")
    )
      return null;
    // 우리 컨트롤(믹서/필터) 중 DOM상 가장 뒤에 있는 것의 다음 형제를 앵커로.
    const ours = controls.querySelectorAll(
      ".cheese-audio-mixer-control, .cheese-video-filter-control",
    );
    const last = ours.length ? ours[ours.length - 1] : null;
    return last ? last.nextSibling : null;
  }

  // key 버튼의 최초 삽입 앵커(대략 위치). 정확한 그룹 내 순서는 arrangePlayerButtons 가
  // 마무리한다. left면 믹서/필터 뒤, right면 호출부가 준 rightAnchor.
  function insertAnchorFor(controls, key, rightAnchor) {
    if (playerButtonSide.side[key] === "left")
      return leftInsertAnchor(controls);
    return rightAnchor;
  }

  // grp 그룹에서 slot.after 앵커의 '기준 엘리먼트'를 반환한다(그 '뒤'에 우리 버튼을 붙인다).
  // - 네이티브 앵커: 그 엘리먼트. 현재 DOM 에 없으면 앵커 순서상 다음으로 존재하는 앵커로 폴백.
  //   (믹서/필터 앵커는 기능이 꺼져 있으면 DOM 에 없어 다음 앵커로 폴백.)
  // - START: 우측 그룹은 null(맨 앞). 좌측 그룹은 '재생 버튼 앞'에 끼우면 안 되므로(믹서
  //   슬라이더 호버 등으로 DOM 이 흔들려 우리 버튼이 매 tick 재삽입=무한 깜빡임) 볼륨/믹서/
  //   필터 등 좌측 네이티브 앵커 중 '실제 존재하는 마지막' 엘리먼트 뒤에 놓는다.
  function resolveAnchorEl(controls, grp, after) {
    const order = PLAYER_BTN_ANCHOR_ORDER[grp];
    if (after && after !== "START") {
      const startIdx = order.indexOf(after);
      if (startIdx >= 0) {
        for (let i = startIdx; i < order.length; i++) {
          // 볼륨 앵커는 네이티브 볼륨만 겨냥(믹서 래퍼도 pzp-pc__volume-control 이라 제외).
          const el =
            order[i] === "pzp-pc__volume-control"
              ? nativeVolumeControl(controls)
              : controls.querySelector(`:scope > .${order[i]}`);
          if (el) return el; // 이 네이티브 뒤에 붙인다
        }
      }
    }
    // START. 우측은 맨 앞(null). 좌측은 '재생 버튼 앞'에 끼우면 안 되므로(무한 깜빡임)
    // 볼륨/믹서/필터 뒤에 놓는다. 믹서/필터가 있으면 그중 마지막 뒤, 없으면 볼륨 뒤,
    // 그것도 없으면 재생 버튼 뒤. (live_time '실시간' 배지는 START 기준에서 제외.)
    if (grp === "left") {
      const ours = controls.querySelectorAll(
        ".cheese-audio-mixer-control, .cheese-video-filter-control",
      );
      if (ours.length) return ours[ours.length - 1];
      return (
        nativeVolumeControl(controls) ||
        controls.querySelector(":scope > .pzp-playback-switch") ||
        null
      );
    }
    return null; // 우측 START(맨 앞) 또는 좌측에 기준 앵커가 없을 때
  }

  // slot(네이티브 앵커) + order(같은 앵커 내 상대순서)에 따라 각 그룹 내 '우리 버튼'을
  // 재배치한다. 네이티브 버튼은 절대 이동하지 않고(우리 버튼만 insertBefore) React 트리
  // 불변. 앵커는 DOM 순서로 처리하고, 같은 앵커에 매핑된 우리 버튼은 order 상대순서대로
  // 그 앵커 바로 뒤에 붙인다. seek 은 되감기→앞으로 쌍을 인접·순서 유지. 앵커가 없으면
  // 다음 앵커로 폴백. 이미 목표 배치면 DOM 변경 없이 반환(부하·옵저버 자가발화 억제).
  //
  // 핵심: 각 앵커의 '기준 네이티브 엘리먼트' 뒤에 nextSibling 을 삽입 커서로 삼아 순서대로
  // 넣는다. 커서를 매 삽입마다 그 엘리먼트의 nextSibling 으로 갱신하므로, 같은 앵커에
  // 여러 버튼이 있어도 '앵커→버튼1→버튼2→...' 안정적으로 정렬된다(무한 스왑 방지).
  function arrangePlayerButtons() {
    const player = findPlayer();
    if (!player) return;
    for (const grp of ["left", "right"]) {
      const controls = player.querySelector(`.pzp-pc__bottom-buttons-${grp}`);
      if (!controls) continue;
      // 이 그룹에 속한 우리 버튼 key 를 order(상대순서)대로 나열.
      const keys = playerButtonSide.order[grp].filter(
        (k) => playerButtonSide.side[k] === grp,
      );
      if (keys.length === 0) continue;
      // 앵커별 그룹핑: after 앵커 → 그 앵커에 붙을 key 목록(order 순서 유지).
      const byAnchor = new Map(); // after → [key...]
      for (const key of keys) {
        const slot = playerButtonSide.slot[key];
        const after = slot && slot.after ? slot.after : "START";
        if (!byAnchor.has(after)) byAnchor.set(after, []);
        byAnchor.get(after).push(key);
      }
      // 앵커 처리 순서: START 먼저, 그다음 네이티브 앵커 DOM 순서.
      const anchorSeq = ["START", ...PLAYER_BTN_ANCHOR_ORDER[grp]];
      for (const after of anchorSeq) {
        const anchorKeys = byAnchor.get(after);
        if (!anchorKeys || anchorKeys.length === 0) continue;
        // 이 앵커에 붙일 우리 버튼 엘리먼트(존재하는 것만, seek=되감기→앞으로 쌍 유지).
        const ordered = [];
        for (const key of anchorKeys) {
          for (const cls of PLAYER_BTN_KEY_CLASSES[key] || []) {
            const el = controls.querySelector(`:scope > .${cls}`);
            if (el) ordered.push(el);
          }
        }
        if (ordered.length === 0) continue;
        // 기준: 네이티브 앵커 엘리먼트(뒤에 붙임) / START 면 그룹 시작 지점(leftInsertAnchor).
        const anchorEl = resolveAnchorEl(controls, grp, after);
        // 목표 위치를 순서대로 확인·삽입. prev = 직전 형제(앵커 or 방금 배치한 우리 버튼).
        // el 이 이미 prev 바로 뒤면 건드리지 않고, 아니면 prev.nextSibling 앞에 삽입.
        let prev = anchorEl; // null 이면 그룹 맨 앞부터
        for (const el of ordered) {
          const shouldFollow = prev ? prev.nextSibling : controls.firstChild;
          if (el !== shouldFollow) {
            if (prev) controls.insertBefore(el, prev.nextSibling);
            else controls.insertBefore(el, controls.firstChild);
          }
          prev = el; // 다음 버튼은 이 버튼 뒤에
        }
      }
    }
  }

  // 배치 설정이 바뀌면 우리 하단 버튼 5종을 '전부 제거'하고 tick 으로 재생성한 뒤 order
  // 대로 정렬한다. (반대쪽만 골라 제거하면 순서가 어긋나므로 전부 새로 그린다. relocate 는
  // 설정 변경 시에만 드물게 일어나 잠깐의 재생성은 무해.)
  function relocatePlayerButtons() {
    [
      STATS_BUTTON_CLASS,
      TAB_MUTE_BUTTON_CLASS,
      SCREENSHOT_BUTTON_CLASS,
      REWIND_BUTTON_CLASS,
      FORWARD_BUTTON_CLASS,
      SYNC_BUTTON_CLASS,
    ].forEach((cls) => {
      document.querySelectorAll(`.${cls}`).forEach((btn) => btn.remove());
    });
    if (typeof tick === "function") {
      forceFullTick = true;
      tick();
    }
    arrangePlayerButtons(); // tick 이 버튼을 다시 만들면 그 순서를 order 대로 정리
  }

  function ensureStatsButton() {
    const player = findPlayer();
    if (!player) return;
    const controls = sideControls(player, "streamStats");
    if (!controls || controls.querySelector(`.${STATS_BUTTON_CLASS}`)) return;
    const btn = createStatsButton();
    // 라이브: 클립 만들기 버튼 앞 / 다시보기: 댓글 타임스탬프 버튼 앞.
    // 둘 다 없으면 우측 컨트롤 그룹 맨 앞에 둔다. 왼쪽 배치면 믹서/필터 뒤.
    const rightAnchor =
      controls.querySelector(".custom__clip-button") ||
      controls.querySelector(".cheese-search-comment-timestamp-button") ||
      controls.firstChild;
    controls.insertBefore(
      btn,
      insertAnchorFor(controls, "streamStats", rightAnchor),
    );
  }

  function removeStatsButton() {
    document
      .querySelectorAll(`.${STATS_BUTTON_CLASS}`)
      .forEach((b) => b.remove());
  }

  // ── 탭 음소거 버튼 ─────────────────────────────────────────────────────────
  // 스피커 아이콘(음소거/해제). 치지직 음소거(영상)와 별개로 '브라우저 탭 전체'를
  // 음소거한다(background의 chrome.tabs.update 경유).
  function tabMuteIcon(muted) {
    return muted
      ? `<svg class="pzp-ui-icon__svg" width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true"><path d="M19 11.5 14 15h-3.5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1H14l5 3.5v-13Z" fill="currentColor"/><path d="m23 15 5 5m0-5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
      : `<svg class="pzp-ui-icon__svg" width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true"><path d="M19 11.5 14 15h-3.5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1H14l5 3.5v-13Z" fill="currentColor"/><path d="M23 14.5a4.5 4.5 0 0 1 0 7M25.5 12a8 8 0 0 1 0 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>`;
  }

  function createTabMuteButton() {
    const btn = document.createElement("button");
    btn.className = `${TAB_MUTE_BUTTON_CLASS} pzp-pc__setting-button pzp-button pzp-pc-ui-button`;
    btn.type = "button";
    const label = tabMutedState ? "탭 음소거 해제" : "탭 음소거";
    btn.setAttribute("aria-label", label);
    btn.setAttribute("aria-pressed", String(tabMutedState));
    btn.innerHTML = `<span class="pzp-button__tooltip pzp-button__tooltip--top">${label} (Shift+M)</span><span class="pzp-ui-icon">${tabMuteIcon(tabMutedState)}</span>`;
    return btn;
  }

  function ensureTabMuteButton() {
    const player = findPlayer();
    if (!player) return;
    const controls = sideControls(player, "tabMute");
    if (!controls) return;
    if (controls.querySelector(`.${TAB_MUTE_BUTTON_CLASS}`)) {
      syncTabMuteButton();
      return;
    }
    const btn = createTabMuteButton();
    // 스트림 정보 버튼 앞(있으면), 없으면 우측 그룹 맨 앞. 왼쪽 배치면 믹서/필터 뒤.
    const rightAnchor =
      controls.querySelector(`.${STATS_BUTTON_CLASS}`) ||
      controls.querySelector(".custom__clip-button") ||
      controls.querySelector(".cheese-search-comment-timestamp-button") ||
      controls.firstChild;
    controls.insertBefore(
      btn,
      insertAnchorFor(controls, "tabMute", rightAnchor),
    );
    requestTabMuteQuery(); // 현재 탭 음소거 상태를 받아 아이콘 동기화
  }

  function removeTabMuteButton() {
    document
      .querySelectorAll(`.${TAB_MUTE_BUTTON_CLASS}`)
      .forEach((b) => b.remove());
  }

  // ── 스크린샷 버튼 ──────────────────────────────────────────────────────────
  // 현재 재생 중인 프레임(.webplayer-internal-video)을 canvas에 그려 PNG로 저장한다.
  // 표준 canvas.drawImage/toDataURL 기법(브라우저·OS 캡처와 동등한 행위). DRM(EME)
  // 영상이면 canvas가 taint되어 실패할 수 있으나, 치지직 라이브/다시보기는 대상 아님.
  function screenshotIcon() {
    return `<svg class="pzp-ui-icon__svg" width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true"><path d="M13 12l1.2-2h7.6l1.2 2H26a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h3Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"/><circle cx="18" cy="18.5" r="3.5" stroke="currentColor" stroke-width="2" fill="none"/></svg>`;
  }

  function createScreenshotButton() {
    const btn = document.createElement("button");
    btn.className = `${SCREENSHOT_BUTTON_CLASS} pzp-pc__setting-button pzp-button pzp-pc-ui-button`;
    btn.type = "button";
    btn.setAttribute("aria-label", "스크린샷");
    btn.innerHTML = `<span class="pzp-button__tooltip pzp-button__tooltip--top">스크린샷 (Shift+S)</span><span class="pzp-ui-icon">${screenshotIcon()}</span>`;
    return btn;
  }

  function ensureScreenshotButton() {
    const player = findPlayer();
    if (!player) return;
    const controls = sideControls(player, "screenshot");
    if (!controls || controls.querySelector(`.${SCREENSHOT_BUTTON_CLASS}`))
      return;
    const btn = createScreenshotButton();
    // 스트림 정보/탭 음소거 버튼 앞(같은 컨테이너에 있을 때만), 없으면 우측 그룹 맨 앞.
    // 왼쪽 배치면 믹서/필터 뒤.
    const rightAnchor =
      controls.querySelector(`.${STATS_BUTTON_CLASS}`) ||
      controls.querySelector(`.${TAB_MUTE_BUTTON_CLASS}`) ||
      controls.querySelector(".custom__clip-button") ||
      controls.querySelector(".cheese-search-comment-timestamp-button") ||
      controls.firstChild;
    controls.insertBefore(
      btn,
      insertAnchorFor(controls, "screenshot", rightAnchor),
    );
  }

  function removeScreenshotButton() {
    document
      .querySelectorAll(`.${SCREENSHOT_BUTTON_CLASS}`)
      .forEach((b) => b.remove());
  }

  // 파일명에 못 쓰는 문자 정리 + 길이 제한.
  function sanitizeScreenshotName(name) {
    return String(name || "chzzk")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  }

  // document.title(치지직: "제목 - 채널명" 등)에서 접미사를 걷어내 기본 파일명으로 쓴다.
  function screenshotBaseName() {
    const t = (document.title || "").replace(/\s*-\s*치지직\s*$/, "").trim();
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return sanitizeScreenshotName(`${t || "chzzk"}_${ts}`);
  }

  // 저장 결과 콜백을 reqId로 매칭(content 브릿지 → background chrome.downloads).
  const screenshotSaveCallbacks = new Map();
  let screenshotReqSeq = 0;
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== "cheese-screenshot-save-result") return;
    const cb = screenshotSaveCallbacks.get(d.reqId);
    if (cb) {
      screenshotSaveCallbacks.delete(d.reqId);
      cb({ ok: d.ok === true, saved: d.saved === true });
    }
  });

  // dataURL을 파일로 저장한다. background의 chrome.downloads(saveAs:false)로 대화상자
  // 없이 바로 저장하고, 실제 완료/취소 결과를 done(result)로 알려준다. done은 선택.
  function downloadScreenshot(dataURL, name, done) {
    const reqId = ++screenshotReqSeq;
    if (typeof done === "function") {
      screenshotSaveCallbacks.set(reqId, done);
      // 브릿지/응답이 유실될 경우 대비 타임아웃(20초).
      window.setTimeout(() => {
        if (screenshotSaveCallbacks.has(reqId)) {
          screenshotSaveCallbacks.delete(reqId);
          done({ ok: false, saved: false, timeout: true });
        }
      }, 20000);
    }
    window.postMessage(
      {
        source: "cheese-screenshot-save",
        reqId,
        dataURL,
        filename: `${name}.png`,
      },
      location.origin,
    );
  }

  function takeScreenshot() {
    const video = document.querySelector(".webplayer-internal-video");
    if (!(video instanceof HTMLVideoElement) || !video.videoWidth) {
      showScreenshotToast(false, "재생 중인 화면이 없어요");
      return;
    }
    let dataURL;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      dataURL = canvas.toDataURL("image/png"); // taint면 여기서 throw
    } catch (err) {
      showScreenshotToast(false, "스크린샷을 만들 수 없어요");
      return;
    }
    const name = screenshotBaseName();
    if (screenshotPreviewOn) {
      openScreenshotPreview(dataURL, name); // 저장/취소 확인 팝오버
    } else {
      downloadScreenshot(dataURL, name, onScreenshotSaved);
    }
  }

  // 저장 결과에 따라 정확한 토스트. saved=true만 '저장했어요', 취소/실패는 그에 맞게.
  function onScreenshotSaved(result) {
    if (result.saved) {
      showScreenshotToast(true, "스크린샷을 저장했어요");
    } else if (result.ok) {
      showScreenshotToast(false, "저장을 취소했어요"); // 다운로드 대화상자에서 취소 등
    } else {
      showScreenshotToast(false, "저장하지 못했어요");
    }
  }

  // ── 저장 전 미리보기 팝오버(드래그 이동 + 리사이즈, 위치·크기 기억) ───────────
  // 배경을 덮지 않는 플로팅 창이라 뒤 페이지와 계속 상호작용할 수 있다. 위치·크기는
  // 페이지 origin localStorage에 저장해 다음에 같은 자리·크기로 뜬다(MAIN world라 직접 접근).
  const SCREENSHOT_MODAL_ID = "cheese-screenshot-modal";
  const SCREENSHOT_RECT_KEY = "cheese-screenshot-preview-rect";

  function loadScreenshotRect() {
    try {
      const raw = window.localStorage.getItem(SCREENSHOT_RECT_KEY);
      const r = raw ? JSON.parse(raw) : null;
      if (r && Number.isFinite(r.w) && Number.isFinite(r.h)) return r;
    } catch {}
    return null;
  }
  function saveScreenshotRect(el) {
    try {
      const r = el.getBoundingClientRect();
      // 레이아웃이 아직 안 잡혔거나 제거 직후면 0이 나온다 — 그 값을 저장하면 다음에
      // 0px 창으로 뜨므로 유효한 크기일 때만 저장한다.
      if (!(r.width > 0) || !(r.height > 0)) return;
      window.localStorage.setItem(
        SCREENSHOT_RECT_KEY,
        JSON.stringify({
          left: Math.round(r.left),
          top: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
        }),
      );
    } catch {}
  }
  // 저장된 위치가 화면 밖이면 보이도록 되돌린다.
  function clampToViewport(left, top, w, h) {
    const maxLeft = Math.max(
      0,
      window.innerWidth - Math.min(w, window.innerWidth),
    );
    const maxTop = Math.max(0, window.innerHeight - 40);
    return {
      left: Math.min(Math.max(0, left), maxLeft),
      top: Math.min(Math.max(0, top), maxTop),
    };
  }

  // savedByUser=true(저장 버튼으로 닫음)면 취소 토스트를 띄우지 않는다. 그 외(취소 버튼/
  // ESC/X 닫기)엔 '저장을 취소했어요' 토스트를 띄운다.
  function closeScreenshotPreview(savedByUser) {
    const el = document.getElementById(SCREENSHOT_MODAL_ID);
    if (el) {
      saveScreenshotRect(el); // 닫을 때 마지막 위치·크기 보존
      el.remove();
      if (!savedByUser) showScreenshotToast(false, "저장을 취소했어요");
    }
    document.removeEventListener("keydown", onScreenshotModalKey);
  }
  function onScreenshotModalKey(e) {
    if (e.key === "Escape") closeScreenshotPreview();
  }

  function closeIcon() {
    return `<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path fill="currentColor" d="M16.6 4.933A1.083 1.083 0 1 0 15.066 3.4L10 8.468 4.933 3.4A1.083 1.083 0 0 0 3.4 4.933L8.468 10 3.4 15.067A1.083 1.083 0 1 0 4.933 16.6L10 11.532l5.067 5.067a1.083 1.083 0 1 0 1.532-1.532L11.532 10l5.067-5.067Z"></path></svg>`;
  }

  function openScreenshotPreview(dataURL, name) {
    closeScreenshotPreview(true); // 이전 미리보기 교체는 취소 아님 → 토스트 안 띄움
    const win = document.createElement("div");
    win.id = SCREENSHOT_MODAL_ID;
    win.className = "cheese-screenshot-win";
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-label", "스크린샷 미리보기");
    win.innerHTML = `
      <div class="cheese-screenshot-win-header">
        <span class="cheese-screenshot-win-title">스크린샷 미리보기</span>
        <button type="button" class="cheese-screenshot-win-close" aria-label="닫기">${closeIcon()}</button>
      </div>
      <div class="cheese-screenshot-win-body">
        <img class="cheese-screenshot-win-img" alt="스크린샷 미리보기" />
      </div>
      <div class="cheese-screenshot-win-actions">
        <button type="button" class="cheese-screenshot-cancel">취소</button>
        <button type="button" class="cheese-screenshot-save">저장</button>
      </div>`;
    win.querySelector(".cheese-screenshot-win-img").src = dataURL;

    // 위치·크기 복원(없으면 중앙 근처 기본).
    const saved = loadScreenshotRect();
    if (saved) {
      const { left, top } = clampToViewport(
        saved.left,
        saved.top,
        saved.w,
        saved.h,
      );
      win.style.left = `${left}px`;
      win.style.top = `${top}px`;
      win.style.width = `${saved.w}px`;
      win.style.height = `${saved.h}px`;
    } else {
      win.style.left = `${Math.round(window.innerWidth / 2 - 260)}px`;
      win.style.top = `${Math.round(window.innerHeight / 2 - 200)}px`;
    }

    win
      .querySelector(".cheese-screenshot-win-close")
      .addEventListener("click", () => closeScreenshotPreview());
    win
      .querySelector(".cheese-screenshot-cancel")
      .addEventListener("click", () => closeScreenshotPreview());
    win
      .querySelector(".cheese-screenshot-save")
      .addEventListener("click", () => {
        downloadScreenshot(dataURL, name, onScreenshotSaved);
        closeScreenshotPreview(true); // 저장으로 닫음 → 취소 토스트 안 띄움
      });

    document.body.appendChild(win);
    bindScreenshotDrag(win, win.querySelector(".cheese-screenshot-win-header"));
    // CSS resize:both 로 크기를 바꾼 뒤 마우스를 놓는 순간(pointerup) 크기 저장.
    // (ResizeObserver는 appendChild 직후 0 크기로 발화해 0px가 저장되던 문제가 있어 안 씀.)
    win.addEventListener("pointerup", () => saveScreenshotRect(win));
    document.addEventListener("keydown", onScreenshotModalKey);
  }

  // 헤더를 잡아 창을 이동. 이동 종료 시 위치 저장.
  function bindScreenshotDrag(win, handle) {
    handle.addEventListener("pointerdown", (e) => {
      // 닫기 버튼 위에서 시작한 드래그는 무시(버튼 클릭 우선).
      if (e.target.closest(".cheese-screenshot-win-close")) return;
      if (e.button !== 0) return;
      e.preventDefault();
      const rect = win.getBoundingClientRect();
      const offX = e.clientX - rect.left;
      const offY = e.clientY - rect.top;
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const { left, top } = clampToViewport(
          ev.clientX - offX,
          ev.clientY - offY,
          rect.width,
          rect.height,
        );
        win.style.left = `${left}px`;
        win.style.top = `${top}px`;
      };
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        saveScreenshotRect(win);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
    });
  }

  // ── 결과 토스트(성공/실패를 화면에 명확히 표시) ──────────────────────────────
  const SCREENSHOT_TOAST_ID = "cheese-screenshot-toast";
  let screenshotToastTimer = 0;
  function showScreenshotToast(ok, message) {
    document.getElementById(SCREENSHOT_TOAST_ID)?.remove();
    if (screenshotToastTimer) {
      clearTimeout(screenshotToastTimer);
      screenshotToastTimer = 0;
    }
    const toast = document.createElement("div");
    toast.id = SCREENSHOT_TOAST_ID;
    toast.className = `cheese-screenshot-toast ${ok ? "is-ok" : "is-fail"}`;
    toast.setAttribute("role", "status");
    toast.textContent = `${ok ? "📸 " : "⚠️ "}${message}`;
    document.body.appendChild(toast);
    // 진입 애니메이션 트리거.
    requestAnimationFrame(() => toast.classList.add("is-shown"));
    screenshotToastTimer = window.setTimeout(() => {
      toast.classList.remove("is-shown");
      window.setTimeout(() => toast.remove(), 250);
      screenshotToastTimer = 0;
    }, 2200);
  }

  // 아이콘/라벨을 현재 상태로 맞춘다. 멱등(변경 시만 갱신, 옵저버 자가발화 방지).
  function syncTabMuteButton() {
    const btn = document.querySelector(`.${TAB_MUTE_BUTTON_CLASS}`);
    if (!btn) return;
    const pressed = String(tabMutedState);
    if (btn.getAttribute("aria-pressed") === pressed) return;
    const label = tabMutedState ? "탭 음소거 해제" : "탭 음소거";
    btn.setAttribute("aria-pressed", pressed);
    btn.setAttribute("aria-label", label);
    btn.classList.toggle("is-muted", tabMutedState);
    const tip = btn.querySelector(".pzp-button__tooltip");
    const tipText = `${label} (Shift+M)`; // 단축키 유지(생성 시와 동일)
    if (tip && tip.textContent !== tipText) tip.textContent = tipText;
    const icon = btn.querySelector(".pzp-ui-icon");
    if (icon) icon.innerHTML = tabMuteIcon(tabMutedState);
  }

  let statsTimer = 0;

  function toggleStatsPanel() {
    if (document.getElementById(STATS_PANEL_ID)) closeStatsPanel();
    else openStatsPanel();
  }

  function openStatsPanel() {
    closeStatsPanel();
    const button = document.querySelector(`.${STATS_BUTTON_CLASS}`);
    const root = getPanelRoot(button) || findPlayer();
    if (!root) return;
    if (getComputedStyle(root).position === "static") {
      root.style.position = "relative";
    }
    root.style.overflow = "visible";
    const panel = document.createElement("div");
    panel.id = STATS_PANEL_ID;
    panel.className = "cheese-stream-stats-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "스트림 정보");
    root.appendChild(panel);
    keepControlsVisible(root, "stats");
    renderStatsPanel(panel);
    button?.setAttribute("aria-expanded", "true");
    // 영상이 잠깐(재렌더로 교체되는 한두 틱) 안 잡혀도 바로 닫지 않는다. 연속으로
    // 확실히 사라졌을 때(=페이지 이동)만 닫아 '저절로 사라짐'을 막는다.
    let statsMissStreak = 0;
    statsTimer = window.setInterval(() => {
      const p = document.getElementById(STATS_PANEL_ID);
      if (!p) {
        closeStatsPanel();
        return;
      }
      if (!isVideoAttached()) {
        statsMissStreak += 1;
        if (statsMissStreak >= 3) closeStatsPanel(); // 약 3초 연속 부재 시에만
        return;
      }
      statsMissStreak = 0;
      renderStatsPanel(p);
    }, STATS_REFRESH_MS);
  }

  function closeStatsPanel() {
    if (statsTimer) {
      window.clearInterval(statsTimer);
      statsTimer = 0;
    }
    releaseControlsVisible("stats");
    document.getElementById(STATS_PANEL_ID)?.remove();
    document
      .querySelector(`.${STATS_BUTTON_CLASS}`)
      ?.setAttribute("aria-expanded", "false");
  }

  function statsRow(label, value) {
    return `<div class="cheese-stats-row"><span>${label}</span><strong>${value ?? "—"}</strong></div>`;
  }

  function renderStatsPanel(panel) {
    const i = collectStreamInfo();
    const videoSection = i.audioOnly
      ? `<div class="cheese-stats-group-title">비디오</div>
         <p class="cheese-stats-note">오디오 전용 (라디오 모드)</p>`
      : `<div class="cheese-stats-group-title">비디오</div>
         ${statsRow("해상도", i.resolution)}
         ${statsRow("FPS", i.fps)}
         ${statsRow("비트레이트", i.videoBitrate)}
         ${statsRow("코덱", i.videoCodec)}
         ${statsRow("하드웨어 가속", gpuAccelLabel())}`;
    panel.innerHTML = `
      <div class="cheese-stats-head">
        <strong>스트림 정보</strong>
        <button type="button" class="cheese-mixer-close" data-stats-close aria-label="닫기">${closeIcon()}</button>
      </div>
      <div class="cheese-stats-body">
        ${i.isLive ? `<div class="cheese-stats-group-title">라이브</div>${statsRow("레이턴시", i.latency)}` : ""}
        ${videoSection}
        <div class="cheese-stats-group-title">오디오</div>
        ${statsRow("비트레이트", i.audioBitrate)}
        ${statsRow("코덱", i.audioCodec)}
        ${statsRow("채널", i.audioChannels)}
        ${statsRow("샘플 속도", i.audioSampleRate)}
      </div>`;
    panel
      .querySelector("[data-stats-close]")
      ?.addEventListener("click", closeStatsPanel);
    positionStatsPanel(panel);
  }

  function positionStatsPanel(panel) {
    // 버튼이 왼쪽 컨트롤 그룹에 있으면 패널도 왼쪽 정렬(원래 오른쪽에 뜨던 문제 수정).
    const btn = document.querySelector(`.${STATS_BUTTON_CLASS}`);
    const onLeft = !!btn?.closest(".pzp-pc__bottom-buttons-left");
    if (onLeft) {
      panel.style.left = `${PANEL_RIGHT_PX}px`;
      panel.style.right = "auto";
    } else {
      panel.style.right = `${PANEL_RIGHT_PX}px`;
      panel.style.left = "auto";
    }
    panel.style.bottom = `${PANEL_BOTTOM_PX}px`;
  }

  // 스트림 정보 버튼/패널 클릭 위임(오디오 믹서와 동일하게 document 레벨).
  // 탭 음소거 버튼 클릭(document 위임 — 플레이어 재렌더로 버튼이 교체돼도 동작).
  document.addEventListener("click", (e) => {
    const muteBtn = e.target.closest?.(`.${TAB_MUTE_BUTTON_CLASS}`);
    if (!muteBtn) return;
    e.preventDefault();
    e.stopPropagation();
    requestTabMuteToggle(); // 응답(cheese-tab-mute-content)으로 상태/아이콘 갱신
  });

  // 스크린샷 버튼 클릭(document 위임 — 플레이어 재렌더로 버튼이 교체돼도 동작).
  document.addEventListener("click", (e) => {
    const shotBtn = e.target.closest?.(`.${SCREENSHOT_BUTTON_CLASS}`);
    if (!shotBtn) return;
    e.preventDefault();
    e.stopPropagation();
    takeScreenshot();
  });

  // 스크린샷 단축키(Shift+S). 스크린샷 버튼이 표시된 상태에서, 채팅/입력 타이핑 중이
  // 아닐 때만 동작한다(치지직 기본 단축키와 겹치지 않게 Shift 조합 사용).
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.repeat) return;
      // Shift+S 만(다른 조합키가 섞이면 무시 — Ctrl/Alt/Meta 조합은 브라우저/OS용).
      if (e.ctrlKey || e.altKey || e.metaKey || !e.shiftKey) return;
      if (e.code !== "KeyS" && e.key !== "S" && e.key !== "s") return;
      if (featureFlags.screenshotButton) return; // 버튼 숨김=기능 끔
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement))
        return;
      // 플레이어가 있어야(라이브/다시보기) 캡처할 영상이 있다.
      if (!document.querySelector(".webplayer-internal-video")) return;
      e.preventDefault();
      e.stopPropagation();
      takeScreenshot();
    },
    true,
  );

  // 탭 음소거 단축키(Shift+M). 탭 음소거 버튼이 표시된 상태에서, 타이핑 중이 아닐 때만
  // 브라우저 탭 전체 음소거를 토글한다(스크린샷 Shift+S와 동일한 게이트).
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.repeat) return;
      if (e.ctrlKey || e.altKey || e.metaKey || !e.shiftKey) return;
      if (e.code !== "KeyM" && e.key !== "M" && e.key !== "m") return;
      if (featureFlags.tabMute) return; // 버튼 숨김=기능 끔
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement))
        return;
      // 플레이어(라이브/다시보기)가 있을 때만.
      if (!document.querySelector(".webplayer-internal-video")) return;
      e.preventDefault();
      e.stopPropagation();
      requestTabMuteToggle(); // 응답으로 상태/아이콘 갱신
    },
    true,
  );

  // 오디오 믹서 단축키(Shift+A). 믹서 버튼이 표시된 상태에서 타이핑 중이 아닐 때만,
  // 버튼 클릭과 동일하게 동작(패널 토글 또는 즉시 활성화 옵션 반영).
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.repeat) return;
      if (e.ctrlKey || e.altKey || e.metaKey || !e.shiftKey) return;
      if (e.code !== "KeyA" && e.key !== "A" && e.key !== "a") return;
      if (featureFlags.audioMixer) return; // 믹서 기능 숨김이면 끔
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement))
        return;
      if (!document.querySelector(".webplayer-internal-video")) return;
      e.preventDefault();
      e.stopPropagation();
      handleMixerButtonClick();
    },
    true,
  );

  // 스트림 정보 단축키(Shift+I). 스트림 정보 버튼이 표시된 상태에서 타이핑 중이
  // 아닐 때만 패널을 토글한다.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.repeat) return;
      if (e.ctrlKey || e.altKey || e.metaKey || !e.shiftKey) return;
      if (e.code !== "KeyI" && e.key !== "I" && e.key !== "i") return;
      if (featureFlags.streamStats) return; // 스트림 정보 숨김이면 끔
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement))
        return;
      if (!document.querySelector(".webplayer-internal-video")) return;
      e.preventDefault();
      e.stopPropagation();
      toggleStatsPanel();
    },
    true,
  );

  // ESC로 열린 패널 닫기(오디오 믹서 패널 / 스트림 정보 패널). 믹서 패널 내부의 빠른
  // 저장 이름 입력 모달이 열려 있으면 그 모달만 취소되도록 여기선 건드리지 않는다
  // (모달 취소는 패널 내부 keydown 리스너가 처리). 타이핑 중에도 ESC는 허용해야
  // 하지만, 모달/편집 입력의 ESC와 겹치지 않게 아래 순서로 판정한다.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "Escape") return;
      const mixerPanelOpen = !!(ui?.panel && document.body.contains(ui.panel));
      const statsPanelOpen = !!document.getElementById(STATS_PANEL_ID);
      // 스트림 정보 패널이 열려 있으면 우선 닫는다.
      if (statsPanelOpen) {
        e.preventDefault();
        e.stopPropagation();
        closeStatsPanel();
        return;
      }
      if (mixerPanelOpen) {
        // 패널 내부 모달(빠른 저장/커스텀 편집·내보내기·불러오기)이 열려 있으면 그
        // 모달만 취소되도록 여기선 건드리지 않는다(모달 취소는 내부 리스너/모달 로직).
        const modalOpen =
          quickSaveOpen ||
          customCreatorOpen ||
          customExportOpen ||
          customImportOpen ||
          !!customDialog;
        if (modalOpen) return;
        e.preventDefault();
        e.stopPropagation();
        closePanel();
      }
    },
    true,
  );

  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.(`.${STATS_BUTTON_CLASS}`);
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      toggleStatsPanel();
      return;
    }
    // 합성 클릭(isTrusted=false)은 무시 — 코드가 쏘는 .click()이 전파돼 패널이
    // 저절로 닫히던 문제 방지(사용자 바깥 클릭일 때만 닫는다).
    if (!e.isTrusted) return;
    const panel = document.getElementById(STATS_PANEL_ID);
    if (panel && !e.target.closest?.(`#${STATS_PANEL_ID}`)) {
      closeStatsPanel();
    }
  });

  // ══ 라이브 싱크 따라잡기 ════════════════════════════════════════════════════
  // 지연이 크면 버튼이 활성화되고, 클릭 시 2배속으로 라이브 엣지까지 따라잡은 뒤
  // 1배속으로 복귀한다. 라이브에서만 동작한다.
  let syncCheckTimer = 0;
  let seekCheckTimer = 0; // 되감기/앞으로 버튼 활성 갱신(따라잡기와 독립)
  let syncCatchUp = null; // { core, raf, startedAt, originalRate }
  // 자동 따라잡기: 전역 설정(localStorage, 모든 채널 공유). 직접 켠 게 아니므로
  // MAIN world에서 페이지 origin localStorage를 그대로 쓴다.
  let autoSyncEnabled = loadAutoSync();
  let lastAutoCatchUpAt = 0; // 자동 발동 쿨다운용
  let lastUserSeekAt = 0; // 사용자가 직접 seek한 시각(자동 따라잡기 일시 중단용)
  let autoCatchUpPauseUntil = 0; // 이 시각까지 자동 따라잡기 중단(seek 크기에 따라 길이 가변)
  let rewindButtonSeekUntil = 0; // 되감기 버튼이 일으킨 seek의 seeked까지 유효(짧은 되감기 판별)
  let syncSeekVideo = null; // seeked 리스너를 건 video(중복 등록 방지)
  let ourSeekUntil = 0; // 이 시각 이전의 seeked는 우리(jumpToLiveEdge)가 일으킨 것 → 무시
  let preSeekLatency = NaN; // seek 직전 지연(초). seeked에서 방향 판별에 사용
  // 라이브 페이지 최초 진입 후 자동 따라잡기를 1회 시도해야 하는 상태. 진입 직후엔
  // 플레이어 초기화로 seeked가 튀어 lastUserSeekAt이 찍히거나 쿨다운이 남아 자동이
  // 막힐 수 있으므로, 이 1회는 그 차단을 무시하고 발동시킨다(지연이 임계 미만이면
  // 발동 없이 플래그만 소진). tick의 페이지 전환에서 true로 세팅.
  let syncFreshLiveEntry = false;
  let freshEntryDeadline = 0; // 이 시각까지만 최초-진입 강제 시도(무한 대기 방지)

  function loadAutoSync() {
    try {
      return window.localStorage.getItem(SYNC_AUTO_STORE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function setAutoSync(enabled) {
    autoSyncEnabled = Boolean(enabled);
    try {
      window.localStorage.setItem(SYNC_AUTO_STORE_KEY, enabled ? "1" : "0");
    } catch {}
    updateSyncButtonState();
  }

  function syncIcon() {
    // 빨리감기(▷▷) 아이콘
    return `<svg class="pzp-ui-icon__svg" focusable="false" xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <path d="M11 12.5v11l8-5.5-8-5.5Z" fill="currentColor"></path>
      <path d="M19 12.5v11l8-5.5-8-5.5Z" fill="currentColor"></path>
    </svg>`;
  }

  function syncStopIcon() {
    // 정지(■) 아이콘 — 자동 따라잡기 해제용
    return `<svg class="pzp-ui-icon__svg" focusable="false" xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <rect x="12" y="12" width="12" height="12" rx="2" fill="currentColor"></rect>
    </svg>`;
  }

  // 버튼 아이콘을 빨리감기/정지 사이에서 교체(불필요한 재렌더 방지).
  function setSyncIcon(btn, stop) {
    const wantStop = Boolean(stop);
    if (btn.dataset.icon === (wantStop ? "stop" : "play")) return;
    const wrap = btn.querySelector(".pzp-ui-icon");
    if (wrap) wrap.innerHTML = wantStop ? syncStopIcon() : syncIcon();
    btn.dataset.icon = wantStop ? "stop" : "play";
  }

  function createSyncButton() {
    const btn = document.createElement("button");
    btn.className = `${SYNC_BUTTON_CLASS} pzp-pc__setting-button pzp-button pzp-pc-ui-button`;
    btn.type = "button";
    btn.disabled = true;
    btn.setAttribute("aria-label", "실시간 따라잡기");
    btn.dataset.icon = "play";
    btn.innerHTML = `<span class="pzp-button__tooltip pzp-button__tooltip--top">실시간 따라잡기</span><span class="pzp-ui-icon">${syncIcon()}</span>`;
    return btn;
  }

  // ── 라이브 되감기/앞으로(seekable 윈도우 내) ──────────────────────────────
  // 치지직 라이브는 seekable.start가 진입 시점에서 거의 고정이고 end만 전진하는
  // DVR 성격(측정 확인). 그래서 seekable.start ~ (라이브 엣지-여유) 안에서 ±10초
  // 이동을 제공한다. 과거로 가면 onUserSeeked가 lastUserSeekAt을 기록해 자동
  // 따라잡기가 잠시 멈춘다(우리가 ourSeekUntil을 설정하지 않으므로 '사용자 seek'로 인식).
  // 아이콘 안 숫자(N)는 step에 따라 1~2자리. font-size를 자릿수에 맞춰 줄인다.
  function rewindIcon() {
    const n = seekStepS;
    const fs = n >= 10 ? 8 : 9;
    return `<svg class="pzp-ui-icon__svg" focusable="false" xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <path d="M18 11a7 7 0 1 1-6.7 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"></path>
      <path d="M18 7.5 14 11l4 3.5V7.5Z" fill="currentColor"></path>
      <text x="18" y="21.5" text-anchor="middle" font-size="${fs}" font-weight="700" fill="currentColor">${n}</text>
    </svg>`;
  }

  function forwardIcon() {
    const n = seekStepS;
    const fs = n >= 10 ? 8 : 9;
    return `<svg class="pzp-ui-icon__svg" focusable="false" xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" fill="none" aria-hidden="true">
      <path d="M18 11a7 7 0 1 0 6.7 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"></path>
      <path d="M18 7.5 22 11l-4 3.5V7.5Z" fill="currentColor"></path>
      <text x="18" y="21.5" text-anchor="middle" font-size="${fs}" font-weight="700" fill="currentColor">${n}</text>
    </svg>`;
  }

  function createSeekButton(forward) {
    const btn = document.createElement("button");
    const cls = forward ? FORWARD_BUTTON_CLASS : REWIND_BUTTON_CLASS;
    btn.className = `${cls} pzp-pc__setting-button pzp-button pzp-pc-ui-button`;
    btn.type = "button";
    btn.disabled = true;
    const label = forward ? `${seekStepS}초 앞으로` : `${seekStepS}초 되감기`;
    const tip = forward
      ? `${seekStepS}초 앞으로 (→)`
      : `${seekStepS}초 되감기 (←)`;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = `<span class="pzp-button__tooltip pzp-button__tooltip--top">${tip}</span><span class="pzp-ui-icon">${forward ? forwardIcon() : rewindIcon()}</span>`;
    return btn;
  }

  // step 변경 시 이미 떠 있는 버튼의 아이콘/라벨을 갱신(재생성 없이).
  function refreshSeekButtonLabels() {
    const rew = document.querySelector(`.${REWIND_BUTTON_CLASS}`);
    const fwd = document.querySelector(`.${FORWARD_BUTTON_CLASS}`);
    if (rew) {
      rew.setAttribute("aria-label", `${seekStepS}초 되감기`);
      rew.innerHTML = `<span class="pzp-button__tooltip pzp-button__tooltip--top">${seekStepS}초 되감기 (←)</span><span class="pzp-ui-icon">${rewindIcon()}</span>`;
    }
    if (fwd) {
      fwd.setAttribute("aria-label", `${seekStepS}초 앞으로`);
      fwd.innerHTML = `<span class="pzp-button__tooltip pzp-button__tooltip--top">${seekStepS}초 앞으로 (→)</span><span class="pzp-ui-icon">${forwardIcon()}</span>`;
    }
  }

  // 현재 video의 되감기/앞으로 가능 여부를 반환. {video, start, end, cur}
  function getSeekWindow() {
    const v = findVideo();
    if (!v || !v.seekable || !v.seekable.length) return null;
    const start = v.seekable.start(0);
    const end = v.seekable.end(v.seekable.length - 1);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
      return null;
    return { video: v, start, end, cur: v.currentTime };
  }

  // 되감기/앞으로 오버레이 누적 표시용. 짧은 간격 내 같은 방향 연속이면 초를 합산.
  const SEEK_ACCUM_WINDOW_MS = 1200; // 이 간격 안의 같은 방향 조작은 누적(연타/홀드)
  let seekAccumSec = 0;
  let seekAccumForward = null;
  let seekAccumAt = 0;

  // ±step초 이동(seekable 윈도우로 클램프). forward=true면 앞으로.
  function seekBy(forward) {
    const w = getSeekWindow();
    if (!w) return;
    const step = forward ? seekStepS : -seekStepS;
    // 앞으로는 라이브 엣지 직전(여유 2초)까지만. 되감기는 윈도우 시작까지.
    const maxFwd = Math.max(w.start, w.end - SEEK_EDGE_PAD_S);
    let target = w.cur + step;
    target = Math.max(w.start, Math.min(maxFwd, target));
    if (Math.abs(target - w.cur) < 0.05) return; // 이미 끝/시작
    // ourSeekUntil은 일부러 설정하지 않는다 → onUserSeeked가 '사용자 seek'로
    // 인식해 되감기 시 자동 따라잡기를 잠시 멈춘다(의도된 동작).
    // 되감기 버튼으로 10초 이내만 되감았으면 '짧은 되감기'로 표시해 onUserSeeked가
    // 60초 대신 짧은(10초) 일시정지를 적용하게 한다(잠깐 놓친 부분 확인용).
    if (!forward && Math.abs(target - w.cur) <= SYNC_SHORT_REWIND_MAX_S + 0.5) {
      rewindButtonSeekUntil = Date.now() + 3000; // seeked가 곧 도착(여유 3초)
    }
    const moved = Math.round(Math.abs(target - w.cur)); // 실제 이동한 초(클램프 반영)
    w.video.currentTime = target;
    // 조작 화면 피드백(전역 옵션): 방향 아이콘 + 누적 초. 버튼/홀드/단축키 공통 실행점.
    // 짧은 시간(SEEK_ACCUM_WINDOW_MS) 내 '같은 방향' 연속 조작이면 초를 누적해서 보여준다
    // (꾹 누르기/연타 대응). 방향이 바뀌거나 시간이 지나면 리셋한다.
    const now = Date.now();
    if (
      seekAccumForward === forward &&
      now - seekAccumAt < SEEK_ACCUM_WINDOW_MS
    ) {
      seekAccumSec += moved;
    } else {
      seekAccumSec = moved;
      seekAccumForward = forward;
    }
    seekAccumAt = now;
    showActionOverlay(
      forward ? "forward" : "rewind",
      `${seekAccumSec}초`,
      forward ? "forward" : "rewind",
    );
    // 되감기로 라이브 엣지에서 유의미하게 뒤(과거)에 서면 hls 강제 동기화를 무력화해
    // 지연이 커져도 원점으로 튕기지 않게 한다. 엣지 근처로 복귀하면 원복.
    updateHlsRewindLock(target, w.end);
  }

  // 현재 목표 위치가 라이브 엣지에서 얼마나 뒤인지에 따라 hls 되감기 락을 켜고 끈다.
  // 엣지에서 REWIND_LOCK_MIN_BEHIND_S 이상 뒤면 락(강제 동기화 방지), 엣지 근처면 언락.
  const REWIND_LOCK_MIN_BEHIND_S = 5;
  function updateHlsRewindLock(target, liveEnd) {
    const behind = liveEnd - target;
    if (behind >= REWIND_LOCK_MIN_BEHIND_S) lockHlsForRewind();
    else unlockHlsForRewind();
  }

  // 버튼 활성/비활성 갱신: 윈도우 양 끝이면 해당 방향 버튼 비활성.
  function updateSeekButtonsState() {
    const rew = document.querySelector(`.${REWIND_BUTTON_CLASS}`);
    const fwd = document.querySelector(`.${FORWARD_BUTTON_CLASS}`);
    if (!rew && !fwd) return;
    const w = getSeekWindow();
    if (!w) {
      if (rew) rew.disabled = true;
      if (fwd) fwd.disabled = true;
      return;
    }
    const maxFwd = Math.max(w.start, w.end - SEEK_EDGE_PAD_S);
    if (rew) rew.disabled = w.cur - w.start < 0.5; // 더 되감을 게 없으면 비활성
    if (fwd) fwd.disabled = maxFwd - w.cur < 0.5; // 라이브 엣지면 비활성
  }

  function ensureSeekButtons() {
    // 라이브에서만, 그리고 되감기 기능이 숨김이 아닐 때만.
    if (!location.pathname.startsWith("/live/") || featureFlags.liveRewind) {
      removeSeekButtons();
      return;
    }
    const player = findPlayer();
    if (!player) return;
    const controls = sideControls(player, "rewind");
    if (!controls) return;
    // 여기서는 '존재 보장'만 한다(초기 대략 위치). 최종 위치는 arrangePlayerButtons 가
    // rewind/forward 각각의 slot 대로 재배치한다.
    const syncBtn = controls.querySelector(`.${SYNC_BUTTON_CLASS}`);
    const rightAnchor =
      controls.querySelector(`.${STATS_BUTTON_CLASS}`) ||
      controls.querySelector(".custom__clip-button") ||
      controls.firstChild;
    const baseAnchor =
      syncBtn || insertAnchorFor(controls, "rewind", rightAnchor);
    if (!controls.querySelector(`.${REWIND_BUTTON_CLASS}`)) {
      controls.insertBefore(createSeekButton(false), baseAnchor);
    }
    if (!controls.querySelector(`.${FORWARD_BUTTON_CLASS}`)) {
      // 따라잡기가 앵커면 그 다음(되감기·따라잡기·앞으로). 아니면 되감기 바로 다음
      // (되감기·앞으로가 붙게).
      const rewindBtn = controls.querySelector(`.${REWIND_BUTTON_CLASS}`);
      const fwdAnchor = syncBtn
        ? syncBtn.nextSibling
        : rewindBtn
          ? rewindBtn.nextSibling
          : baseAnchor;
      controls.insertBefore(createSeekButton(true), fwdAnchor);
    }
    startSeekCheck();
    updateSeekButtonsState();
  }

  // 되감기/앞으로 버튼 활성 상태를 1초 주기로 갱신(따라잡기 기능과 독립).
  function startSeekCheck() {
    if (seekCheckTimer) return;
    seekCheckTimer = window.setInterval(updateSeekButtonsState, SYNC_CHECK_MS);
  }

  function stopSeekCheck() {
    if (seekCheckTimer) {
      window.clearInterval(seekCheckTimer);
      seekCheckTimer = 0;
    }
  }

  function removeSeekButtons() {
    stopSeekCheck();
    document
      .querySelectorAll(`.${REWIND_BUTTON_CLASS}, .${FORWARD_BUTTON_CLASS}`)
      .forEach((b) => b.remove());
    // 되감기 바는 버튼과 독립(applyLiveSeekBar 가 관리) — 여기서 지우지 않는다. 예전엔
    // removeSeekBar() 를 불렀는데, 되감기 숨김 시 tick 이 removeSeekButtons(바 제거)→
    // applyLiveSeekBar(바 생성)를 반복해 전역 옵저버가 무한 발화하며 바가 진동했다.
  }

  // ── 라이브 되감기 바(seekable 구간 표시 + 드래그 seek) ──────────────────────
  // 치지직 라이브 프로그레스바는 현재를 항상 100%로 두고 되감기 가능 범위(seekable
  // 윈도우)를 시각적으로 보여주지 않으며, 그 슬라이더는 0x0로 접혀 실체가 없다.
  // 그래서 하단 컨트롤 바(.pzp-pc__bottom) 바로 위에 우리 바를 띄워 seekable 구간과
  // 현재 위치(playhead)를 표시하고, 드래그해 임의 지점으로 seek 한다. 컨트롤이
  // 보일 때만 나타난다. 자동 따라잡기 연동은 seekBy와 동일('사용자 seek' 인식).
  let seekBarRaf = 0;
  let seekBarDragging = false;
  let seekBarClsObs = null;
  let seekBarHovered = false; // 바 위에 마우스가 있는지(컨트롤 강제 유지용)

  // 라이브 프로그레스 슬라이더(.pzp-pc__progress-slider)는 라이브에선 0x0로 접혀
  // 실체가 없다(현재를 항상 100%로 두는 구조). 그래서 실제 폭을 가진 하단 컨트롤
  // 바(.pzp-pc__bottom)를 앵커로 삼아 그 위에 오버레이를 띄운다.
  function findSeekBarAnchor() {
    const player = findPlayer();
    return player?.querySelector(".pzp-pc__bottom") || null;
  }

  function seekBarTimeAt(clientX, barEl, w) {
    const r = barEl.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / (r.width || 1)));
    // 앞으로는 라이브 엣지 직전(여유)까지만 허용.
    const maxT = Math.max(w.start, w.end - SEEK_EDGE_PAD_S);
    return Math.max(
      w.start,
      Math.min(maxT, w.start + frac * (w.end - w.start)),
    );
  }

  // 드래그/클릭으로 target 시각으로 seek. 되감기(과거로)면 자동 따라잡기 pause 표시.
  function seekBarSeekTo(target, w) {
    if (!w || !w.video) return;
    if (Math.abs(target - w.video.currentTime) < 0.05) return;
    const back = target < w.video.currentTime;
    if (back && w.video.currentTime - target <= SYNC_SHORT_REWIND_MAX_S + 0.5) {
      rewindButtonSeekUntil = Date.now() + 3000; // 짧은 되감기 → 짧은 pause
    }
    try {
      w.video.currentTime = target;
    } catch {}
    // 되감기 바로 과거에 서면 hls 강제 동기화 무력화(엣지 복귀 시 원복).
    updateHlsRewindLock(target, w.end);
  }

  function ensureSeekBar() {
    // 되감기 바는 '되감기 바 표시' 토글(liveSeekBarOn)만 따른다. '라이브 되감기 숨김'
    // (featureFlags.liveRewind)은 플레이어의 되감기/앞으로 '버튼'만 숨기는 것이고, 바는
    // 별개다 — 버튼을 숨겨도 바로 seek 하고 싶다는 요청에 따라 바는 유지한다.
    if (!liveSeekBarOn) {
      removeSeekBar();
      return;
    }
    const player = findPlayer();
    if (!player) return;
    const anchor = findSeekBarAnchor();
    if (!anchor) return; // 컨트롤 바가 아직 없으면 다음 기회에
    let bar = player.querySelector(`:scope > .${SEEK_BAR_CLASS}`);
    if (!bar) {
      // 오버레이는 player(.pzp-pc)에 붙이고, 위치는 컨트롤 바 바로 위로 CSS가 잡는다.
      if (getComputedStyle(player).position === "static") {
        player.style.position = "relative";
      }
      bar = document.createElement("div");
      bar.className = SEEK_BAR_CLASS;
      bar.innerHTML =
        `<div class="${SEEK_BAR_CLASS}__track">` +
        `<div class="${SEEK_BAR_CLASS}__range"></div>` +
        `<div class="${SEEK_BAR_CLASS}__playhead"></div>` +
        `<div class="${SEEK_BAR_CLASS}__tip" style="display:none"></div>` +
        `</div>`;
      const track = bar.querySelector(`.${SEEK_BAR_CLASS}__track`);
      const tip = bar.querySelector(`.${SEEK_BAR_CLASS}__tip`);

      const onMove = (e) => {
        if (!seekBarDragging) return;
        e.preventDefault();
        const w = getSeekWindow();
        if (!w) return;
        seekBarSeekTo(seekBarTimeAt(e.clientX, track, w), w);
      };
      const onUp = () => {
        if (!seekBarDragging) return;
        seekBarDragging = false;
        bar.classList.remove("is-dragging");
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("mouseup", onUp, true);
      };
      // 오버레이 자체에서 mousedown을 잡아 치지직 슬라이더로 이벤트가 새지 않게 한다.
      track.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const w = getSeekWindow();
        if (!w) return;
        seekBarDragging = true;
        bar.classList.add("is-dragging");
        startSeekBarRender(); // 드래그 중 playhead 갱신 보장(중복 시작은 무시됨)
        seekBarSeekTo(seekBarTimeAt(e.clientX, track, w), w);
        document.addEventListener("mousemove", onMove, true);
        document.addEventListener("mouseup", onUp, true);
      });
      // 호버 툴팁: 라이브 엣지 대비 지연(-N초). 호버 지점이 현재 라이브보다 얼마나
      // 과거인지 보여준다(예 -1:20). 엣지 근처(여유 이내)면 'LIVE'.
      track.addEventListener("mousemove", (e) => {
        const w = getSeekWindow();
        if (!w) return;
        const r = track.getBoundingClientRect();
        const frac = Math.min(
          1,
          Math.max(0, (e.clientX - r.left) / (r.width || 1)),
        );
        const hoverT = w.start + frac * (w.end - w.start);
        const behind = w.end - hoverT; // 라이브 엣지 대비 지연(초)
        tip.textContent =
          behind <= SEEK_EDGE_PAD_S ? "LIVE" : `-${formatSeekBarTime(behind)}`;
        tip.style.left = `${frac * 100}%`;
        tip.style.display = "";
      });
      track.addEventListener("mouseleave", () => {
        tip.style.display = "none";
      });

      // 바 위에 마우스가 있는 동안 컨트롤이 자동 숨김되지 않게 유지한다. 치지직이
      // pzp-pc--controls를 떼려 하면(mousemove 합성으로는 안 먹었다) 아래 클래스
      // 옵저버가 즉시 다시 붙여 컨트롤을 강제로 유지한다. 나가면 해제한다.
      bar.addEventListener("mouseenter", () => {
        seekBarHovered = true;
        if (!player.classList.contains(CONTROLS_CLASS)) {
          player.classList.add(CONTROLS_CLASS);
        }
      });
      bar.addEventListener("mouseleave", () => {
        seekBarHovered = false;
      });

      player.appendChild(bar);

      // 컨트롤 표시(pzp-pc--controls)와 동기화. 바 호버 중엔 치지직이 클래스를 떼도
      // 즉시 다시 붙여 컨트롤을 유지한다(호버 keep-alive).
      const syncVisible = () => {
        if (seekBarHovered && !player.classList.contains(CONTROLS_CLASS)) {
          player.classList.add(CONTROLS_CLASS); // 옵저버 재진입 → 아래 on 계산
          return;
        }
        const on = seekBarDragging || player.classList.contains(CONTROLS_CLASS);
        bar.classList.toggle("is-visible", on);
        // 바가 실제로 보일 때만 60fps 렌더 루프를 돌린다. 컨트롤이 숨겨진 대부분의
        // 시청 시간엔 rAF 를 아예 멈춰 메인스레드 부하를 없앤다(지연/버벅임 완화).
        if (on) startSeekBarRender();
        else stopSeekBarRender();
      };
      seekBarClsObs?.disconnect();
      seekBarClsObs = new MutationObserver(syncVisible);
      seekBarClsObs.observe(player, {
        attributes: true,
        attributeFilter: ["class"],
      });
      syncVisible();
    }
  }

  function formatSeekBarTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor(sec / 60) % 60;
    const s = sec % 60;
    const p = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
  }

  function startSeekBarRender() {
    if (seekBarRaf) return;
    const loop = () => {
      renderSeekBar();
      seekBarRaf = requestAnimationFrame(loop);
    };
    seekBarRaf = requestAnimationFrame(loop);
  }

  function stopSeekBarRender() {
    if (seekBarRaf) {
      cancelAnimationFrame(seekBarRaf);
      seekBarRaf = 0;
    }
  }

  function renderSeekBar() {
    const bar = document.querySelector(`.${SEEK_BAR_CLASS}`);
    if (!bar) return;
    // 안 보이면(컨트롤 숨김·드래그 아님) 갱신 스킵(부담↓). 표시되면 다시 갱신.
    if (!bar.classList.contains("is-visible") && !seekBarDragging) return;
    const range = bar.querySelector(`.${SEEK_BAR_CLASS}__range`);
    const playhead = bar.querySelector(`.${SEEK_BAR_CLASS}__playhead`);
    const w = getSeekWindow();
    if (!w) {
      bar.classList.add("is-empty");
      return;
    }
    bar.classList.remove("is-empty");
    // 오버레이 폭 전체 = seekable(start~라이브 엣지). playhead는 현재 재생 위치 비율.
    const span = w.end - w.start || 1;
    const p = Math.min(1, Math.max(0, (w.video.currentTime - w.start) / span));
    // __range: 되감기 가능 영역 중 '이미 지나온(현재 이전)' 부분을 채워 강조.
    if (range) range.style.width = `${p * 100}%`;
    if (playhead) playhead.style.left = `${p * 100}%`;
  }

  function removeSeekBar() {
    stopSeekBarRender();
    seekBarHovered = false;
    seekBarDragging = false;
    if (seekBarClsObs) {
      seekBarClsObs.disconnect();
      seekBarClsObs = null;
    }
    document.querySelectorAll(`.${SEEK_BAR_CLASS}`).forEach((b) => b.remove());
  }

  // 토글 변경 시 즉시 반영: 켜졌고 라이브면 바 보장, 꺼졌으면 제거.
  function applyLiveSeekBar() {
    if (liveSeekBarOn && location.pathname.startsWith("/live/")) {
      ensureSeekBar();
    } else {
      removeSeekBar();
    }
  }

  function ensureSyncButton() {
    // 라이브에서만 표시한다.
    if (!location.pathname.startsWith("/live/")) {
      removeSyncButton();
      return;
    }
    const player = findPlayer();
    if (!player) return;
    const controls = sideControls(player, "sync");
    if (!controls || controls.querySelector(`.${SYNC_BUTTON_CLASS}`)) {
      startSyncCheck();
      return;
    }
    const btn = createSyncButton();
    // 스트림 정보 버튼 앞(클립 만들기 앞쪽)에 둔다. 왼쪽 배치면 믹서/필터 뒤.
    const rightAnchor =
      controls.querySelector(`.${STATS_BUTTON_CLASS}`) ||
      controls.querySelector(".custom__clip-button") ||
      controls.firstChild;
    controls.insertBefore(btn, insertAnchorFor(controls, "sync", rightAnchor));
    startSyncCheck();
  }

  function removeSyncButton() {
    stopSyncCheck();
    closeSyncMenu();
    document
      .querySelectorAll(`.${SYNC_BUTTON_CLASS}`)
      .forEach((b) => b.remove());
  }

  // 주기적으로 지연을 측정해 버튼 활성/비활성 + 툴팁 갱신.
  // 사용자가 과거로(뒤로) seek(타임머신 조작)할 때만 그 시각을 기록해 자동 따라잡기를
  // 잠시 멈춘다. 라이브 쪽(앞으로) seek나 우리가 jumpToLiveEdge로 일으킨
  // seek(ourSeekUntil)은 제외한다 — 그땐 다시 끌어당겨도 의도와 어긋나지 않는다.
  function onUserSeeking() {
    if (Date.now() < ourSeekUntil) return; // 우리가 일으킨 seek → 스냅샷 불필요
    preSeekLatency = getLiveLatencySeconds();
  }

  function onUserSeeked() {
    const shortRewind = Date.now() < rewindButtonSeekUntil;
    rewindButtonSeekUntil = 0; // 1회성 소비
    if (Date.now() < ourSeekUntil) return; // 우리가 일으킨 seek → 무시
    const after = getLiveLatencySeconds();
    // 과거로(뒤로) seek = 지연이 의미있게 늘어남. 앞으로/라이브 복귀(지연 감소)는 무시.
    // 측정 불가(NaN)일 땐 보수적으로 차단해 의도치 않은 끌어당김을 막는다.
    const movedBack =
      !Number.isFinite(preSeekLatency) ||
      !Number.isFinite(after) ||
      after - preSeekLatency >= SYNC_BACK_SEEK_MIN_S;
    if (movedBack) {
      lastUserSeekAt = Date.now();
      // 되감기 버튼으로 10초 이내만 되감았으면 짧게(10초)만 멈춘다. 그 외(재생바를
      // 크게 끌어 과거를 보는 등)는 기존대로 60초 멈춘다.
      autoCatchUpPauseUntil =
        Date.now() +
        (shortRewind ? SYNC_SHORT_REWIND_PAUSE_MS : SYNC_USER_SEEK_PAUSE_MS);
    }
    preSeekLatency = NaN;
  }

  // video는 채널 이동/재생성될 수 있으므로 매 체크마다 현재 video에 리스너를 보장한다.
  function ensureSeekListener() {
    const video = findVideo();
    if (video === syncSeekVideo) return;
    if (syncSeekVideo) {
      syncSeekVideo.removeEventListener("seeking", onUserSeeking);
      syncSeekVideo.removeEventListener("seeked", onUserSeeked);
    }
    syncSeekVideo = video || null;
    if (syncSeekVideo) {
      syncSeekVideo.addEventListener("seeking", onUserSeeking);
      syncSeekVideo.addEventListener("seeked", onUserSeeked);
    }
  }

  function startSyncCheck() {
    if (syncCheckTimer) return;
    syncCheckTimer = window.setInterval(updateSyncButtonState, SYNC_CHECK_MS);
    updateSyncButtonState();
  }

  function stopSyncCheck() {
    if (syncCheckTimer) {
      window.clearInterval(syncCheckTimer);
      syncCheckTimer = 0;
    }
    if (syncSeekVideo) {
      syncSeekVideo.removeEventListener("seeking", onUserSeeking);
      syncSeekVideo.removeEventListener("seeked", onUserSeeked);
      syncSeekVideo = null;
    }
  }

  // 버튼 툴팁 텍스트 갱신(지연 숫자 표시). 따라잡는 중엔 rAF 루프가 자주 호출해
  // 호버 상태에서 숫자가 실시간으로 줄어드는 걸 볼 수 있다.
  function setSyncTooltip(btn, lat, { catching = false } = {}) {
    const tip = btn?.querySelector(".pzp-button__tooltip");
    if (!tip) return;
    if (catching) {
      tip.textContent = Number.isFinite(lat)
        ? `따라잡는 중… (지연 ${lat.toFixed(1)}초)`
        : "따라잡는 중…";
    } else if (Number.isFinite(lat) && lat >= SYNC_JUMP_LATENCY_S) {
      tip.textContent = `라이브로 이동 (지연 ${formatLatency(lat)})`;
    } else {
      tip.textContent = Number.isFinite(lat)
        ? `실시간 따라잡기 (지연 ${lat.toFixed(1)}초)`
        : "실시간 따라잡기";
    }
  }

  // 지연을 사람이 읽기 쉽게: 60초 미만은 초, 이상은 분:초.
  function formatLatency(s) {
    if (s < 60) return `${s.toFixed(1)}초`;
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return `${m}분 ${sec}초`;
  }

  function updateSyncButtonState() {
    const btn = document.querySelector(`.${SYNC_BUTTON_CLASS}`);
    if (!btn) return;
    ensureSeekListener();
    // 자동 모드 표시(우클릭 메뉴로 토글). 자동이면 버튼에 표식을 둔다.
    btn.classList.toggle("is-auto", autoSyncEnabled);
    if (syncCatchUp) {
      // 따라잡는 중엔 항상 활성(클릭 시 중단). 툴팁은 rAF 루프가 갱신한다.
      btn.disabled = false;
      btn.classList.add("is-active");
      setSyncIcon(btn, false);
      btn.classList.remove("is-stop");
      return;
    }
    const lat = getLiveLatencySeconds();
    const overThreshold = Number.isFinite(lat) && lat >= syncCfg.enable;
    // 백오프 리셋 판단용: 임계 이상이면 '불안정' 시각을 갱신. 일정 시간 임계 아래로
    // 안정되면 canAutoCatchUp에서 쿨다운을 기본값으로 되돌린다.
    if (overThreshold) syncLastUnstableAt = Date.now();
    // 발동 임계 이상 + 점프 임계 미만이면 자동 발동 대상. 점프 임계 이상은 '타임머신으로
    // 과거를 보는 중'으로 간주해 자동 발동하지 않는다(라이브 복귀는 수동 버튼).
    const autoEligible =
      Number.isFinite(lat) &&
      lat >= syncCfg.enable &&
      lat < SYNC_JUMP_LATENCY_S;

    // 라이브 최초 진입 1회: 쿨다운/사용자 seek 차단을 무시하고 따라잡는다. 지연이
    // 측정되어 판단이 끝나면 플래그를 소진한다(임계 미만이면 발동 없이 소진). 평소
    // 자동 로직과 달리 점프 임계(SYNC_JUMP_LATENCY_S) 이상도 발동시킨다 — 진입 직후
    // 큰 지연은 '과거를 보는 중'이 아니라 단순 진입 지연이므로 라이브로 끌어온다.
    if (autoSyncEnabled && syncFreshLiveEntry) {
      if (Date.now() > freshEntryDeadline) {
        syncFreshLiveEntry = false; // 창 만료 → 강제 시도 종료, 평소 자동 로직으로
      } else if (Number.isFinite(lat) && canFreshEntryCatchUp()) {
        syncFreshLiveEntry = false; // 측정·판단 완료 → 1회 소진
        if (lat >= syncCfg.enable) {
          lastAutoCatchUpAt = Date.now();
          startSyncCatchUp(); // lat이 크면 내부에서 라이브 엣지로 점프
          return;
        }
        // 임계 미만: 따라잡을 것 없음. 아래 평소 로직으로 버튼 상태만 갱신.
      }
      // lat 측정 불가(NaN)이거나 아직 재생 전이면 소진하지 않고 다음 틱에 재시도.
    }

    // 자동 따라잡기: 임계 초과 + 점프 임계 미만 + 쿨다운 경과 + 안전조건이면 발동.
    if (autoSyncEnabled && autoEligible && canAutoCatchUp()) {
      lastAutoCatchUpAt = Date.now();
      // 지수 백오프: 발동할 때마다 다음 쿨다운을 2배로(상한까지). 네트워크가 계속
      // 못 따라가 자주 발동하면 간격을 벌려 1.5배속 끊김 구간을 줄인다. 안정되면
      // canAutoCatchUp에서 기본값으로 리셋된다.
      syncAutoCooldownMs = Math.min(
        SYNC_AUTO_COOLDOWN_MAX_MS,
        syncAutoCooldownMs * 2,
      );
      startSyncCatchUp();
      return;
    }

    // 수동: 활성화(클릭 가능)면 민트색, 비활성화면 흐리게(클릭 불가).
    btn.disabled = !overThreshold;
    btn.classList.toggle("is-active", overThreshold);

    // 자동 ON인데 지연이 작아 수동 버튼이 비활성일 때: 그대로 두면 자동을 끌 방법이
    // 눈에 띄지 않는다(우클릭 메뉴는 숨겨져 있음). 정지(■) 아이콘 + 활성 상태로 바꿔
    // 좌클릭으로 자동을 바로 해제할 수 있게 한다. 지연이 커서 수동이 활성일 땐 그
    // 본래 동작(따라잡기)을 유지한다.
    const showStop = autoSyncEnabled && !overThreshold;
    btn.classList.toggle("is-stop", showStop);
    setSyncIcon(btn, showStop);
    if (showStop) {
      btn.disabled = false;
      const tip = btn.querySelector(".pzp-button__tooltip");
      if (tip) tip.textContent = "자동 따라잡기 해제";
    } else {
      setSyncTooltip(btn, overThreshold ? lat : null);
    }
  }

  // 따라잡기 민감도 프리셋 적용(자동·수동 임계/목표 지연 모두). 알 수 없는 값이면 보통.
  // 커스텀 입력값을 안전 범위로 정규화. 목표 1~10초, 시작 2~30초, 시작 > 목표 보장.
  function normalizeSyncCustom(custom) {
    const c = custom && typeof custom === "object" ? custom : {};
    let target = Number(c.target);
    let enable = Number(c.enable);
    if (!Number.isFinite(target)) target = SYNC_PRESETS.normal.target;
    if (!Number.isFinite(enable)) enable = SYNC_PRESETS.normal.enable;
    target = Math.min(10, Math.max(1, target));
    enable = Math.min(30, Math.max(2, enable));
    // 시작 지연은 목표보다 최소 0.5초 커야 의미가 있다.
    if (enable <= target) enable = Math.min(30, target + 0.5);
    return { enable, target };
  }

  function applySyncPreset(key, custom) {
    const isCustom = key === "custom";
    const next = isCustom || SYNC_PRESETS[key] ? key : "normal";
    const nextCfg = isCustom
      ? normalizeSyncCustom(custom)
      : { ...SYNC_PRESETS[next] };
    // 키·값이 모두 그대로면 무시(커스텀은 값이 바뀔 수 있어 cfg까지 비교).
    if (
      next === syncPresetKey &&
      nextCfg.enable === syncCfg.enable &&
      nextCfg.target === syncCfg.target
    )
      return;
    syncPresetKey = next;
    syncCfg = nextCfg;
    // 프리셋이 바뀌면 백오프도 초기화(새 기준으로 다시 판단).
    syncAutoCooldownMs = SYNC_AUTO_COOLDOWN_BASE_MS;
    updateSyncButtonState();
  }

  // 따라잡기 배속 + 쿨다운 튜닝 적용. content.js 브리지에서 호출.
  //  rate: 1.2/1.5/2/3 (그 외 무시). cooldownEnabled: 쿨다운 사용 여부.
  //  cooldownCustom: {base,max}(초) 또는 null(기본 15~120초).
  function applySyncTuning(rate, cooldownEnabled, cooldownCustom) {
    const r = Number(rate);
    if ([1.2, 1.5, 2, 3].includes(r)) SYNC_RATE = r;
    syncCooldownOn = cooldownEnabled !== false; // 기본 ON
    if (
      cooldownCustom &&
      typeof cooldownCustom === "object" &&
      Number.isFinite(Number(cooldownCustom.base)) &&
      Number.isFinite(Number(cooldownCustom.max))
    ) {
      const base = Math.min(120, Math.max(5, Math.round(Number(cooldownCustom.base))));
      const max = Math.min(600, Math.max(base, Math.round(Number(cooldownCustom.max))));
      SYNC_AUTO_COOLDOWN_BASE_MS = base * 1000;
      SYNC_AUTO_COOLDOWN_MAX_MS = max * 1000;
    } else {
      SYNC_AUTO_COOLDOWN_BASE_MS = 15000;
      SYNC_AUTO_COOLDOWN_MAX_MS = 120000;
    }
    // 새 기준으로 현재 쿨다운 재설정(백오프 초기화).
    syncAutoCooldownMs = SYNC_AUTO_COOLDOWN_BASE_MS;
  }

  // 라이브 최초 진입 후 1회 강제 따라잡기를 무장한다(tick의 페이지 전환에서 호출).
  function armFreshLiveEntry() {
    syncFreshLiveEntry = true;
    freshEntryDeadline = Date.now() + SYNC_FRESH_ENTRY_WINDOW_MS;
  }

  // 최초-진입 강제 시도 발동 가능 조건: 쿨다운/사용자 seek 차단은 무시하되,
  // 영상이 실제 재생 중이어야 한다(아직 버퍼링/일시정지면 다음 틱에 재시도).
  function canFreshEntryCatchUp() {
    const video = findVideo();
    if (!video) return false;
    if (video.paused || video.seeking) return false;
    return true;
  }

  // 자동 따라잡기 발동 가능 조건: 쿨다운 경과 + 영상이 재생 중(일시정지/되감기
  // 중이 아님). 사용자가 의도적으로 멈추거나 되감을 땐 자동으로 끌어당기지 않는다.
  function canAutoCatchUp() {
    // 쿨다운 OFF: 백오프 없이 아주 짧은 최소 간격만 두고 바로 재발동(지연이 밀리면 즉시
    // 따라잡음). 대신 1.5배속 구간이 잦아질 수 있어 기본은 ON.
    if (!syncCooldownOn) {
      return Date.now() - lastAutoCatchUpAt >= SYNC_COOLDOWN_OFF_MS
        ? canAutoCatchUpBase()
        : false;
    }
    // 마지막 발동 이후 일정 시간 임계 아래로 안정됐으면 백오프를 기본값으로 리셋
    // (일시적 네트워크 저하가 끝나면 다시 민첩하게 따라잡도록).
    if (
      syncAutoCooldownMs > SYNC_AUTO_COOLDOWN_BASE_MS &&
      Date.now() - syncLastUnstableAt > SYNC_BACKOFF_RESET_MS
    ) {
      syncAutoCooldownMs = SYNC_AUTO_COOLDOWN_BASE_MS;
    }
    if (Date.now() - lastAutoCatchUpAt < syncAutoCooldownMs) return false;
    return canAutoCatchUpBase();
  }
  // 쿨다운 외 공통 안전조건(되감기/사용자 seek/재생상태 등). 위 canAutoCatchUp 에서 호출.
  function canAutoCatchUpBase() {
    // 사용자가 되감기로 라이브 엣지에서 유의미하게 뒤(과거)를 보는 중이면(hlsSeekLocked)
    // 자동으로 라이브로 끌어당기지 않는다. autoCatchUpPauseUntil(seek 후 일정 시간 정지)만
    // 으론 그 시간이 지나면 다시 발동해 원점으로 튕겼는데(자동 따라잡기 사용 시), 되감은
    // 상태를 유지하는 동안엔 계속 차단해야 한다. 락은 사용자가 앞으로/라이브 복귀할 때 풀린다.
    if (hlsSeekLocked) return false;
    // 사용자가 직접 과거로 seek했다면(타임머신) 일정 시간 자동 따라잡기를 멈춘다.
    // 의도적으로 과거를 보는 중인데 계속 라이브로 끌어당기지 않도록. 중단 길이는
    // seek 크기에 따라 가변(짧은 되감기=10초, 큰 seek=60초; onUserSeeked가 설정).
    if (Date.now() < autoCatchUpPauseUntil) return false;
    const video = findVideo();
    if (!video) return false;
    if (video.paused || video.seeking) return false;
    return true;
  }

  function toggleSyncCatchUp() {
    if (syncCatchUp) {
      stopSyncCatchUp();
    } else {
      startSyncCatchUp();
    }
  }

  // 배속 설정: video와 corePlayer 둘 다 시도(LLHLS는 corePlayer.playbackRate를
  // 쓰는 경우가 있다). 적용된 배속을 반환.
  function setPlaybackRate(core, video, rate) {
    try {
      if (video) video.playbackRate = rate;
    } catch {}
    try {
      if (core && "playbackRate" in core) core.playbackRate = rate;
    } catch {}
    return video?.playbackRate ?? rate;
  }

  function startSyncCatchUp() {
    const core = findCorePlayer();
    const video = findVideo();
    if (!core || !video) return;
    const lat = getLiveLatencySeconds(core);
    if (!Number.isFinite(lat) || lat < syncCfg.enable) return;

    // 지연이 크면(타임머신 등) 1.5배속 대신 라이브 엣지로 즉시 점프한다.
    if (lat >= SYNC_JUMP_LATENCY_S) {
      jumpToLiveEdge(core, video);
      return;
    }

    const originalRate = video.playbackRate || 1;
    setPlaybackRate(core, video, SYNC_RATE);
    if (video.playbackRate !== SYNC_RATE) return; // 배속 적용 실패
    const now = Date.now();
    syncCatchUp = {
      core,
      originalRate,
      startedAt: now,
      video,
      bestLat: lat, // 지금까지 본 최저 지연
      lastProgressAt: now, // 최저 지연이 의미있게 갱신된 마지막 시각
    };
    // 따라잡는 동안 재생바가 사라지지 않게 유지(지연 숫자 호버 확인 가능).
    const player = findPlayer();
    if (player) keepControlsVisible(player, "sync");
    updateSyncButtonState();

    const loop = () => {
      if (!syncCatchUp) return;
      const cur = getLiveLatencySeconds(syncCatchUp.core);
      const tnow = Date.now();
      const elapsed = tnow - syncCatchUp.startedAt;
      // 진전 추적: 최저 지연이 EPS 이상 줄면 진전 시각 갱신. 일정 시간 진전이 없으면
      // 스톨/버퍼링으로 라이브 엣지가 같이 밀려 따라잡지 못하는 상태 → 중단한다.
      if (Number.isFinite(cur)) {
        if (cur < syncCatchUp.bestLat - SYNC_PROGRESS_EPS_S) {
          syncCatchUp.bestLat = cur;
          syncCatchUp.lastProgressAt = tnow;
        }
      }
      const stalled = tnow - syncCatchUp.lastProgressAt > SYNC_NO_PROGRESS_MS;
      // 목표 도달 / 측정 불가 / 안전 시간 초과 / 진전 없음(스톨) / 사용자 속도 변경 시 종료.
      if (
        cur == null ||
        cur <= syncCfg.target ||
        elapsed > SYNC_MAX_DURATION_MS ||
        stalled ||
        syncCatchUp.video.playbackRate !== SYNC_RATE
      ) {
        stopSyncCatchUp();
        return;
      }
      // 호버 중 실시간 지연을 보여줘 숫자가 줄어드는 게 보이게 한다.
      const btn = document.querySelector(`.${SYNC_BUTTON_CLASS}`);
      setSyncTooltip(btn, cur, { catching: true });
      syncCatchUp.raf = requestAnimationFrame(loop);
    };
    syncCatchUp.raf = requestAnimationFrame(loop);
  }

  function stopSyncCatchUp() {
    if (!syncCatchUp) return;
    if (syncCatchUp.raf) cancelAnimationFrame(syncCatchUp.raf);
    // 우리가 바꾼 2배속일 때만 원복(사용자가 그새 바꿨으면 건드리지 않음).
    if (syncCatchUp.video.playbackRate === SYNC_RATE) {
      setPlaybackRate(
        syncCatchUp.core,
        syncCatchUp.video,
        syncCatchUp.originalRate || 1,
      );
    }
    syncCatchUp = null;
    releaseControlsVisible("sync"); // 따라잡기 끝 → 컨트롤 자동 숨김 복구
    updateSyncButtonState();
  }

  // 되감기/앞으로 버튼: 클릭 1회 + 꾹 누르면(pointerdown 유지) 연속 seek.
  let seekHoldTimer = 0;
  let seekHoldForward = false;
  function stopSeekHold() {
    if (seekHoldTimer) {
      // seekHoldTimer 는 처음엔 setTimeout(반복 시작 지연), 이후 setInterval 이다.
      // 둘 다 정리한다(브라우저 타이머 id 는 공유 공간이라 안전).
      clearTimeout(seekHoldTimer);
      clearInterval(seekHoldTimer);
      seekHoldTimer = 0;
    }
  }
  function doHeldSeek() {
    const btn = document.querySelector(
      `.${seekHoldForward ? FORWARD_BUTTON_CLASS : REWIND_BUTTON_CLASS}`,
    );
    // 해당 방향 끝(버튼 비활성)에 닿으면 반복 중단.
    if (!btn || btn.disabled) {
      stopSeekHold();
      updateSeekButtonsState();
      return;
    }
    seekBy(seekHoldForward);
    updateSeekButtonsState();
  }
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return; // 주 버튼만
      const rew = e.target.closest?.(`.${REWIND_BUTTON_CLASS}`);
      const fwd = e.target.closest?.(`.${FORWARD_BUTTON_CLASS}`);
      if (!rew && !fwd) return;
      const btn = rew || fwd;
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      seekHoldForward = Boolean(fwd);
      stopSeekHold();
      doHeldSeek(); // 즉시 1회(누르는 즉시 반응)
      // 꾹 누르는 동안 반복. 첫 반복은 살짝 늦게(400ms) 시작해 단발 클릭과 구분,
      // 이후 SEEK_HOLD_INTERVAL_MS 간격.
      seekHoldTimer = window.setTimeout(() => {
        seekHoldTimer = window.setInterval(doHeldSeek, SEEK_HOLD_INTERVAL_MS);
      }, 400);
    },
    true,
  );
  // 버튼에서 손을 떼거나 벗어나면 반복 중단.
  document.addEventListener("pointerup", stopSeekHold, true);
  document.addEventListener("pointercancel", stopSeekHold, true);
  // 우리 버튼은 click 도 발생하지만, pointerdown 에서 이미 처리하므로 click 은 삼킨다
  // (중복 seek 방지). 치지직 기본 동작으로도 전파되지 않게 한다.
  document.addEventListener(
    "click",
    (e) => {
      const on =
        e.target.closest?.(`.${REWIND_BUTTON_CLASS}`) ||
        e.target.closest?.(`.${FORWARD_BUTTON_CLASS}`);
      if (!on) return;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );

  // ── 방향키(←/→) = 10초 되감기/앞으로 ──────────────────────────────────────
  // 라이브 + 되감기 바 표시 상태에서, 타이핑/방향키소비 UI(슬라이더 등)가 아니면
  // 가로챈다(영상 아래·사이드바·헤더를 클릭해 포커스가 옮겨가도 동작). 가로챌 땐
  // capture+preventDefault+stopImmediatePropagation으로 치지직 네이티브 방향키 seek
  // 중복 발동을 막는다.

  // 입력/채팅/contentEditable에 포커스가 있으면 단축키 비활성.
  function isTypingTarget(t) {
    if (!t) return false;
    if (t.isContentEditable) return true;
    const tag = t.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  // 방향키를 '자체 조작'에 쓰는 요소에 포커스가 있으면 양보한다(슬라이더/라디오/탭 등).
  // 예: 볼륨/음량 슬라이더, 화질 라디오, 캐러셀 등. 이런 곳에선 우리가 가로채면 안 된다.
  function isArrowConsumingTarget(t) {
    if (!(t instanceof Element)) return false;
    const role = t.getAttribute?.("role");
    if (
      role === "slider" ||
      role === "radio" ||
      role === "radiogroup" ||
      role === "tab" ||
      role === "tablist" ||
      role === "listbox" ||
      role === "menu" ||
      role === "menubar" ||
      role === "spinbutton"
    )
      return true;
    // 치지직 자체 슬라이더/우리 슬라이더.
    if (t.closest?.("[class*='slider'], .pzp-ui-slider, [role='slider']"))
      return true;
    return false;
  }

  // 단축키를 받을 상황인가: 라이브 + 되감기 바 표시 + 타이핑/방향키소비 UI 아님.
  // 영상 아래·사이드바·헤더 등을 클릭해 포커스가 플레이어 밖으로 가도(마우스를 안
  // 움직여도) 방향키 seek 가 먹히도록, 포커스/포인터 위치 조건은 두지 않는다. 대신
  // 타이핑 중이거나 방향키를 자체로 쓰는 요소(슬라이더/라디오 등)일 때만 양보한다.
  function seekHotkeyAllowed(e) {
    // 방향키 seek 는 '되감기 바'(liveSeekBarOn) 또는 '되감기/앞으로 버튼'(featureFlags.
    // liveRewind=true 면 버튼 숨김) 중 하나라도 켜져 있으면 허용한다. 둘 다 꺼졌을 때만
    // 차단(바 없이 버튼만 켜도 방향키가 먹히도록 — 피드백 반영).
    const seekBarOn = liveSeekBarOn;
    const seekButtonsOn = !featureFlags.liveRewind;
    if (!seekBarOn && !seekButtonsOn) return false;
    if (!location.pathname.startsWith("/live/")) return false;
    if (isTypingTarget(e.target) || isTypingTarget(document.activeElement))
      return false;
    if (
      isArrowConsumingTarget(e.target) ||
      isArrowConsumingTarget(document.activeElement)
    )
      return false;
    if (!findPlayer()) return false; // 플레이어가 있는 라이브 화면일 때만
    return true;
  }

  // 방향키를 꾹 누르면(키 반복) 연속 되감기/앞으로. 다만 OS 키 반복 주기(수십 ms)마다
  // seek 하면 과도하니, SEEK_HOLD_INTERVAL_MS 간격으로 스로틀한다.
  const SEEK_HOLD_INTERVAL_MS = 130;
  let lastHeldSeekAt = 0;
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (!seekHotkeyAllowed(e)) return;
      // 키 반복(꾹 누름)이면 스로틀 간격을 지킨다. 첫 입력(repeat=false)은 항상 통과.
      if (e.repeat && Date.now() - lastHeldSeekAt < SEEK_HOLD_INTERVAL_MS) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      const w = getSeekWindow();
      if (!w) return;
      // 네이티브 ±N초 seek와 중복되지 않도록 우리가 가로채 ±10초로 통일.
      e.preventDefault();
      e.stopImmediatePropagation();
      lastHeldSeekAt = Date.now();
      seekBy(e.key === "ArrowRight");
      updateSeekButtonsState();
    },
    true,
  );

  // 따라잡기 버튼 클릭 위임.
  document.addEventListener("click", (e) => {
    // 메뉴 항목 클릭(자동 토글)
    const menuItem = e.target.closest?.(`#${SYNC_MENU_ID} [data-sync-auto]`);
    if (menuItem) {
      e.preventDefault();
      e.stopPropagation();
      setAutoSync(!autoSyncEnabled);
      closeSyncMenu();
      return;
    }
    // 메뉴 바깥 클릭 → 닫기
    if (
      document.getElementById(SYNC_MENU_ID) &&
      !e.target.closest?.(`#${SYNC_MENU_ID}`)
    ) {
      closeSyncMenu();
    }
    const btn = e.target.closest?.(`.${SYNC_BUTTON_CLASS}`);
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (btn.disabled) return;
    // 정지(■) 모드: 자동 따라잡기 해제 전용(따라잡기 발동 아님).
    if (btn.classList.contains("is-stop") && !syncCatchUp) {
      setAutoSync(false);
      closeSyncMenu();
      return;
    }
    toggleSyncCatchUp();
  });

  // 우클릭 → 자동 따라잡기 토글 메뉴
  // capture 단계 + stopImmediatePropagation으로 native 플레이어 컨텍스트 메뉴가
  // 함께 뜨는 것을 막는다(native 리스너에 도달하기 전에 차단).
  document.addEventListener(
    "contextmenu",
    (e) => {
      const btn = e.target.closest?.(`.${SYNC_BUTTON_CLASS}`);
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      openSyncMenu(btn);
    },
    true,
  );

  function openSyncMenu(btn) {
    closeSyncMenu();
    const root = getPanelRoot(btn) || findPlayer();
    if (!root) return;
    if (getComputedStyle(root).position === "static") {
      root.style.position = "relative";
    }
    const menu = document.createElement("div");
    menu.id = SYNC_MENU_ID;
    menu.className = "cheese-sync-menu";
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <button type="button" class="cheese-sync-menu-item" data-sync-auto role="menuitemcheckbox" aria-checked="${autoSyncEnabled}">
        <span class="cheese-sync-menu-check" aria-hidden="true">${autoSyncEnabled ? "✓" : ""}</span>
        <span>자동 따라잡기</span>
      </button>
      <p class="cheese-sync-menu-hint">지연이 ${syncCfg.enable}초를 넘으면 자동으로 따라잡습니다.<br>타임머신으로 과거를 볼 땐 자동 따라잡기를 멈춥니다.</p>`;
    root.appendChild(menu);
    // 버튼 위쪽에 배치(재생바 위로 뜨도록). 아이콘 오른쪽 끝 기준에서 조금 더
    // 오른쪽(-12px)·살짝 더 위(+14px)로.
    const rootRect = root.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    menu.style.bottom = `${rootRect.bottom - btnRect.top + 14}px`;
    let right = rootRect.right - btnRect.right - 100;
    right = Math.max(
      8,
      Math.min(right, root.clientWidth - menu.offsetWidth - 8),
    );
    menu.style.right = `${right}px`;
    keepControlsVisible(root, "sync-menu");
  }

  function closeSyncMenu() {
    document.getElementById(SYNC_MENU_ID)?.remove();
    releaseControlsVisible("sync-menu");
  }

  // ── 부트스트랩 ────────────────────────────────────────────────────────────
  // ── 음량 슬라이더 % 툴팁 ───────────────────────────────────────────────────
  // 치지직 native 볼륨 슬라이더에 현재 음량 %를 보여주는 툴팁을 얹는다. 슬라이더의
  // aria-valuenow가 드래그 중 갱신되므로 그 값을 읽어 표시한다(믹서 on/off 무관, 항상).
  let volumeTooltipHideTimer = 0;

  function findNativeVolumeSlider() {
    const player = findPlayer();
    if (!player) return null;
    // 우리 마스터 게인 슬라이더(data-master-gain)는 제외하고 native만 찾는다.
    const sliders = player.querySelectorAll(".pzp-pc__volume-slider");
    for (const s of sliders) {
      if (s.hasAttribute("data-master-gain")) continue;
      if (s.closest(`.${CONTROL_CLASS}`)) continue;
      return s;
    }
    return null;
  }

  function volumePercentOf(slider) {
    const now = Number(slider.getAttribute("aria-valuenow"));
    if (Number.isFinite(now)) return Math.round(now);
    // 폴백: progress scale에서 계산.
    const prog = slider.querySelector(".pzp-ui-progress__volume");
    const scale = Number(
      getComputedStyle(prog || slider).getPropertyValue(
        "--pzp-ui-progress__scale",
      ),
    );
    return Number.isFinite(scale) ? Math.round(scale * 100) : 0;
  }

  // ── 볼륨 슬라이더 % 툴팁(위임 방식) ────────────────────────────────────────
  // native 볼륨 슬라이더는 평소 폭 0(접힘)이라 슬라이더에 직접 리스너를 붙이면
  // 마우스가 못 올라가 툴팁이 간헐적으로 안 떴다(버그). 그래서 **볼륨 컨트롤 래퍼
  // (.pzp-pc__volume-control, 음소거 버튼 포함이라 크기 안정)** 위 이벤트를
  // document 위임으로 받고, 툴팁/MutationObserver는 ensureVolumeTooltip이 래퍼에
  // 멱등 보장한다(슬라이더 재생성과 무관하게 항상 동작).
  let volumeTooltipHovering = false; // 마우스가 볼륨 컨트롤 위에 있는지

  // 우리 게인 컨트롤이 아닌 native 볼륨 컨트롤 래퍼를 찾는다(이벤트 target 기준).
  function nativeVolumeWrapOf(target) {
    // document 위임(capture)으로 모든 pointer/wheel/key 이벤트에서 불린다. target이
    // Element가 아니거나(문서/텍스트노드) closest가 없을 수 있어 전부 방어한다 —
    // 여기서 throw하면 capture 리스너가 깨져 다른 동작까지 영향을 준다.
    const el =
      target instanceof Element
        ? target
        : target?.parentElement instanceof Element
          ? target.parentElement
          : null;
    const wrap = el?.closest?.(".pzp-pc__volume-control") || null;
    if (!wrap || wrap.classList?.contains?.(CONTROL_CLASS)) return null;
    const player = findPlayer();
    if (!player || !player.contains(wrap)) return null;
    return wrap;
  }

  function volumeTipOf(wrap) {
    return (
      wrap?.querySelector?.(
        `.${VOLUME_TOOLTIP_CLASS}:not(.cheese-gain-tooltip)`,
      ) || null
    );
  }
  function sliderOf(wrap) {
    return (
      wrap?.querySelector?.(".pzp-pc__volume-slider:not([data-master-gain])") ||
      null
    );
  }

  function setVolumeTooltipText(wrap) {
    const tip = volumeTipOf(wrap);
    const slider = sliderOf(wrap);
    if (!tip || !slider) return;
    const next = `${volumePercentOf(slider)}%`;
    if (tip.textContent !== next) tip.textContent = next;
  }

  // 이미 보이는 중이면 is-visible 재부여 안 함(transform transition 재시작 방지=떨림).
  function showVolumeTooltip(wrap) {
    const tip = volumeTipOf(wrap);
    if (!tip) return;
    if (!volumePctOn) {
      // 표시 끔 → 떠 있으면 즉시 숨기고 종료.
      tip.classList.remove("is-visible");
      return;
    }
    setVolumeTooltipText(wrap);
    if (!tip.classList.contains("is-visible")) tip.classList.add("is-visible");
    scheduleVolumeTooltipHide(tip);
  }

  function scheduleVolumeTooltipHide(tip) {
    if (volumeTooltipHideTimer) {
      clearTimeout(volumeTooltipHideTimer);
      volumeTooltipHideTimer = 0;
    }
    if (volumeTooltipHovering) return; // 호버 중엔 숨기지 않음
    volumeTooltipHideTimer = setTimeout(() => {
      tip.classList.remove("is-visible");
      volumeTooltipHideTimer = 0;
    }, VOLUME_TOOLTIP_HIDE_MS);
  }

  // 툴팁 span + aria-valuenow 옵저버를 native 볼륨 래퍼에 멱등 보장.
  function ensureVolumeTooltip() {
    const slider = findNativeVolumeSlider();
    if (!slider) return;
    const anchor = slider.closest(".pzp-pc__volume-control") || slider;
    if (anchor.dataset.cheeseVolTip === "1" && volumeTipOf(anchor)) return;
    anchor.dataset.cheeseVolTip = "1";
    // 래퍼에 절대배치(슬라이더는 폭 0이고 native 툴팁에 밀려 출렁이므로 래퍼 기준).
    if (getComputedStyle(anchor).position === "static") {
      anchor.style.position = "relative";
    }
    let tip = volumeTipOf(anchor);
    if (!tip) {
      tip = document.createElement("span");
      tip.className = VOLUME_TOOLTIP_CLASS;
      anchor.appendChild(tip);
    }
    // aria-valuenow가 바뀌는 동안(=조작 중) 텍스트만 라이브 갱신.
    const obs = new MutationObserver(() => {
      if (tip.classList.contains("is-visible")) setVolumeTooltipText(anchor);
    });
    obs.observe(slider, {
      attributes: true,
      attributeFilter: ["aria-valuenow"],
    });
  }

  // ── document 위임 리스너(1회 등록) ──────────────────────────────────────────
  function onVolumePointerOver(e) {
    const wrap = nativeVolumeWrapOf(e.target);
    if (!wrap) return;
    volumeTooltipHovering = true;
    ensureVolumeTooltip();
    showVolumeTooltip(wrap);
  }
  function onVolumePointerOut(e) {
    const wrap = nativeVolumeWrapOf(e.target);
    if (!wrap) return;
    // 같은 래퍼 안으로의 이동은 무시(여전히 호버 중).
    if (e.relatedTarget && wrap.contains(e.relatedTarget)) return;
    volumeTooltipHovering = false;
    scheduleVolumeTooltipHide(volumeTipOf(wrap));
  }
  function onVolumePointerMove(e) {
    if (!e.buttons) return; // 드래그 중에만 텍스트 갱신
    const wrap = nativeVolumeWrapOf(e.target);
    if (wrap) setVolumeTooltipText(wrap);
  }
  function onVolumeWheelOrKey(e) {
    const wrap = nativeVolumeWrapOf(e.target);
    if (!wrap) return;
    ensureVolumeTooltip();
    showVolumeTooltip(wrap);
  }

  // ── 영상 위 마우스 휠로 볼륨 조절(전역 옵션, 기본 OFF) ──────────────────────
  // 조절 간격(한 틱당 변화량)은 wheelVolumeStep(설정, 1~10% → 0.01~0.10).
  // 이벤트 target 이 플레이어 영상 영역 안인지(볼륨 컨트롤/설정 패널 등 UI 위는 제외).
  function isOverVideoArea(target) {
    const el = target instanceof Element ? target : target?.parentElement;
    if (!(el instanceof Element)) return null;
    const player = findPlayer();
    if (!player || !player.contains(el)) return null;
    // 컨트롤/설정/볼륨 등 상호작용 UI 위에서는 페이지 기본 동작을 방해하지 않는다.
    if (
      el.closest(
        ".pzp-pc__volume-control, .pzp-pc__bottom, [class*='setting'], [class*='pzp-pc__control'], button, input, [role='slider']",
      )
    ) {
      return null;
    }
    // 영상 영역(.pzp-pc__video) 우선, 없으면 플레이어 루트 안이면 허용.
    return el.closest(".pzp-pc__video") || player;
  }
  // 조절 후 볼륨 % 툴팁을 잠깐 띄워 피드백(native 볼륨 컨트롤 위치에 표시).
  function flashVolumeTooltip() {
    const slider = findNativeVolumeSlider();
    if (!slider) return;
    const wrap = slider.closest(".pzp-pc__volume-control");
    if (!wrap) return;
    ensureVolumeTooltip();
    showVolumeTooltip(wrap);
  }
  // 우클릭+휠 볼륨 조절을 쓴 뒤 버튼을 떼면 뜨는 contextmenu 를 막기 위한 것.
  // 실측 이벤트 순서: mousedown(2) → wheel(buttons=2) → mouseup(2) → contextmenu.
  // wheel 로 볼륨을 조절한 '시각'을 기록하고, 그 직후(창) 오는 contextmenu 를 억제한다
  // (플래그만으로는 다른 리스너/타이밍 간섭 시 놓칠 수 있어 시각 창으로 확실히 잡는다).
  let rightWheelUsedAt = 0;
  function onVideoWheelVolume(e) {
    if (!wheelVolumeOn) return;
    // '우클릭 중에만' 옵션: 오른쪽 버튼(buttons 비트 2)이 눌린 상태의 휠만 처리한다.
    // (옵션 OFF면 기존대로 버튼 무관하게 휠로 조절.)
    if (wheelVolumeRightClick && !(e.buttons & 2)) return;
    if (!isOverVideoArea(e.target)) return;
    const video = findVideo();
    if (!(video instanceof HTMLVideoElement)) return;
    // 페이지 스크롤 대신 볼륨을 조절한다(영상 위에서만).
    e.preventDefault();
    // 우클릭+휠을 썼으면, 곧 오는 contextmenu 를 억제하기 위해 시각을 기록한다.
    if (wheelVolumeRightClick) rightWheelUsedAt = Date.now();
    // deltaY<0(위로) = 볼륨↑, deltaY>0(아래로) = 볼륨↓.
    const dir = e.deltaY < 0 ? 1 : -1;
    let v = video.volume + dir * wheelVolumeStep;
    v = Math.max(0, Math.min(1, Math.round(v * 100) / 100));
    // 올릴 때 음소거 상태면 해제(직관적). 0으로 내려가면 자연히 무음.
    if (dir > 0 && video.muted) video.muted = false;
    video.volume = v; // UI 슬라이더(aria-valuenow)는 이 값으로 자동 동기화됨(실측)
    flashVolumeTooltip();
    const muted = video.muted || v === 0;
    // ⚠ 표시 % 는 방금 설정한 v 를 그대로 쓴다. video.volume 설정 직후 native 슬라이더의
    // aria-valuenow 는 아직 '이전 값'이라(치지직 비동기 갱신), 슬라이더를 읽으면 한 틱
    // 뒤처진 값이 나온다(실측: 실제35%인데 30% 표시). v 가 곧 정확한 목표값이다.
    const pct = Math.round(v * 100);
    showActionOverlay(
      muted ? "mute" : dir > 0 ? "volUp" : "volDown",
      `${pct}%`,
      "volume",
    );
  }

  // ── 조작 화면 피드백 오버레이(전역 옵션, 기본 ON) ───────────────────────────
  // 휠 볼륨/되감기/앞으로(버튼·홀드·단축키) 조작 시 플레이어 중앙에 반투명 아이콘+텍스트를
  // 잠깐 띄운다. 유튜브/넷플릭스식 피드백. 우리 요소만 쓰므로 치지직 DOM/React 안전.
  const ACTION_OVERLAY_ID = "cheese-action-overlay";
  let actionOverlayHideTimer = 0;
  const ACTION_OVERLAY_ICONS = {
    volUp: `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/><path d="M16 8a5 5 0 0 1 0 8M18.5 5.5a8.5 8.5 0 0 1 0 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    volDown: `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/><path d="M16 9.5a4 4 0 0 1 0 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    mute: `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/><path d="m16 9 5 6m0-6-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    rewind: `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" aria-hidden="true"><path d="M11 6 4 12l7 6V6ZM20 6l-7 6 7 6V6Z" fill="currentColor"/></svg>`,
    forward: `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" aria-hidden="true"><path d="M13 6l7 6-7 6V6ZM4 6l7 6-7 6V6Z" fill="currentColor"/></svg>`,
  };
  function getActionOverlayEl() {
    const player = findPlayer();
    if (!player) return null;
    let el = player.querySelector(`#${ACTION_OVERLAY_ID}`);
    if (!el) {
      el = document.createElement("div");
      el.id = ACTION_OVERLAY_ID;
      el.setAttribute("aria-hidden", "true");
      el.innerHTML = `<span class="cheese-ao-icon"></span><span class="cheese-ao-text"></span>`;
      // 플레이어 안에 두면 전체화면에서도 함께 보인다. static 이면 relative 로.
      if (getComputedStyle(player).position === "static") {
        player.style.position = "relative";
      }
      player.appendChild(el);
    }
    return el;
  }
  // kind: "volume" | "rewind" | "forward" — 종류별 on/off + 위치(중심 기준 %)를 적용한다.
  // 좌표계: 볼륨=전체 화면(x 그대로), 되감기=왼쪽 절반(x→x/2), 앞으로=오른쪽 절반(x→50+x/2).
  // y 는 셋 다 전체 화면 기준. OSD 중심이 그 지점에 오도록 left/top + translate(-50%,-50%).
  function showActionOverlay(iconKey, text, kind = "volume") {
    if (!actionOverlayOn) return;
    const cfg = actionOverlayPos[kind] || actionOverlayPos.volume;
    if (!cfg.on) return; // 이 종류 OSD 표시 꺼짐
    const el = getActionOverlayEl();
    if (!el) return;
    const iconEl = el.querySelector(".cheese-ao-icon");
    const textEl = el.querySelector(".cheese-ao-text");
    if (iconEl) iconEl.innerHTML = ACTION_OVERLAY_ICONS[iconKey] || "";
    if (textEl) textEl.textContent = String(text || "");
    // 기준계별 실제 left% 환산.
    let leftPct = cfg.x;
    if (kind === "rewind") leftPct = cfg.x / 2; // 0~100 → 0~50
    else if (kind === "forward") leftPct = 50 + cfg.x / 2; // 0~100 → 50~100
    // ⚠ OSD 는 중심(translate -50%,-50%) 기준이라 0%/100% 근처에서 절반이 화면 밖으로
    // 나간다. OSD 실제 크기의 '절반'을 플레이어 크기 대비 %로 구해, left/top 을 그만큼
    // 안쪽으로 clamp 해 항상 화면 안에 완전히 들어오게 한다.
    const player = el.parentElement;
    const pw = player?.clientWidth || 0;
    const ph = player?.clientHeight || 0;
    const halfX = pw ? ((el.offsetWidth / 2) / pw) * 100 : 0;
    const halfY = ph ? ((el.offsetHeight / 2) / ph) * 100 : 0;
    const clampAxis = (v, half) => Math.min(100 - half, Math.max(half, v));
    el.style.left = `${clampAxis(leftPct, halfX)}%`;
    el.style.top = `${clampAxis(cfg.y, halfY)}%`;
    // 재트리거 시 애니메이션 리셋(빠른 연속 조작에도 매번 뜨게).
    el.classList.remove("is-show");
    void el.offsetWidth; // reflow 로 애니메이션 리셋
    el.classList.add("is-show");
    clearTimeout(actionOverlayHideTimer);
    actionOverlayHideTimer = window.setTimeout(() => {
      el.classList.remove("is-show");
    }, 700);
  }

  let volumeDelegationBound = false;
  function bindVolumeTooltipDelegation() {
    if (volumeDelegationBound) return;
    volumeDelegationBound = true;
    document.addEventListener("pointerover", onVolumePointerOver, true);
    document.addEventListener("pointerout", onVolumePointerOut, true);
    document.addEventListener("pointermove", onVolumePointerMove, true);
    document.addEventListener("wheel", onVolumeWheelOrKey, {
      capture: true,
      passive: true,
    });
    document.addEventListener("keydown", onVolumeWheelOrKey, true);
    // 영상 위 휠 볼륨 조절: preventDefault 가 필요하므로 non-passive 로 별도 등록.
    // wheelVolumeOn 게이트로 옵션이 꺼져 있으면 즉시 반환한다.
    document.addEventListener("wheel", onVideoWheelVolume, {
      capture: true,
      passive: false,
    });
    // 우클릭+휠로 볼륨을 조절한 직후(2초 내) 오는 contextmenu 를 억제한다. 휠을 안 쓴
    // 순수 우클릭은 rightWheelUsedAt 이 오래됐거나 0 이라 메뉴가 정상적으로 뜬다.
    document.addEventListener(
      "contextmenu",
      (e) => {
        if (rightWheelUsedAt && Date.now() - rightWheelUsedAt < 2000) {
          e.preventDefault();
          e.stopPropagation();
          rightWheelUsedAt = 0;
        }
      },
      true,
    );
  }

  // tick fast-path 판정: 같은 페이지에서 우리 버튼·효과가 이미 모두 안정 상태인가.
  // 안정이면 tick의 무거운 ensure들을 건너뛴다(라이브 채팅 변이로 자주 깨어나므로).
  // 하나라도 애매하면 false를 반환해 full tick으로 보정한다(버튼 누락 방지).
  function isTickStable() {
    const player = findPlayer();
    if (!player) return false; // 플레이어 없으면 full tick(자동활성화 등 처리 필요)
    const controls = player.querySelector(".pzp-pc__bottom-buttons-right");
    if (!controls) return false;
    const isLive = location.pathname.startsWith("/live/");
    // 켜진 기능의 버튼이 컨트롤 바에 실제로 있어야 안정. (숨김이면 없어야 안정.)
    const has = (cls) => !!controls.querySelector(`.${cls}`);
    // 오디오 믹서
    if (featureFlags.audioMixer) {
      if (document.getElementById(PANEL_ID) || has(BUTTON_CLASS)) return false;
    } else {
      if (!has(BUTTON_CLASS)) return false;
      // 믹서가 켜졌는데(state.enabled) 그래프가 안 붙었으면 보정 필요.
      if (state.enabled && !audio.connected) return false;
      if (!state.enabled && audio.connected) return false;
    }
    // 스트림 정보
    if (
      featureFlags.streamStats
        ? has(STATS_BUTTON_CLASS)
        : !has(STATS_BUTTON_CLASS)
    )
      return false;
    // 탭 음소거
    if (
      featureFlags.tabMute
        ? has(TAB_MUTE_BUTTON_CLASS)
        : !has(TAB_MUTE_BUTTON_CLASS)
    )
      return false;
    // 스크린샷
    if (
      featureFlags.screenshotButton
        ? has(SCREENSHOT_BUTTON_CLASS)
        : !has(SCREENSHOT_BUTTON_CLASS)
    )
      return false;
    // 라이브 전용: 따라잡기 / 되감기 버튼
    if (isLive) {
      if (
        featureFlags.liveSync ? has(SYNC_BUTTON_CLASS) : !has(SYNC_BUTTON_CLASS)
      )
        return false;
      if (
        featureFlags.liveRewind
          ? has(REWIND_BUTTON_CLASS)
          : !has(REWIND_BUTTON_CLASS)
      )
        return false;
    }
    // 자동 넓은 화면 적용이 아직 남아 있으면(이 미디어에 미적용) full tick 필요.
    if (wideScreenAuto && wideScreenAppliedForPage !== currentPageKey)
      return false;
    // '항상 켜기'가 켜졌는데 아직 자동 활성화 전이면 full tick.
    if (
      mixerAlwaysOn &&
      userGestureSeen &&
      stateLoaded &&
      !audio.connected &&
      !state.userDisabled &&
      !featureFlags.audioMixer &&
      !graphConflict
    ) {
      return false;
    }
    return true;
  }

  function tick() {
    // 클립 만들기(클립 에디터)에선 오디오 믹서를 개입시키지 않는다. seeker 드래그로
    // DOM 이 매 프레임 바뀌는데 여기서 video 탐색/그래프 판정을 돌리면 영상이 버벅인다.
    if (location.pathname.startsWith("/clip-editor")) return;
    const pageKey = getPageKey();
    if (!pageKey) {
      // 라이브/다시보기 URL을 벗어남. 단, 플레이어가 PIP(미니플레이어)로 떠 계속
      // 재생 중이면 오디오 믹서 그래프를 유지해야 한다(teardown하면 PIP 소리에
      // 효과가 빠졌다가 클릭해야 복구되던 문제).
      //
      // 핵심: MediaElementSourceNode는 video 요소에 '영구 바인딩'된다.
      // 한 번 연결하면 PIP·페이지 이동으로 video가 DOM에서 옮겨져도
      // 연결이 안 끊긴다. 그러니 이미 그래프가 붙어 있고(audio.connected) 그 video가
      // 아직 살아 있으면 절대 teardown하지 않는다 — 재연결(제스처 필요)을 아예
      // 없애 PIP·재진입에서 소리가 원음으로 새는 문제를 막는다.
      const liveVideo = audio.video || findVideo();
      const videoAlive =
        liveVideo instanceof HTMLVideoElement &&
        liveVideo.isConnected &&
        !liveVideo.ended;
      const keepGraph =
        currentPageKey &&
        (isPipActive() || (audio.connected && videoAlive) || videoAlive);
      if (keepGraph) {
        if (!featureFlags.audioMixer) ensureEnabledGraph();
        return;
      }
      if (currentPageKey) {
        teardownGraph();
        closePanel();
        removeButton();
        closeStatsPanel();
        removeStatsButton();
        stopSyncCatchUp();
        removeSyncButton();
        clearGraphRetryBlock();
        currentPageKey = null;
        currentMediaId = null;
      }
      return;
    }
    if (pageKey !== currentPageKey) {
      currentPageKey = pageKey;
      currentMediaId = null; // 채널id는 아래에서 비동기로 해석
      // 새 미디어 → 넓은 화면 자동 적용을 다시 1회 허용(버튼이 늦게 떠도 잠깐 재시도).
      wideScreenAppliedForPage = null;
      wideScreenRetryUntil = Date.now() + 8000;
      // 새 미디어 → 최대 화질 자동 고정 상태 리셋(이전 영상의 수동 존중을 새 영상까지
      // 끌고 가지 않는다).
      maxQualitySetHeight = 0;
      maxQualityRespectedPage = null;
      maxQualityMenuClickAt = 0;
      if (maxQualityCatchupTimer) {
        clearTimeout(maxQualityCatchupTimer);
        maxQualityCatchupTimer = 0;
      }
      pendingUserEdit = false;
      stateLoaded = false; // 새 미디어 → 저장 설정 로드 전(자동 활성화 대기)
      state = DEFAULT_STATE();
      customDraft = null;
      draftBackup = null; // 미디어 전환 → 이전 드래프트 복원 대상 무효
      clearPresetDirty();
      teardownGraph();
      stopSyncCatchUp(); // 미디어 전환 시 따라잡기 중단
      // 미디어 전환 → 옛 hls 인스턴스는 사라지므로 되감기 락 상태만 리셋(원복 대상 없음).
      hlsSeekLocked = false;
      // 새 페이지 진입 → 라이브면 최초 1회 강제 따라잡기를 무장한다(라이브가 아니면
      // 따라잡기 버튼이 없어 자연 소진). 진입 직후 seeked/쿨다운 차단을 무시한다.
      armFreshLiveEntry();
      audio.source = null; // 미디어 전환 시 새 video
      audio.video = null;
      graphConflict = false; // 충돌은 video별 조건 → 새 영상에선 다시 시도 가능
      clearGraphRetryBlock();
      resolveAndLoadChannel(pageKey);
    } else if (forceFullTick) {
      // 플래그 변경 직후 등 — 이번엔 fast-path를 건너뛰고 full로 처리한다.
      forceFullTick = false;
    } else if (isTickStable()) {
      // 미디어 전환이 아니고, 우리 버튼·효과가 모두 이미 안정 상태면 무거운 ensure
      // 들(findPlayer/querySelector 반복)을 건너뛴다. '할 일이 있을 때만' 일한다.
      // 라이브 채팅 변이로 tick이 자주 깨어나도 대부분 여기서 빠진다.
      return;
    }
    // 팝업 기능 숨김 플래그 반영. 숨김이면 버튼 제거 + 효과 off(믹서/따라잡기).
    if (featureFlags.audioMixer) {
      closePanel();
      removeButton();
      teardownGraph();
    } else {
      ensureButton();
      ensureEnabledGraph();
    }
    if (featureFlags.streamStats) {
      closeStatsPanel();
      removeStatsButton();
    } else {
      ensureStatsButton();
    }
    if (featureFlags.liveSync) {
      stopSyncCatchUp();
      removeSyncButton();
    } else {
      ensureSyncButton();
    }
    if (featureFlags.liveRewind) {
      removeSeekButtons();
    } else {
      ensureSeekButtons();
    }
    // 되감기 바는 되감기/앞으로 '버튼'(liveRewind)과 독립 — 버튼을 숨겨도 바는 유지한다.
    // 그래서 버튼 분기 밖에서 항상 재평가한다(내부는 liveSeekBarOn 만 따름).
    applyLiveSeekBar();
    if (featureFlags.tabMute) {
      removeTabMuteButton();
    } else {
      ensureTabMuteButton();
    }
    if (featureFlags.screenshotButton) {
      removeScreenshotButton();
    } else {
      ensureScreenshotButton();
    }
    // 우리 버튼들을 order 대로 정렬(순서 이미 맞으면 no-op). 재렌더로 순서가 흐트러져도
    // 다음 tick 에서 복구된다.
    arrangePlayerButtons();
    // 음량 % 툴팁은 믹서 on/off와 무관하게 항상 부착(기본 볼륨 조작 보조).
    bindVolumeTooltipDelegation(); // 위임 리스너 1회 등록
    ensureVolumeTooltip();
    // 제스처 없이 진입해도 방송 재생 시 resume 을 시도하도록 video 에 바인딩(자동재생
    // 허용 환경에서 클릭 없이 믹서가 걸리게).
    bindVideoAutoEnable();
    // '항상 켜기' 자동 활성화(첫 제스처 이후, 미디어 준비되면). 미디어 전환 시
    // graphConflict는 tick의 페이지 전환 분기에서 초기화되므로 새 영상엔 다시 시도.
    maybeAutoEnableMixer();
    // 넓은 화면 자동 적용(미디어당 1회). viewmode 버튼이 늦게 떠도 잠깐 재시도.
    maybeAutoWideScreen();
    // 최대 화질 자동 고정(켜져 있으면). 이벤트 바인딩으로 재생 시작 즉시 걸고, tick 에서도
    // 멱등 재확인(이미 최고면 no-op, 사용자 하락 존중 등 상태 추적).
    bindMaxQualityEvents();
    applyMaxQuality();
  }

  // 치지직 플레이어의 '넓은 화면'(viewmode) 버튼. 라이브/다시보기 공통.
  // (aria-label은 상태에 따라 '넓은 화면'/'좁은 화면'으로 바뀌므로 클래스로 찾는다.)
  function findViewModeButton() {
    const player = findPlayer();
    const root = player || document;
    return (
      root.querySelector(".pzp-pc__viewmode-button") ||
      root.querySelector(".pzp-pc-viewmode-button") ||
      root.querySelector(".pzp-viewmode-button") ||
      root.querySelector(
        "button[aria-label='넓은 화면'], button[aria-label='좁은 화면']",
      )
    );
  }

  // 넓은 화면이 이미 켜져 있는지 판정. pzp-button--clicked는 두 상태 모두 붙어 있어
  // 쓸 수 없다. 켜지면 checked 속성이 붙고 aria-label이 '좁은 화면'(누르면 좁아짐)
  // 으로 바뀐다 — 이 둘로 판정한다.
  function isWideScreenOn(btn) {
    if (!btn) return false;
    return (
      btn.hasAttribute("checked") ||
      btn.getAttribute("aria-label") === "좁은 화면"
    );
  }

  // '넓은 화면 자동 적용'이 켜져 있으면 플레이어 진입 시 viewmode를 1회 켠다. 이미
  // 켜져 있으면 클릭하지 않는다(토글 무한루프 방지). 버튼이 아직 없으면 재시도
  // 마감 시각까지 다음 tick에서 다시 시도한다. 미디어당 1회만 적용한다.
  function maybeAutoWideScreen() {
    if (!wideScreenAuto) return;
    if (!currentPageKey) return; // 라이브/다시보기 페이지에서만
    if (wideScreenAppliedForPage === currentPageKey) return; // 이미 이 미디어에 적용함
    const btn = findViewModeButton();
    if (!btn || !isElementRendered(btn)) {
      // 버튼이 아직 없음 — 재시도 마감 전이면 다음 tick에서 다시 시도.
      if (Date.now() > wideScreenRetryUntil) {
        wideScreenAppliedForPage = currentPageKey; // 마감 → 더 시도 안 함
      }
      return;
    }
    if (!isWideScreenOn(btn)) {
      try {
        btn.click();
      } catch {}
    }
    wideScreenAppliedForPage = currentPageKey; // 1회 적용 완료(켜져 있었어도 소진)
  }

  // 페이지의 채널id를 비동기로 확보한 뒤 해당 채널 설정을 로드한다. 해석 도중
  // 페이지가 바뀌면(currentPageKey 변경) 결과를 버린다(race 방지).
  async function resolveAndLoadChannel(pageKey) {
    const channelId = await resolveChannelId(pageKey);
    if (currentPageKey !== pageKey) return; // 그새 페이지가 바뀜
    if (!channelId) {
      // 채널id 확보 실패 — 기본 설정으로 동작. 로드할 게 없으니 자동 활성화 허용.
      stateLoaded = true;
      maybeAutoEnableMixer();
      return;
    }
    currentMediaId = channelId;
    // 채널id 확보 전 대기 중이던 사용자 변경이 있으면 먼저 저장(그 값이 storage 에 반영)
    // 하되, 로드는 '항상' 한다. 저장 직후 loaded 로 그 값(+전역 커스텀/기본값)을 다시
    // 받으므로 덮어쓰기 문제 없이 커스텀 프리셋·전역 기본값을 정상 복원한다. (예전엔
    // pendingUserEdit 이면 로드를 건너뛰어, 새 채널에서 커스텀 목록이 비고 전역값이
    // 원본으로 나타났다.)
    if (pendingUserEdit) {
      pendingUserEdit = false;
      saveState({ forcePresets: true }); // 대기 변경엔 커스텀 편집도 있을 수 있어 강제 저장
    }
    requestState(channelId); // loaded 수신 시 stateLoaded=true
  }

  // documentElement 전체(subtree childList)를 감시하므로 라이브 채팅·재생 UI 변이가
  // 초당 수십~수백 번 콜백을 부른다. tick은 findPlayer/querySelector를 여러 번 도는
  // 무거운 작업이라, 매 변이마다 실행하면 페이지가 버벅인다. 디바운스로 변이가 몰려도
  // '250ms에 1회'만 tick을 돌린다(우리 버튼 주입이 유발한 변이도 같은 창에 흡수돼
  // 재진입 폭주가 없다). 예전 80ms 때는 채팅 폭주 방송에서 tick이 초당 ~12회 돌아
  // 메인스레드의 ~58%를 차지했고(프로파일 실측), 미디어 파이프라인을 굶겨 간헐 버퍼링과
  // 렌더러 메모리 증가의 주 원인이 됐다. 버튼/효과 보정은 4회/초로 충분하다.
  let tickTimer = 0;
  function scheduleTick() {
    if (tickTimer) return;
    tickTimer = window.setTimeout(() => {
      tickTimer = 0;
      // 백그라운드 탭에선 UI 보정이 무의미하다(버튼은 어차피 안 보임) — tick을 건너뛴다.
      // 탭이 다시 보이면 다음 변이(채팅 등으로 상시 발생)가 곧바로 tick을 다시 돌린다.
      if (document.hidden) return;
      tick();
    }, 250);
  }
  const observer = new MutationObserver(scheduleTick);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  tick();
})();
