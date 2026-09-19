// 캔버스가 만든 PNG 가 실제로 PNG 인지 실브라우저에서 확인한다.
//
// "저장하지 못했어요(이미지 형식 문제)" 를 쫓을 때 인코더부터 의심하지 않기 위한
// 근거다. Blob 과 데이터 URL 양쪽에서 PNG 서명(89 50 4E 47 0D 0A 1A 0A)을 읽고,
// 실제로 이미지로 열리는지까지 본다. 여기가 통과하면 이미지 자체는 정상이므로
// 이후 실패는 저장 전송(transport) 문제로 갈라서 봐야 한다.
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const dir = mkdtempSync(join(tmpdir(), "cheese-png-"));
const b = spawn(
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
let buf = "",
  seq = 0;
const pend = new Map();
b.stdio[4].on("data", (c) => {
  buf += c;
  for (let e; (e = buf.indexOf("\0")) >= 0;) {
    const raw = buf.slice(0, e);
    buf = buf.slice(e + 1);
    if (!raw) continue;
    const m = JSON.parse(raw),
      j = pend.get(m.id);
    if (!j) continue;
    pend.delete(m.id);
    m.error ? j.reject(Error(JSON.stringify(m.error))) : j.resolve(m.result);
  }
});
const call = (m, p = {}, s) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pend.set(id, { resolve: res, reject: rej });
    b.stdio[3].write(
      JSON.stringify({ id, method: m, params: p, sessionId: s }) + "\0",
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
  const ev = async (e) => {
    const r = await call(
      "Runtime.evaluate",
      { expression: e, returnByValue: true, awaitPromise: true },
      sessionId,
    );
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const out = await ev(`(async()=>{
    // takeScreenshot 과 같은 방식: video 대신 색을 칠한 캔버스.
    const c=document.createElement('canvas'); c.width=320; c.height=180;
    const ctx=c.getContext('2d'); ctx.fillStyle='#0a0'; ctx.fillRect(0,0,320,180);
    const blob=await new Promise(r=>c.toBlob(r,'image/png'));
    const head=new Uint8Array(await blob.slice(0,8).arrayBuffer());
    const sig=Array.from(head).map(x=>x.toString(16).padStart(2,'0')).join(' ');
    // 데이터 URL 로 바꿨을 때도 같은 바이트인지 확인한다(대화상자 경로).
    const dataURL=await new Promise(r=>{const fr=new FileReader();
      fr.onload=()=>r(String(fr.result)); fr.readAsDataURL(blob);});
    const b64=dataURL.split(',')[1];
    const bin=atob(b64);
    const dsig=Array.from(bin.slice(0,8)).map(ch=>
      ch.charCodeAt(0).toString(16).padStart(2,'0')).join(' ');
    // 실제로 이미지로 열리는지까지 확인한다.
    const okImg=await new Promise(r=>{const im=new Image();
      im.onload=()=>r(im.naturalWidth+'x'+im.naturalHeight);
      im.onerror=()=>r('열기 실패'); im.src=dataURL;});
    return {type:blob.type,size:blob.size,sig,dsig,prefix:dataURL.slice(0,22),okImg};
  })()`);
  const EXPECT = "89 50 4e 47 0d 0a 1a 0a";
  console.log("Blob type    :", out.type);
  console.log("Blob size    :", out.size, "bytes");
  console.log(
    "PNG 서명     :",
    out.sig,
    out.sig === EXPECT ? "✔ 정상" : "✘ 불일치",
  );
  console.log(
    "데이터URL 서명:",
    out.dsig,
    out.dsig === EXPECT ? "✔ 정상" : "✘ 불일치",
  );
  console.log("데이터URL 앞부분:", out.prefix);
  console.log("이미지로 열기 :", out.okImg);
  let failed = 0;
  const ok = (c, l) => {
    console.log((c ? "  PASS " : "  FAIL ") + l);
    if (!c) failed += 1;
  };
  console.log("");
  ok(out.type === "image/png", "Blob 형식이 image/png 다");
  ok(out.size > 0, "Blob 이 비어 있지 않다");
  ok(out.sig === EXPECT, "Blob 이 PNG 서명으로 시작한다");
  ok(out.dsig === EXPECT, "데이터 URL 도 같은 PNG 바이트를 담는다");
  ok(out.prefix === "data:image/png;base64,", "데이터 URL 접두사가 PNG 다");
  ok(out.okImg === "320x180", `이미지로 열린다 (${out.okImg})`);
  console.log(failed ? `\n실패 ${failed}건` : "\n전부 통과");
  process.exitCode = failed ? 1 : 0;
})()
  .catch((e) => console.error("FAIL", e.message))
  .finally(() => {
    b.kill("SIGTERM");
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });
