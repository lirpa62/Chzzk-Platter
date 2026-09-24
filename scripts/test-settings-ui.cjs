const { spawn } = require('node:child_process');
const { readFileSync, mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const settingsSource = readFileSync('src/settings.js', 'utf8');
for (const key of [
  'cheeseEmbedClipMixerAlwaysOn',
  'cheeseEmbedClipMixerDefaultOn',
  'cheeseEmbedClipMixerDefaultPreset',
  'cheeseEmbedClipMixerDefaultPresetEnabled',
  'cheeseEmbedClipMixerDefaultGain',
  'cheeseEmbedClipMixerDefaultGainEnabled',
  'cheeseEmbedClipMixerGain',
  // 설정 화면에서 켜고 끄는데 전송 목록에는 빠져 있던 키들(내보내기·불러오기 누락).
  'cheeseVodRoleChatOn',
  'cheeseVodRoleChatBots',
  'cheeseFollowSquareChannels',
  // 리캡 페이지에서 고르는 값이라 설정 화면에는 없지만 내보내기에는 들어가야 한다.
  'chatRecapNewVodRecentDays',
  // 멀티뷰 전용 버튼 설정(팝업과 별개 키). 내보내기에서 빠지면 안 된다.
  'cheeseMultiviewBtnMixer',
  'cheeseMultiviewSeekBar',
  'cheeseMultiviewRememberQuickState',
  'cheeseMultiviewSyncDiagnosticsUi',
  'cheeseMaxQualityTarget',
  'audioMixer:shareAcrossChannels',
]) {
  assert.match(settingsSource, new RegExp(`SETTINGS_STORAGE_KEYS[\\s\\S]*?"${key}"`));
}
assert.match(
  settingsSource,
  /SETTINGS_TRANSFER_KEYS\s*=\s*new Set\(SETTINGS_STORAGE_KEYS\)/,
);
const dir = mkdtempSync(join(tmpdir(), 'cheese-settings-ui-'));
const browser = spawn(process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run',
  '--remote-debugging-pipe', `--user-data-dir=${dir}`,
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
let buffer = '', seq = 0, stderr = '';
const pending = new Map();
browser.stderr.on('data', chunk => stderr = (stderr + chunk).slice(-2000));
browser.stdio[4].on('data', chunk => {
  buffer += chunk;
  for (let end; (end = buffer.indexOf('\0')) >= 0;) {
    const raw = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (!raw) continue;
    const msg = JSON.parse(raw), job = pending.get(msg.id);
    if (!job) continue;
    pending.delete(msg.id);
    if (msg.error) job.reject(Error(JSON.stringify(msg.error))); else job.resolve(msg.result);
  }
});
const closed = new Promise(resolve => browser.on('close', () => {
  for (const job of pending.values()) job.reject(Error('browser closed: ' + stderr));
  pending.clear(); resolve();
}));
function call(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    browser.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
}

const { writeFileSync } = require('node:fs');
const deadline = setTimeout(() => browser.kill('SIGTERM'), 45000);
(async () => {
  try {
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
    const command = (method, params) => call(method, params, sessionId);
    const evaluate = async expression => {
      const result = await command('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true});
      if(result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await command('Network.enable');
    await command('Network.setBlockedURLs',{urls:['http://*','https://*']});
    await command('Emulation.setDeviceMetricsOverride',{width:500,height:600,deviceScaleFactor:1,mobile:false});
    await evaluate('document.documentElement.innerHTML = '+JSON.stringify(readFileSync('settings.html','utf8')));
    await evaluate(`document.querySelectorAll('script,link').forEach(el=>el.remove());
      window.errors=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
      const preferences=new Map([['cheeseSettingsLastTab','chat'],['cheeseSettingsRememberTab','1'],['cheeseSettingsRememberExpanded','1'],['cheeseMultiviewChatSize',JSON.stringify({w:430,h:320})]]);
      Object.defineProperty(window,'localStorage',{value:{getItem:k=>preferences.get(k)||null,setItem:(k,v)=>preferences.set(k,String(v)),removeItem:k=>preferences.delete(k)}});
      window.downloadedBlobs=[];
      URL.createObjectURL=blob=>{downloadedBlobs.push(blob);return 'blob:fixture'};
      URL.revokeObjectURL=()=>{};
      HTMLAnchorElement.prototype.click=function(){};
      const previousTabOrder=[...document.querySelectorAll('.settings-tab')].map(el=>el.dataset.tab).filter(tab=>tab!=='all'&&tab!=='multiview');
      previousTabOrder.splice(previousTabOrder.indexOf('customfollow'),1);
      previousTabOrder.splice(2,0,'customfollow');
      window.saved={cheeseSettingsKnownFeatures:['audio-mixer-share-across-channels'],cheeseSettingsTabOrder:previousTabOrder,cheeseFeatureHidden:{audioMixer:true},cheeseWheelVolume:false,
        cheeseMixerAlwaysOn:true,cheeseMixerDefaultOn:true,cheeseVideoFilterAlwaysOn:false,cheeseVideoFilterDefaultOn:true,
        cheeseEmbedClipMixerAlwaysOn:true,cheeseEmbedClipMixerDefaultOn:true,
        cheeseEmbedClipMixerDefaultPresetEnabled:false,cheeseEmbedClipMixerDefaultGainEnabled:true,
        'audioMixer:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa':{userDisabled:true}};
      window.writes=[];
      window.chrome={runtime:{getURL:p=>'https://fixture.invalid/'+p,getManifest:()=>({version:'1.0.0'}),sendMessage:(m,cb)=>{cb?.({ok:true});return Promise.resolve({ok:true});}},
        storage:{local:{get:async()=>structuredClone(saved),set:obj=>{writes.push(structuredClone(obj));Object.assign(saved,obj);return Promise.resolve();},remove:async()=>{},getKeys:async()=>Object.keys(saved)},onChanged:{addListener:()=>{}}},
        tabs:{query:(q,cb)=>{cb?.([]);return Promise.resolve([]);},create:()=>{}}};
    `);
    for(const file of ['src/popup.css','src/settings.css']){
      await evaluate(`{const style=document.createElement('style');style.textContent=${JSON.stringify(readFileSync(file,'utf8'))};document.head.append(style);}`);
    }
    await evaluate(readFileSync('src/settingsUi.js','utf8'));
    await evaluate(readFileSync('src/settings.js','utf8'));
    await evaluate('new Promise(resolve=>setTimeout(resolve,100))');
    assert.deepEqual(await evaluate('errors'),[]);
    assert.equal(await evaluate('document.querySelector(".settings-tab.is-active").dataset.tab'),'chat');
    await evaluate(`window.check = (value, message) => {if(!value)throw Error(message)};
      window.row = selector => document.querySelector(selector).closest('.settings-item');
      window.search = value => {const input=document.querySelector('[data-settings-search]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));};
      window.shown = el => getComputedStyle(el).display!=='none';
      window.featureWrites = writes.filter(obj=>'cheeseFeatureHidden' in obj).length;
    `);
    const checks=[];
    async function test(name, expression){await evaluate(`{${expression}}`);checks.push(name);}
    await test('new tab follows custom following without changing saved order',`
      const tabs=[...document.querySelectorAll('.settings-tabs .settings-tab')].map(el=>el.dataset.tab);
      check(tabs[tabs.indexOf('customfollow')+1]==='multiview','new tab was appended instead of placed after custom following');
      check(JSON.stringify(tabs.filter(tab=>tab!=='all'&&tab!=='multiview'))===JSON.stringify(saved.cheeseSettingsTabOrder),'existing custom tab order changed');
      const editor=[...document.querySelectorAll('#settingsTabOrderList [data-id]')].map(el=>el.dataset.id);
      check(JSON.stringify(editor)===JSON.stringify(tabs.filter(tab=>tab!=='all')),'tab order editor disagrees with navigation');
      document.querySelector('[data-settings-tab-order-reset]').click();
      const reset=[...document.querySelectorAll('.settings-tabs .settings-tab')].map(el=>el.dataset.tab);
      check(reset[reset.indexOf('customfollow')+1]==='multiview','reset did not restore default multiview position');
    `);
    await test('new badges survive a previously consumed update flag',`
      const tab=document.querySelector('[data-tab="multiview"]');
      const title=document.querySelector('[data-new-feature="multiview-player-controls"]');
      const quality=document.querySelector('[data-new-feature="max-quality-target"]');
      check(tab.classList.contains('has-new-feature')&&tab.querySelector('.settings-tab-new-badge'),'multiview tab NEW badge missing');
      check(title.classList.contains('is-new-feature'),'multiview group NEW badge missing');
      check(quality.classList.contains('is-new-feature'),'new quality target badge missing');
      tab.click();
      check(tab.classList.contains('has-new-feature'),'NEW badge cleared before settings were viewed');
      document.querySelector('[data-tab="player"]').click();
      check(!tab.classList.contains('has-new-feature'),'multiview NEW badge remained after viewing tab');
    `);
    await test('disclosures preserve feature state, support multiple open groups, and persist',`
      const wheel=document.querySelector('[data-settings-disclosure="wheel-volume"]');
      const overlay=document.querySelector('[data-settings-disclosure="action-overlay"]');
      const before=writes.length;
      check(wheel.getAttribute('aria-expanded')==='false','default must be collapsed');
      check(row('[data-wheel-volume-rightclick]').classList.contains('is-feature-collapsed'),'children not collapsed');
      wheel.click();overlay.click();
      check(wheel.getAttribute('aria-expanded')==='true'&&overlay.getAttribute('aria-expanded')==='true','multiple groups cannot stay open');
      check(wheel.getAttribute('aria-controls').split(' ').every(id=>document.getElementById(id)),'invalid aria-controls');
      check(!document.querySelector('[data-wheel-volume]').checked,'disclosure toggled parent');
      check(document.querySelector('[data-wheel-volume-rightclick]').disabled,'disabled children unlocked');
      check(writes.length===before,'disclosure wrote feature storage');
      const prefs=JSON.parse(localStorage.getItem('cheeseSettingsExpandedFeatures'));
      check(prefs.includes('wheel-volume')&&prefs.includes('action-overlay'),'expanded state not saved');
      const copy=document.implementation.createHTMLDocument('fixture');copy.body.innerHTML=document.body.innerHTML;
      copy.querySelectorAll('.settings-disclosure-button').forEach(el=>el.remove());
      CheeseSettingsUi.createDisclosures(copy,localStorage);
      check(copy.querySelector('[data-settings-disclosure="wheel-volume"]').getAttribute('aria-expanded')==='true','reopen did not restore');
      wheel.click();overlay.click();
    `);
    await test('search temporarily opens matched descendants without changing remembered folds',`
      const wheel=document.querySelector('[data-settings-disclosure="wheel-volume"]');
      const before=localStorage.getItem('cheeseSettingsExpandedFeatures');
      search('우클릭 중에만');
      check(wheel.getAttribute('aria-expanded')==='true','search did not expand');
      check(!row('[data-wheel-volume-rightclick]').classList.contains('is-feature-collapsed'),'search result still collapsed');
      check(wheel.disabled,'search disclosure must not persist a temporary state');
      search('');
      check(wheel.getAttribute('aria-expanded')==='false'&&!wheel.disabled,'search did not restore');
      check(localStorage.getItem('cheeseSettingsExpandedFeatures')===before,'search persisted expansion');
    `);
    await test('collapsed NEW children remain unread until expanded',`
      const button=document.querySelector('[data-settings-disclosure="wheel-volume"]');
      check(button.classList.contains('has-new-setting'),'collapsed new indicator missing');
      document.querySelector('[data-tab="player"]').click();document.querySelector('[data-tab="mixer"]').click();
      check(!saved.cheeseSettingsKnownFeatures.includes('wheel-volume-scope'),'unseen collapsed setting marked read');
      document.querySelector('[data-tab="player"]').click();button.click();document.querySelector('[data-tab="mixer"]').click();
      check(saved.cheeseSettingsKnownFeatures.includes('wheel-volume-scope'),'expanded setting not marked read');
      button.click();
    `);
    await test('tab persistence and explicit destination precedence',`
      document.querySelector('[data-tab="player"]').click();
      check(localStorage.getItem('cheeseSettingsLastTab')==='player','tab not saved');
      check(CheeseSettingsUi.readLastTab(localStorage,['all','player','chat'],'chat')==='chat','URL priority');
      check(CheeseSettingsUi.readLastTab(localStorage,['all','player'],'invalid')==='player','invalid URL fallback');
      check(CheeseSettingsUi.readLastTab({getItem:()=>{throw Error()}},['all','player'],null)==='all','storage failure');
      CheeseSettingsUi.rememberTab({setItem:()=>{throw Error()}},'chat');
    `);
    await test('search shows explicit parent and keeps disabled child values',`
      const before=document.querySelector('[data-wheel-volume-rightclick]').checked;
      search('우클릭 중에만');
      check(shown(row('[data-wheel-volume]')),'missing parent');
      check(row('[data-wheel-volume]').classList.contains('is-search-context'),'parent context');
      check(row('[data-wheel-volume-rightclick]').querySelector('.settings-search-path').textContent.includes('휠로 볼륨 조절'),'missing path');
      check(document.querySelector('[data-wheel-volume-rightclick]').disabled,'disabled child became enabled');
      search('');
      check(document.querySelector('[data-wheel-volume-rightclick]').checked===before,'value changed');
      check(document.querySelector('.settings-tab.is-active').dataset.tab==='player','tab lost after search');
    `);
    await test('old names searchable and unrelated rows actually hidden',`
      search('휠이 먹히는 곳');
      check(shown(row('[data-wheel-volume-scope]')),'alias missing');
      check(!shown(row('[data-volume-pct]')),'unrelated row remains visible');
    `);
    await test('nested parents, duplicate labels, and conditional visibility',`
      search('처음 보는 영상도');
      check(shown(row('[data-vod-chat-graph]'))&&shown(row('[data-vod-chat-graph-auto]')),'nested parents missing');
      search('지연 닫기 시간');
      check(row('[data-comment-ts-click-delay]').querySelector('.settings-search-path').textContent.includes('타임스탬프'),'comment delay wrong parent');
      check(row('[data-chat-recap-click-delay]').querySelector('.settings-search-path').textContent.includes('내 채팅 기록'),'recap delay wrong parent');
      const hidden=row('[data-update-notice-duration]');hidden.hidden=true;search('볼륨');search('');check(hidden.hidden,'availability hidden overwritten');
    `);
    await test('all branch-labelled options have a parent path',`
      search('└');
      const orphan=[...document.querySelectorAll('.settings-item-name')].filter(el=>{
        const copy=el.cloneNode(true);copy.querySelectorAll('button,.settings-search-path').forEach(n=>n.remove());
        if(!copy.textContent.includes('└'))return false;
        return !el.querySelector('.settings-search-path')?.dataset.settingsParent;
      });
      check(orphan.length===0,'orphan labels: '+orphan.map(el=>el.textContent).join(','));
    `);
    await test('search preserves existing buttons, markup, listeners, and dynamic descriptions',`
      search('');
      window.infoButton=document.querySelector('[data-settings-info="chat-word-filter"]');
      window.infoSvg=infoButton.querySelector('svg');
      let clicked=0;infoButton.addEventListener('click',()=>clicked++);
      for(let i=0;i<5;i++){search('클립');search('');}
      check(document.querySelector('[data-settings-info="chat-word-filter"]')===infoButton && infoButton.querySelector('svg')===infoSvg,'button or SVG replaced');
      window.childInfo=document.querySelector('[data-settings-info="clip-click"]');
      check(childInfo,'child info button missing');
      for(let i=0;i<3;i++){search('클립');search('');}
      check(document.querySelector('[data-settings-info="clip-click"]')===childInfo,'child button replaced');
      check(document.querySelector('.settings-item-desc code'),'code markup erased');
      infoButton.click();check(clicked===1&&infoButton.getAttribute('aria-expanded')==='true','listener lost');
      const dynamic=document.querySelector('[data-screenshot-direct-save-desc]');
      dynamic.textContent='업데이트된 저장 설명';search('업데이트된');search('');check(dynamic.textContent==='업데이트된 저장 설명','dynamic text reverted');
    `);
    await test('hidden help participates in search and restores disclosure state',`
      const help=row('[data-vod-chat-graph]').querySelector('.settings-info-panel');
      check(help.hidden,'help initially open');search('반복 문장');check(!help.hidden,'help match not revealed');
      search('');check(help.hidden,'search did not restore help');
      const btn=row('[data-vod-chat-graph]').querySelector('[data-settings-info]');
      btn.click();check(!help.hidden&&btn.getAttribute('aria-expanded')==='true','help click failed');
      search('다른 검색');search('');check(!help.hidden,'user-opened help collapsed');
    `);
    await test('search and tab browsing never write feature values',`
      check(writes.filter(obj=>'cheeseFeatureHidden' in obj).length===featureWrites,'feature storage modified');
      check(document.querySelector('[data-feature="audioMixer"]').checked===false,'stored hidden must render as display off');
      search('없는설정xyz');check(!document.querySelector('[data-settings-search-empty]').hidden,'empty state missing');
      search('');check(document.querySelector('[data-settings-search-empty]').hidden,'empty state not reset');
    `);
    await test('positive display toggles round-trip legacy flags and leave unrelated flags intact',`
      const input=document.querySelector('[data-feature="audioMixer"]');
      check(!input.checked,'legacy true must be display off');
      input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));
      check(saved.cheeseFeatureHidden.audioMixer===false,'display on must save hidden false');
      const afterOn={...saved.cheeseFeatureHidden};
      check(afterOn.liveSync===true&&afterOn.liveRewind===true,'default hidden values changed');
      check(afterOn.videoFilter===false,'default visible filter changed');
      input.checked=false;input.dispatchEvent(new Event('change',{bubbles:true}));
      check(saved.cheeseFeatureHidden.audioMixer===true,'display off must save hidden true');
      for(const key of Object.keys(afterOn))if(key!=='audioMixer')check(saved.cheeseFeatureHidden[key]===afterOn[key],'unrelated flag changed: '+key);
      for(const el of document.querySelectorAll('[data-feature-inverted]'))for(const value of [true,false]){
        const old=el.checked;el.checked=CheeseSettingsUi.checkedFromStored(el,value);
        check(CheeseSettingsUi.storedFromChecked(el)===value,'roundtrip failed: '+el.dataset.feature);el.checked=old;
      }
      search('오디오 믹서 숨김');check(shown(row('[data-feature="audioMixer"]')),'old toggle label not searchable');search('');
    `);
    await test('auto-enable modes preserve legacy keys and embed defaults stay independent',`
      const mixer=document.querySelector('[data-mixer-auto-enable]');
      const filter=document.querySelector('[data-video-filter-auto-enable]');
      const embed=document.querySelector('[data-embed-clip-mixer-auto-enable]');
      const selected=group=>group.querySelector('[aria-checked="true"]')?.dataset.autoEnableValue;
      check(selected(mixer)==='always','legacy mixer precedence must prefer always');
      check(selected(filter)==='default','legacy filter default mode not restored');
      check(embed.checked,'legacy embed auto-enable value not restored');
      check(!document.querySelector('[data-mixer-exclude-item]').hidden,'mixer exclusions hidden in always mode');
      check(document.querySelector('[data-video-filter-exclude-item]').hidden,'filter exclusions visible outside always mode');
      mixer.querySelector('[data-auto-enable-value="default"]').click();
      check(saved.cheeseMixerAlwaysOn===false&&saved.cheeseMixerDefaultOn===true,'mixer default mode keys invalid');
      check(document.querySelector('[data-mixer-exclude-item]').hidden,'mixer exclusions remained visible in default mode');
      mixer.querySelector('[data-auto-enable-value="off"]').click();
      check(saved.cheeseMixerAlwaysOn===false&&saved.cheeseMixerDefaultOn===false,'mixer off mode keys invalid');
      filter.querySelector('[data-auto-enable-value="always"]').click();
      check(saved.cheeseVideoFilterAlwaysOn===true&&saved.cheeseVideoFilterDefaultOn===false,'filter always mode keys invalid');
      check(selected(filter)==='always','filter selected state not reflected');
      check(document.querySelector('[data-video-filter-exclude-item]').hidden,'empty filter exclusions visible in always mode');
      check(!shown(document.querySelector('[data-settings-disclosure="filter-exclusions"]')),'empty filter disclosure button visible');
      embed.checked=false;embed.dispatchEvent(new Event('change',{bubbles:true}));
      check(saved.cheeseEmbedClipMixerAlwaysOn===false&&saved.cheeseEmbedClipMixerDefaultOn===false,'embed mixer off mode keys invalid');
      embed.checked=true;embed.dispatchEvent(new Event('change',{bubbles:true}));
      check(saved.cheeseEmbedClipMixerAlwaysOn===true&&saved.cheeseEmbedClipMixerDefaultOn===false,'embed mixer on mode keys invalid');
      const presetEnabled=document.querySelector('[data-embed-clip-default-preset-enabled]');
      const gainEnabled=document.querySelector('[data-embed-clip-default-gain-enabled]');
      const embedPresetRow=row('[data-settings-embed-mixer-preset]');
      const embedGainRow=row('[data-embed-clip-default-gain-range]');
      check(!presetEnabled.checked&&embedPresetRow.classList.contains('is-locked'),'disabled embed default preset remained editable');
      check(gainEnabled.checked&&!embedGainRow.classList.contains('is-locked'),'enabled embed default gain was locked');
      presetEnabled.checked=true;presetEnabled.dispatchEvent(new Event('change',{bubbles:true}));
      check(saved.cheeseEmbedClipMixerDefaultPresetEnabled===true&&!embedPresetRow.classList.contains('is-locked'),'embed preset enable did not unlock its value');
      gainEnabled.checked=false;gainEnabled.dispatchEvent(new Event('change',{bubbles:true}));
      check(saved.cheeseEmbedClipMixerDefaultGainEnabled===false&&embedGainRow.classList.contains('is-locked'),'embed gain disable did not lock its value');
      search('비디오 필터 기본 켜짐');
      check(shown(row('[data-video-filter-auto-enable]')),'legacy auto-enable name not searchable');
      search('');
    `);
    await test('maximum quality target defaults, persists, and follows parent availability',`
      search('');document.querySelector('[data-tab="player"]').click();
      const parent=document.querySelector('[data-max-quality]');
      const trigger=document.querySelector('[data-max-quality-target]');
      const label=document.querySelector('[data-max-quality-target-label]');
      const respect=document.querySelector('[data-max-quality-respect]');
      check(label.textContent==='최고 화질','missing target did not default to highest');
      check(trigger.disabled&&respect.disabled,'children enabled while parent off');
      parent.checked=true;parent.dispatchEvent(new Event('change',{bubbles:true}));
      check(!trigger.disabled&&!respect.disabled,'children stayed locked');
      row('[data-max-quality-target]').scrollIntoView({block:'center'});
      trigger.click();
      check(trigger.getAttribute('aria-expanded')==='true','target popover did not open');
      const listRect=document.querySelector('[data-max-quality-target-list]').getBoundingClientRect();
      check(listRect.top>=0&&listRect.bottom<=innerHeight,'target popover clipped by viewport');
      document.querySelector('[data-max-quality-target-list] [data-value="720"]').click();
      check(saved.cheeseMaxQualityTarget==='720'&&label.textContent==='720p','target was not saved');
      parent.checked=false;parent.dispatchEvent(new Event('change',{bubbles:true}));
      check(trigger.disabled&&respect.disabled&&saved.cheeseMaxQualityTarget==='720','parent off erased target or left child enabled');
      search('최대 화질');
      check(row('[data-max-quality-target]').querySelector('.settings-search-path').dataset.settingsParent.includes('최대 화질 자동 고정'),'target search path missing parent');
      search('');
    `);
    await test('preset popover still opens after repeated searches',`
      document.querySelector('[data-tab="mixer"]').click();
      const enabled=document.querySelector('[data-mixer-global-default-enabled]');
      if(!enabled.checked){enabled.checked=true;enabled.dispatchEvent(new Event('change',{bubbles:true}));}
      document.querySelector('[data-global-default-picker="audio"] [data-global-default-trigger]').click();
      check(document.querySelector('[data-global-default-picker="audio"] [data-global-default-trigger]').getAttribute('aria-expanded')==='true','preset did not open');
    `);
    await evaluate(`search('');document.querySelector('[data-tab="player"]').click();
      window.disclosureBefore=document.querySelector('[data-settings-disclosure="wheel-volume"]').getAttribute('aria-expanded');
      document.querySelector('[data-settings-disclosure="wheel-volume"]').focus();`);
    await command('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});
    await command('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
    await test('native keyboard activation opens disclosure without toggling the feature',`
      check(document.querySelector('[data-settings-disclosure="wheel-volume"]').getAttribute('aria-expanded')!==disclosureBefore,'Space did not activate');
      check(!document.querySelector('[data-wheel-volume]').checked,'Space toggled parent feature');
    `);
    await evaluate('search("우클릭 중에만")');
    for(const [width,height,tabView] of [[420,600,false],[788,600,false],[1280,900,true],[390,844,true]]){
      await command('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await evaluate(`document.documentElement.classList.toggle('settings-tab-view',${tabView});document.documentElement.style.setProperty('--settings-popup-w','${width}px')`);
      if(tabView && width<=640){
        await evaluate(`{
          const tabs=document.querySelector('.settings-tabs').getBoundingClientRect();
          const panels=document.querySelector('.settings-panels').getBoundingClientRect();
          check(panels.top>=tabs.bottom,'narrow tabs must sit above panels');
          check(panels.width>=document.documentElement.clientWidth-34,'narrow panel must use available width excluding scrollbar and padding');
          check(tabs.height<70,'horizontal tabs must not consume panel height');
        }`);
      }
      const overflow=await evaluate(`[...document.querySelectorAll('.settings-item:not(.is-search-hidden) .settings-item-name,.settings-search-path:not([hidden])')].filter(el=>el.getClientRects().length).filter(el=>el.scrollWidth>el.clientWidth+2 && getComputedStyle(el).display!=='inline').map(el=>el.textContent)`);
      assert.deepEqual(overflow,[]);
      const shot=await command('Page.captureScreenshot',{format:'png'});
      writeFileSync(join(tmpdir(),`cheese-settings-ui-${width}.png`),Buffer.from(shot.data,'base64'));
    }
    await command('Emulation.setDeviceMetricsOverride',{width:500,height:600,deviceScaleFactor:1,mobile:false});
    await evaluate(`document.documentElement.classList.remove('settings-tab-view');document.documentElement.style.setProperty('--settings-popup-w','500px');search('');document.querySelector('[data-tab="player"]').click();`);
    for(const open of [false,true]){
      await evaluate(`{
        const button=document.querySelector('[data-settings-disclosure="wheel-volume"]');
        if((button.getAttribute('aria-expanded')==='true')!==${open})button.click();
        row('[data-wheel-volume]').scrollIntoView({block:'start'});
      }`);
      const shot=await command('Page.captureScreenshot',{format:'png'});
      writeFileSync(join(tmpdir(),`cheese-settings-disclosure-${open?'open':'closed'}.png`),Buffer.from(shot.data,'base64'));
    }
    await test('multiview chat size is included in settings and full backup and imports safely',`
      const exportPayload=async selector=>{
        const before=downloadedBlobs.length;
        document.querySelector(selector).click();
        for(let i=0;i<30&&downloadedBlobs.length===before;i++)await new Promise(resolve=>setTimeout(resolve,10));
        check(downloadedBlobs.length===before+1,'export did not produce a file: '+selector);
        return JSON.parse(await downloadedBlobs[before].text());
      };
      const regular=await exportPayload('[data-settings-export]');
      const full=await exportPayload('[data-settings-export-full]');
      check(JSON.stringify(regular.appearance.multiviewChatSize)==='{"w":430,"h":320}','settings export omitted multiview chat size');
      check(JSON.stringify(full.appearance.multiviewChatSize)==='{"w":430,"h":320}','full backup omitted multiview chat size');
      const payload={format:'chzzk-platter-settings',schemaVersion:1,settings:{cheeseMasterEnabled:true},appearance:{multiviewChatSize:{w:720,h:180}}};
      const input=document.querySelector('[data-settings-import-file]');
      Object.defineProperty(input,'files',{configurable:true,value:[new File([JSON.stringify(payload)],'settings.json',{type:'application/json'})]});
      input.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,50));
      const imported=JSON.parse(localStorage.getItem('cheeseMultiviewChatSize'));
      check(imported.w===720&&imported.h===320,'invalid dimension was not ignored while retaining existing size');
      const bounded={...payload,appearance:{multiviewChatSize:{w:9000,h:300}}};
      Object.defineProperty(input,'files',{configurable:true,value:[new File([JSON.stringify(bounded)],'settings.json',{type:'application/json'})]});
      input.dispatchEvent(new Event('change',{bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,50));
      const capped=JSON.parse(localStorage.getItem('cheeseMultiviewChatSize'));
      check(capped.w===4000&&capped.h===300,'imported dimensions were not capped');
    `);
    assert.deepEqual(await evaluate('errors'),[]);
    console.log(JSON.stringify({passed:checks.length,checks,screenshots:'temporary directory: cheese-settings-ui-{420,788,1280,390}.png'},null,2));
  } finally {
    clearTimeout(deadline);browser.kill('SIGTERM');await closed;rmSync(dir,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
