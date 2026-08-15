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
  var directRequest=null;
  var retryTimer=null;
  var panel=document.createElement("div");
  panel.id="endfield-dijiang-roster-capture";
  panel.setAttribute("style","position:fixed;z-index:2147483647;right:20px;bottom:20px;width:min(380px,calc(100vw - 40px));padding:18px;border:1px solid #d89b37;border-radius:14px;background:#171a20;color:#f8f4ea;box-shadow:0 18px 50px rgba(0,0,0,.45);font:14px/1.45 system-ui,sans-serif;text-align:left");
  panel.innerHTML="<div style='font-weight:750;font-size:16px;margin-bottom:7px'>Endfield roster capture is listening</div><div data-capture-status>In Team Picks, enable or re-enable the official Sync Data option. Do not reload the whole browser tab.</div><div style='margin-top:9px;color:#d5c8b3;font-size:12px'>Only the Endfield roster response will be saved. Keep the downloaded file private because it can contain account and game-profile data.</div><button type='button' data-capture-close style='margin-top:12px;padding:7px 11px;border:1px solid #777;border-radius:8px;background:#2a2e36;color:#fff;cursor:pointer'>Cancel</button>";
  document.documentElement.appendChild(panel);
  var statusNode=panel.querySelector("[data-capture-status]");
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
  function capture(payload,referenceCatalogs){
    if(finished){return;}
    if(!hasRoster(payload)){setStatus("The roster request completed, but its response did not contain operator data. Try re-enabling Sync Data.","#ffba7a");return;}
    finished=true;
    restore();
    var capturedAt=new Date().toISOString();
    var output={captureFormat:"endfield-dijiang-skport-roster-v2",capturedAt:capturedAt,source:location.origin,response:payload};
    if(referenceCatalogs){
      output.characterCatalog=referenceCatalogs.characters;
      output.weaponCatalog=referenceCatalogs.weapons;
      output.equipmentCatalog=referenceCatalogs.equipment;
      output.tacticalItemCatalog=referenceCatalogs.tacticalItems;
    }
    var blob=new Blob([JSON.stringify(output,null,2)],{type:"application/json"});
    var objectUrl=URL.createObjectURL(blob);
    var anchor=document.createElement("a");
    anchor.href=objectUrl;
    anchor.download="endfield-skport-roster-"+capturedAt.slice(0,19).replace(/[:T]/g,"-")+".json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function(){URL.revokeObjectURL(objectUrl);},1000);
    setStatus("Roster captured and downloaded. Return to the optimizer and choose the downloaded JSON file.","#8ee7a2");
    closeButton.textContent="Close";
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
    if(isTarget(xhr[requestUrlKey])){xhr.addEventListener("load",function(){readXhr(xhr);},{once:true});}
    return originalSend.apply(xhr,arguments);
  }
  function wrappedFetch(){
    var args=arguments;
    var request=args[0];
    var url=request&&typeof request==="object"&&"url" in request?request.url:request;
    var responsePromise=originalFetch.apply(this,args);
    if(isTarget(url)){
      responsePromise.then(function(response){return response.clone().json();}).then(capture).catch(function(){setStatus("The roster response could not be read. Try reopening the game card.","#ffba7a");});
    }
    return responsePromise;
  }
  async function runDirectCapture(){
    if(finished||!directRequest){return;}
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
      capture(rosterResponse,{characters:characterCatalog,weapons:catalogValue(1),equipment:catalogValue(2),tacticalItems:catalogValue(3)});
    }catch(error){setStatus("The helper is ready. Enable or re-enable Sync Data; the response will be captured when SKPort requests it.","#ffdf82");}
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
  closeButton.addEventListener("click",close);
  window[stateKey]={focus:focusPanel,close:close};
  loadOfficialRequestClient();
})();`;

export const SKPORT_CAPTURE_BOOKMARKLET = `javascript:${SKPORT_CAPTURE_SOURCE.replace(/\s+/g, " ").trim()}`;
