const SKPORT_CAPTURE_SOURCE = String.raw`(function(){
  "use strict";
  var stateKey="__endfieldDijiangRosterCapture";
  var targetPaths=["/game/endfield/team/user-game-data","/game/endfield/card/detail"];
  if(!/(^|\.)skport\.com$/i.test(location.hostname)){
    alert("Open the official SKPort website before running the Endfield roster capture bookmarklet.");
    return;
  }
  if(window[stateKey]&&typeof window[stateKey].focus==="function"){
    window[stateKey].focus();
    return;
  }
  var originalFetch=window.fetch;
  var xhrPrototype=XMLHttpRequest.prototype;
  var originalOpen=xhrPrototype.open;
  var originalSend=xhrPrototype.send;
  var requestUrlKey="__endfieldDijiangRosterRequestUrl";
  var finished=false;
  var capturing=false;
  var directRequest=null;
  var retryTimer=null;
  var captureText=null;
  var captureFileName=null;
  var panel=document.createElement("div");
  panel.id="endfield-dijiang-roster-capture";
  panel.setAttribute("style","position:fixed;z-index:2147483647;right:20px;bottom:20px;width:min(380px,calc(100vw - 40px));padding:18px;border:1px solid #d89b37;border-radius:14px;background:#171a20;color:#f8f4ea;box-shadow:0 18px 50px rgba(0,0,0,.45);font:14px/1.45 system-ui,sans-serif;text-align:left");
  panel.innerHTML="<div style='font-weight:750;font-size:16px;margin-bottom:7px'>Endfield roster capture is ready</div><div data-capture-status>In Team Picks, enable or re-enable the official Sync Data option. The helper will capture every owned operator automatically.</div><div style='margin-top:9px;color:#d5c8b3;font-size:12px'>Only roster, inventory, and equipped-loadout data will be copied. Request credentials and account identifiers are excluded.</div><div style='display:flex;flex-wrap:wrap;gap:8px;margin-top:12px'><button type='button' data-capture-copy hidden style='padding:7px 11px;border:1px solid #79bd8f;border-radius:8px;background:#28633d;color:#fff;cursor:pointer'>Copy import data</button><button type='button' data-capture-download hidden style='padding:7px 11px;border:1px solid #d89b37;border-radius:8px;background:#60451d;color:#fff;cursor:pointer'>Download JSON instead</button><button type='button' data-capture-close style='padding:7px 11px;border:1px solid #777;border-radius:8px;background:#2a2e36;color:#fff;cursor:pointer'>Cancel</button></div>";
  document.documentElement.appendChild(panel);
  var statusNode=panel.querySelector("[data-capture-status]");
  var copyButton=panel.querySelector("[data-capture-copy]");
  var downloadButton=panel.querySelector("[data-capture-download]");
  var closeButton=panel.querySelector("[data-capture-close]");
  function focusPanel(){panel.scrollIntoView({block:"nearest"});panel.animate([{opacity:.55},{opacity:1}],{duration:240});}
  function setStatus(message,color){statusNode.textContent=message;if(color){statusNode.style.color=color;}}
  function isTarget(value){
    try{var pathname=new URL(String(value),location.href).pathname;return targetPaths.some(function(targetPath){return pathname.indexOf(targetPath)!==-1;});}
    catch(error){return targetPaths.some(function(targetPath){return String(value).indexOf(targetPath)!==-1;});}
  }
  function restore(){
    if(window.fetch===wrappedFetch){window.fetch=originalFetch;}
    if(xhrPrototype.open===wrappedOpen){xhrPrototype.open=originalOpen;}
    if(xhrPrototype.send===wrappedSend){xhrPrototype.send=originalSend;}
    document.removeEventListener("click",scheduleDirectCapture,true);
    if(retryTimer){clearTimeout(retryTimer);retryTimer=null;}
  }
  function close(){restore();panel.remove();try{delete window[stateKey];}catch(error){window[stateKey]=null;}}
  function hasRoster(payload){
    if(!payload||typeof payload!=="object"){return null;}
    var detail=payload.detail||payload;
    if(detail&&Array.isArray(detail.chars)){return true;}
    var userGameData=payload.userGameData;
    if(userGameData&&userGameData.userChars&&typeof userGameData.userChars==="object"){return true;}
    if(payload.data&&payload.data!==payload&&hasRoster(payload.data)){return true;}
    if(payload.response&&payload.response!==payload&&hasRoster(payload.response)){return true;}
    return false;
  }
  function getUserGameData(payload){
    if(!payload||typeof payload!=="object"){return null;}
    if(payload.userGameData&&payload.userGameData.userChars&&typeof payload.userGameData.userChars==="object"){return payload.userGameData;}
    return getUserGameData(payload.data)||getUserGameData(payload.response);
  }
  function getUserChar(payload){
    if(!payload||typeof payload!=="object"){return null;}
    if(payload.userChar&&payload.userChar.charId){return payload.userChar;}
    return getUserChar(payload.data)||getUserChar(payload.response);
  }
  function getCatalogCharacters(payload){
    if(!payload||typeof payload!=="object"){return [];}
    if(Array.isArray(payload.chars)){return payload.chars;}
    return getCatalogCharacters(payload.data)||getCatalogCharacters(payload.characterCatalog);
  }
  function getCatalogItems(payload,key){
    if(!payload||typeof payload!=="object"){return [];}
    if(Array.isArray(payload[key])){return payload[key];}
    return getCatalogItems(payload.data,key);
  }
  function compactCatalog(payload,key){
    if(!payload){return null;}
    var items=getCatalogItems(payload,key).map(function(item){return {id:item.id,name:item.name};}).filter(function(item){return item.id&&item.name;});
    var data={};data[key]=items;return {data:data};
  }
  function compactOperatorDetail(payload){
    var character=getUserChar(payload);
    if(!character){return null;}
    function namedData(value){return value&&typeof value==="object"?{id:value.id,name:value.name,level:value.level,rarity:value.rarity,suit:value.suit?{name:value.suit.name}:undefined}:undefined;}
    function gear(value){return value?{equipId:value.equipId,ownedCount:value.ownedCount,equipData:namedData(value.equipData)}:undefined;}
    function tactical(value){return value?{tacticalItemId:value.tacticalItemId,ownedCount:value.ownedCount,tacticalItemData:namedData(value.tacticalItemData)}:undefined;}
    return {data:{userChar:{charId:character.charId,owned:character.owned,level:character.level,evolvePhase:character.evolvePhase,potentialLevel:character.potentialLevel,userSkills:character.userSkills,weapon:character.weapon?{weaponId:character.weapon.weaponId,owned:character.weapon.owned,level:character.weapon.level,refineLevel:character.weapon.refineLevel,breakthroughLevel:character.weapon.breakthroughLevel,weaponData:namedData(character.weapon.weaponData)}:undefined,bodyEquip:gear(character.bodyEquip),armEquip:gear(character.armEquip),firstAccessory:gear(character.firstAccessory),secondAccessory:gear(character.secondAccessory),tacticalItem:tactical(character.tacticalItem),charData:namedData(character.charData),gender:character.gender}}};
  }
  function sanitize(value){
    return JSON.parse(JSON.stringify(value,function(key,current){return key==="roleId"||key==="serverId"||key==="userId"?undefined:current;}));
  }
  function capture(payload,referenceCatalogs,operatorDetails,detailSummary){
    if(finished){return;}
    if(!hasRoster(payload)){setStatus("The roster request completed, but its response did not contain operator data. Try re-enabling Sync Data.","#ffba7a");return;}
    finished=true;
    restore();
    var capturedAt=new Date().toISOString();
    var gameData=getUserGameData(payload);
    var output={captureFormat:"endfield-dijiang-skport-roster-v3",capturedAt:capturedAt,source:location.origin,response:gameData?{data:{userGameData:sanitize(gameData)}}:sanitize(payload),operatorDetails:(operatorDetails||[]).map(compactOperatorDetail).filter(Boolean),operatorDetailSummary:detailSummary||{requested:0,captured:0}};
    if(referenceCatalogs){
      output.characterCatalog=compactCatalog(referenceCatalogs.characters,"chars");
      output.weaponCatalog=compactCatalog(referenceCatalogs.weapons,"weapons");
      output.equipmentCatalog=compactCatalog(referenceCatalogs.equipment,"equips");
      output.tacticalItemCatalog=compactCatalog(referenceCatalogs.tacticalItems,"tacticalItems");
    }
    captureText=JSON.stringify(output);
    captureFileName="endfield-skport-roster-"+capturedAt.slice(0,19).replace(/[:T]/g,"-")+".json";
    copyButton.hidden=false;
    downloadButton.hidden=false;
    setStatus(output.operatorDetailSummary.requested>0?"Captured "+output.operatorDetailSummary.captured+" / "+output.operatorDetailSummary.requested+" operator loadouts. Copy the import data, then paste it into the optimizer.":"Roster captured. Copy the import data, then paste it into the optimizer.",output.operatorDetailSummary.captured===output.operatorDetailSummary.requested?"#8ee7a2":"#ffdf82");
    closeButton.textContent="Close";
  }
  async function copyCapture(){
    if(!captureText){return;}
    try{
      await navigator.clipboard.writeText(captureText);
      setStatus("Import data copied. Return to the optimizer, paste it into the SKPort import box, and preview it.","#8ee7a2");
    }catch(error){setStatus("Clipboard access was blocked. Use Download JSON instead.","#ffba7a");}
  }
  function downloadCapture(){
    if(!captureText||!captureFileName){return;}
    var blob=new Blob([captureText],{type:"application/json"});
    var objectUrl=URL.createObjectURL(blob);
    var anchor=document.createElement("a");
    anchor.href=objectUrl;
    anchor.download=captureFileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function(){URL.revokeObjectURL(objectUrl);},1000);
    setStatus("Roster JSON downloaded. Return to the optimizer and choose that file.","#8ee7a2");
  }
  function readXhr(xhr){
    try{
      if(xhr.responseType==="json"){capture(xhr.response);return;}
      if(xhr.responseType===""||xhr.responseType==="text"){capture(JSON.parse(xhr.responseText));return;}
      setStatus("The roster response used an unsupported browser format. Use the Network-panel fallback in the optimizer.","#ffba7a");
    }catch(error){setStatus("The roster response could not be read. Try reopening the game card.","#ffba7a");}
  }
  function wrappedOpen(method,url){this[requestUrlKey]=String(url);return originalOpen.apply(this,arguments);}
  function wrappedSend(){
    var xhr=this;
    if(!capturing&&isTarget(xhr[requestUrlKey])){xhr.addEventListener("load",function(){readXhr(xhr);},{once:true});}
    return originalSend.apply(xhr,arguments);
  }
  function wrappedFetch(){
    var args=arguments;
    var request=args[0];
    var url=request&&typeof request==="object"&&"url" in request?request.url:request;
    var responsePromise=originalFetch.apply(this,args);
    if(!capturing&&isTarget(url)){
      responsePromise.then(function(response){return response.clone().json();}).then(capture).catch(function(){setStatus("The roster response could not be read. Try reopening the game card.","#ffba7a");});
    }
    return responsePromise;
  }
  async function runDirectCapture(){
    if(finished||capturing||!directRequest){return;}
    capturing=true;
    try{
      var rosterResponse=await directRequest("/web/v1/game/endfield/team/user-game-data",{});
      if(!hasRoster(rosterResponse)){
        setStatus("The helper is ready. Enable SKPort's official Sync Data option to request the roster.","#ffdf82");
        return;
      }
      var catalogResults=await Promise.allSettled([
        directRequest("/web/v1/game/endfield/search-chars",{}),
        directRequest("/web/v1/game/endfield/search-weapons",{}),
        directRequest("/web/v1/game/endfield/search-equipments",{}),
        directRequest("/web/v1/game/endfield/search-tactical-items",{})
      ]);
      function catalogValue(index){return catalogResults[index].status==="fulfilled"?catalogResults[index].value:null;}
      var characterCatalog=catalogValue(0);
      if(!characterCatalog){setStatus("The roster was found, but SKPort's character-name catalog did not load. Click inside Team Picks to retry.","#ffba7a");return;}
      var gameData=getUserGameData(rosterResponse);
      var names=new Map(getCatalogCharacters(characterCatalog).map(function(character){return [character.id,character.name];}));
      var owned=Object.values(gameData.userChars||{}).filter(function(character){return character&&character.owned===true&&String(names.get(character.charId)||"").toLowerCase()!=="endministrator";});
      var operatorDetails=new Array(owned.length);
      var nextIndex=0;
      var completed=0;
      async function worker(){
        while(nextIndex<owned.length){
          var index=nextIndex++;
          var character=owned[index];
          try{
            var detailResponse=await directRequest("/web/v1/game/endfield/team/user-char-data",{roleId:gameData.roleId,charId:character.charId});
            if(getUserChar(detailResponse)){operatorDetails[index]=detailResponse;}
          }catch(error){}
          completed+=1;
          setStatus("Capturing equipped loadouts "+completed+" / "+owned.length+"…","#ffdf82");
        }
      }
      await Promise.all(Array.from({length:Math.min(3,owned.length)},worker));
      var capturedDetails=operatorDetails.filter(Boolean);
      capture(rosterResponse,{characters:characterCatalog,weapons:catalogValue(1),equipment:catalogValue(2),tacticalItems:catalogValue(3)},capturedDetails,{requested:owned.length,captured:capturedDetails.length});
    }catch(error){setStatus("The helper is ready. Enable or re-enable Sync Data; the response will be captured when SKPort requests it.","#ffdf82");}
    finally{if(!finished){capturing=false;}}
  }
  function scheduleDirectCapture(){
    if(finished||!directRequest){return;}
    if(retryTimer){clearTimeout(retryTimer);}
    retryTimer=setTimeout(runDirectCapture,900);
  }
  async function loadOfficialRequestClient(){
    try{
      var assetNode=Array.from(document.querySelectorAll("link[href],script[src]")).find(function(node){return /vendor_src_libs-[^/]+\.js(?:$|\?)/.test(node.href||node.src||"");});
      var moduleUrl=assetNode&&(assetNode.href||assetNode.src);
      if(!moduleUrl){return;}
      var officialModule=await import(moduleUrl);
      if(typeof officialModule.r!=="function"){return;}
      directRequest=officialModule.r;
      document.addEventListener("click",scheduleDirectCapture,true);
      await runDirectCapture();
    }catch(error){setStatus("The helper is listening. Enable or re-enable SKPort's official Sync Data option.","#ffdf82");}
  }
  window.fetch=wrappedFetch;
  xhrPrototype.open=wrappedOpen;
  xhrPrototype.send=wrappedSend;
  copyButton.addEventListener("click",copyCapture);
  downloadButton.addEventListener("click",downloadCapture);
  closeButton.addEventListener("click",close);
  window[stateKey]={focus:focusPanel,close:close};
  loadOfficialRequestClient();
})();`;

export const SKPORT_CAPTURE_BOOKMARKLET = `javascript:${SKPORT_CAPTURE_SOURCE.replace(/\s+/g, " ").trim()}`;
