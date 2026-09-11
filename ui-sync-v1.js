(function(){
  function norm(s){return String(s||'').trim().toLowerCase().replace(/\s+/g,' ')}
  let syncing=false;
  function syncSupplierNames(){
    if(syncing) return;
    syncing=true;
    try{
      const rows=[...document.querySelectorAll('#supplierMappings .mapping-row')];
      const cards=[...document.querySelectorAll('#invoiceReview .invoice-card')];
      for(const row of rows){
        const select=row.querySelector('select[data-supplier-key]');
        if(!select||!select.value) continue;
        const mapped=select.value;
        const sourceName=row.querySelector('strong')?.textContent?.trim()||'';
        const gstin=row.querySelector('input[readonly]')?.value?.trim()||'';
        for(const card of cards){
          const supplierInput=card.querySelector('input[data-field="supplier"]');
          const gstInput=card.querySelector('input[data-field="supplierGstin"]');
          if(!supplierInput) continue;
          const sameGST=gstin&&gstInput&&norm(gstInput.value)===norm(gstin);
          const sameName=!gstin&&norm(supplierInput.value)===norm(sourceName);
          if((sameGST||sameName)&&supplierInput.value!==mapped){
            supplierInput.value=mapped;
            if(sameGST) supplierInput.dispatchEvent(new Event('change',{bubbles:true}));
          }
        }
      }
    }finally{syncing=false}
  }
  document.addEventListener('change',e=>{
    if(e.target.matches('#supplierMappings select[data-supplier-key]')) setTimeout(syncSupplierNames,0);
  },true);
  const observer=new MutationObserver(()=>requestAnimationFrame(syncSupplierNames));
  window.addEventListener('DOMContentLoaded',()=>{
    const a=document.getElementById('supplierMappings');
    const b=document.getElementById('invoiceReview');
    if(a) observer.observe(a,{childList:true,subtree:true});
    if(b) observer.observe(b,{childList:true,subtree:true});
    syncSupplierNames();
  });
})();