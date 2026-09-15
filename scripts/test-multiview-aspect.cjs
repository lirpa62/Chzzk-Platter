// 모든 배치에서 각 칸이 실제로 16:9 로 렌더되는지 잰다(헤드리스 크롬 + CDP).
//
// ⚠ 이 검증은 계산이 아니라 실측이다. aspect-ratio 와 max-height/width 조합은
//   flex 자식에서 배치에 따라 다르게 풀린다 — width:100% 는 납작한 칸에서
//   가로로(5.70), height:100% 는 좁은 칸에서 세로로(0.36) 늘어났다. 지금은
//   칸을 container 로 두고 min() 으로 직접 계산한다.
const { spawn } = require("node:child_process");
const { readFileSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const ROOT = process.cwd();
const dir = mkdtempSync(join(tmpdir(), "mv-aspect-"));
const browser = spawn(
  process.env.CHROME_BIN ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--remote-debugging-pipe",
    `--user-data-dir=${dir}`,
  ],
  { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
);
let buffer = "",
  seq = 0;
const pending = new Map();
browser.stdio[4].on("data", (chunk) => {
  buffer += chunk;
  for (let end; (end = buffer.indexOf("\0")) >= 0;) {
    const raw = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!raw) continue;
    const msg = JSON.parse(raw),
      job = pending.get(msg.id);
    if (!job) continue;
    pending.delete(msg.id);
    msg.error
      ? job.reject(Error(JSON.stringify(msg.error)))
      : job.resolve(msg.result);
  }
});
const call = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    browser.stdio[3].write(
      JSON.stringify({ id, method, params, sessionId }) + "\0",
    );
  });

(async () => {
  const { targetId } = await call("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await call("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const cmd = (m, p) => call(m, p, sessionId);
  const ev = async (expression) => {
    const r = await cmd("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await cmd("Network.enable");
  await cmd("Network.setBlockedURLs", { urls: ["http://*", "https://*"] });
  await cmd("Emulation.setDeviceMetricsOverride", {
    width: 1600,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await ev(
    "document.documentElement.innerHTML=" +
      JSON.stringify(readFileSync(join(ROOT, "multiviewWatch.html"), "utf8")),
  );
  await ev("document.querySelectorAll('script,link').forEach(e=>e.remove())");
  const css = readFileSync(join(ROOT, "src/multiview.css"), "utf8");
  await ev(
    `{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s);}`,
  );
  await ev(readFileSync(join(ROOT, "src/multiviewLayouts.js"), "utf8"));

  // 배치별로 칸을 직접 구성해 비율을 잰다(iframe 없이 상자만).
  const out = await ev(`(()=>{
    const L=CheeseMultiviewLayouts;
    const frames=document.getElementById('mvFrames');
    const stage=document.getElementById('mvStage');
    const chat=document.getElementById('mvChat');
    const res=[];
    for(const layout of L.LAYOUTS){
      const n=layout.aux+1;
      const {direction,side}=L.stageStyle(layout,'');
      stage.style.flexDirection=direction;stage.dataset.chatSide=side;
      const tk=L.solveTracks(layout);
      frames.style.gridTemplateColumns=tk?tk.columns:layout.columns;
      frames.style.gridTemplateRows=tk?tk.rows:layout.rows;
      frames.style.gridTemplateAreas=layout.areas.join(' ');
      frames.style.setProperty('--mv-ratio',tk?String(tk.ratio):'');
      frames.classList.toggle('is-exact',Boolean(tk));
      frames.innerHTML='';
      for(let i=0;i<n;i++){
        const cell=document.createElement('div');
        cell.className='mv-cell'+(i===0?' is-main':'');
        cell.style.gridArea=L.SLOTS[i];
        const box=document.createElement('div');box.className='mv-cell-inner';
        const f=document.createElement('iframe');box.appendChild(f);
        cell.appendChild(box);frames.appendChild(cell);
      }
      // 강제 리플로우
      frames.offsetHeight;
      const ratios=[...frames.querySelectorAll('.mv-cell-inner')].map(b=>{
        const r=b.getBoundingClientRect();
        return {w:Math.round(r.width),h:Math.round(r.height),
          ratio:r.height>0?+(r.width/r.height).toFixed(3):0};
      });
      // 칸 대비 영상 상자가 덮지 못한 비율(=칸 안 레터박스).
      const cells=[...frames.querySelectorAll('.mv-cell')].map(c=>{
        const cr=c.getBoundingClientRect();
        const ir=c.querySelector('.mv-cell-inner').getBoundingClientRect();
        const area=cr.width*cr.height;
        return area>0?(1-(ir.width*ir.height)/area)*100:0;
      });
      res.push({id:layout.id,n,ratios,cells});
    }
    return res;
  })()`);

  const TARGET = 16 / 9;
  // ⚠ 허용 오차는 칸 높이에 반비례한다. 렌더가 서브픽셀에서 반올림되므로 작은
  //   칸일수록 같은 1px 이 더 큰 비율 오차로 보인다(118px 칸에서 1px ≈ 0.03).
  const tol = (h) => Math.max(0.005, (1.5 / Math.max(h, 1)) * TARGET);
  let bad = 0;
  for (const r of out) {
    const offenders = r.ratios.filter(
      (x) => Math.abs(x.ratio - TARGET) > tol(x.h),
    );
    const mark = offenders.length ? "  ⚠" : "   ";
    console.log(
      `${mark} ${r.id.padEnd(14)} 칸${r.n}  ` +
        r.ratios
          .map(
            (x) =>
              `${Math.round(x.w)}x${Math.round(x.h)}(${x.ratio.toFixed(3)})`,
          )
          .join(" "),
    );
    if (offenders.length) bad++;
  }
  console.log(`\n목표 16:9 = ${TARGET.toFixed(3)}`);
  console.log(
    bad ? `${bad}개 배치에서 비율이 어긋난다` : "모든 배치에서 16:9 유지",
  );
  if (bad) process.exitCode = 1;

  // 레터박스(칸 안 검은 여백) 검사.
  // ⚠ 오른쪽/왼쪽+아래·위 4개는 기하학적으로 해가 없다 — 전체 폭 띠와 16:9 메인을
  //   동시에 만족시키는 열 너비가 존재하지 않는다. 이 4개만 여백을 허용한다.
  const EXPECT_LETTERBOX = new Set([
    "right-bottom",
    "left-bottom",
    "right-top",
    "left-top",
  ]);
  let wasteBad = 0;
  for (const r of out) {
    const worst = Math.max(...r.cells);
    if (worst > 1 && !EXPECT_LETTERBOX.has(r.id)) {
      console.log(
        `  ⚠ ${r.id}: 칸 안 여백 ${worst.toFixed(1)}% (0 이어야 한다)`,
      );
      wasteBad++;
    }
  }
  console.log(
    wasteBad
      ? `${wasteBad}개 배치에 예상치 못한 레터박스`
      : `레터박스 없음 ${out.length - EXPECT_LETTERBOX.size}개 / 불가피 ${EXPECT_LETTERBOX.size}개`,
  );
  if (wasteBad) process.exitCode = 1;
})()
  .catch((e) => {
    console.error("FAIL", e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    browser.kill("SIGTERM");
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });
