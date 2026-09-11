(function(){
  const KEY='tally_export_settings_v1';
  const IDS=['companyName','purchaseLedger','discountLedger','cgstLedger','sgstLedger','igstLedger','roundOffLedger'];
  const defaults={purchaseLedger:'Purchase',discountLedger:'Purchase Discount',cgstLedger:'Input CGST',sgstLedger:'Input SGST',igstLedger:'Input IGST',roundOffLedger:'Round Off'};
  function read(){try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch{return{}}}
  function collect(){const out={};for(const id of IDS){const el=document.getElementById(id);if(el)out[id]=el.value.trim()}return out}
  function save(){localStorage.setItem(KEY,JSON.stringify(collect()))}
  function apply(values){for(const id of IDS){const el=document.getElementById(id);if(!el)continue;const v=values&&Object.prototype.hasOwnProperty.call(values,id)?values[id]:undefined;if(v!==undefined&&v!==null&&String(v)!=='')el.value=String(v);else if(!el.value&&defaults[id])el.value=defaults[id]}}
  function download(name,text,type='application/json'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  function init(){
    apply(read());
    for(const id of IDS){const el=document.getElementById(id);if(!el)continue;el.addEventListener('input',save);el.addEventListener('change',save)}
    const exportBtn=document.getElementById('exportMappingsBtn');
    if(exportBtn){exportBtn.onclick=()=>{save();const payload={supplierLedgers:JSON.parse(localStorage.getItem('tally_supplier_ledgers')||'[]'),stockItems:JSON.parse(localStorage.getItem('tally_stock_items')||'[]'),supplierMap:JSON.parse(localStorage.getItem('tally_supplier_map')||'{}'),productMap:JSON.parse(localStorage.getItem('tally_product_map')||'{}'),exportSettings:collect()};download('tally-mappings-and-settings.json',JSON.stringify(payload,null,2))}}
    const importInput=document.getElementById('importMappings');
    if(importInput){importInput.onchange=async e=>{try{const file=e.target.files&&e.target.files[0];if(!file)return;const j=JSON.parse(await file.text());if(Array.isArray(j.supplierLedgers))localStorage.setItem('tally_supplier_ledgers',JSON.stringify(j.supplierLedgers));if(Array.isArray(j.stockItems))localStorage.setItem('tally_stock_items',JSON.stringify(j.stockItems));if(j.supplierMap&&typeof j.supplierMap==='object')localStorage.setItem('tally_supplier_map',JSON.stringify(j.supplierMap));if(j.productMap&&typeof j.productMap==='object')localStorage.setItem('tally_product_map',JSON.stringify(j.productMap));if(j.exportSettings&&typeof j.exportSettings==='object'){apply(j.exportSettings);localStorage.setItem(KEY,JSON.stringify(j.exportSettings))}alert('Mappings and saved ledger settings imported. Reloading the app.');location.reload()}catch(err){alert('Invalid mapping/settings JSON file.')}}}
  }
  window.addEventListener('DOMContentLoaded',()=>setTimeout(init,0));
})();