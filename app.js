const $ = (id) => document.getElementById(id);
const state = {
  files: [], invoices: [],
  supplierLedgers: JSON.parse(localStorage.getItem('tally_supplier_ledgers') || '[]'),
  stockItems: JSON.parse(localStorage.getItem('tally_stock_items') || '[]'),
  supplierMap: JSON.parse(localStorage.getItem('tally_supplier_map') || '{}'),
  productMap: JSON.parse(localStorage.getItem('tally_product_map') || '{}')
};

const esc = (s='') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const xesc = (s='') => String(s).replace(/[<>&'\"]/g, c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
const num = (v) => Number(String(v ?? '').replace(/,/g,'')) || 0;
const money = (v) => num(v).toFixed(2);
const keyNorm = (s='') => String(s).toLowerCase().replace(/m\/s\.?/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const gstNorm = (s='') => String(s).toUpperCase().replace(/\s/g,'');

function persist(){
  localStorage.setItem('tally_supplier_ledgers', JSON.stringify(state.supplierLedgers));
  localStorage.setItem('tally_stock_items', JSON.stringify(state.stockItems));
  localStorage.setItem('tally_supplier_map', JSON.stringify(state.supplierMap));
  localStorage.setItem('tally_product_map', JSON.stringify(state.productMap));
}
function status(msg,type=''){ $('status').textContent=msg; $('status').className='status '+type; }

$('fileInput').addEventListener('change', e => { state.files=[...e.target.files]; status(`${state.files.length} file(s) selected.`); });
$('clearBtn').onclick=()=>{ state.files=[]; state.invoices=[]; $('fileInput').value=''; renderAll(); status('Session cleared. Saved mappings were kept.'); };

function dialogAdd(title,label,onSave){
  $('dialogTitle').textContent=title; $('dialogLabel').childNodes[0].nodeValue=label; $('dialogInput').value='';
  const d=$('simpleDialog'); d.showModal();
  const handler=()=>{ if(d.returnValue==='default'){ const v=$('dialogInput').value.trim(); if(v) onSave(v); } d.removeEventListener('close',handler); };
  d.addEventListener('close',handler);
}
$('addSupplierLedgerBtn').onclick=()=>dialogAdd('Add Tally Supplier Ledger','Ledger name ',v=>{if(!state.supplierLedgers.includes(v))state.supplierLedgers.push(v);persist();renderAll();});
$('addStockItemBtn').onclick=()=>dialogAdd('Add Tally Stock Item','Stock item name ',v=>{if(!state.stockItems.includes(v))state.stockItems.push(v);persist();renderAll();});

async function loadPdfJs(){
  try { return await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs'); }
  catch(e){ throw new Error('PDF library could not load. Connect to the internet once, or upload images instead.'); }
}
async function ocrCanvas(canvas){
  if(!window.Tesseract) throw new Error('OCR library could not load. Internet connection is needed for first use.');
  const { data } = await Tesseract.recognize(canvas, 'eng', { logger:m=>{ if(m.progress) $('progress').value=Math.round(m.progress*100); } });
  return data.text;
}
async function imageToText(file){
  const img = await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=URL.createObjectURL(file)});
  const c=document.createElement('canvas'); const max=1900, scale=Math.min(1.6,max/Math.max(img.width,img.height)); c.width=img.width*scale;c.height=img.height*scale;
  c.getContext('2d').drawImage(img,0,0,c.width,c.height); return await ocrCanvas(c);
}
async function pdfToTexts(file){
  const pdfjs=await loadPdfJs(); pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
  const pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise; const pages=[];
  for(let p=1;p<=pdf.numPages;p++){
    status(`OCR: ${file.name} — page ${p}/${pdf.numPages}`); const page=await pdf.getPage(p); const vp=page.getViewport({scale:1.8}); const c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;
    await page.render({canvasContext:c.getContext('2d'),viewport:vp}).promise; pages.push(await ocrCanvas(c));
  }
  return pages;
}

function parseDate(text){
  const m=text.match(/(?:invoice\s*date|date)\s*[:#-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i)||text.match(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})\b/); return m?.[1]||'';
}
function parseInvoiceNo(text){
  const m=text.match(/(?:invoice\s*(?:no|number|#)|inv\.?\s*no)\s*[:#-]?\s*([A-Z0-9\/-]{2,30})/i); return m?.[1]||'';
}
function parseGSTINs(text){ return [...new Set((text.toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/g)||[]).map(gstNorm))]; }
function parseSupplier(text){
  const lines=text.split(/\r?\n/).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
  const blacklist=/tax invoice|invoice|gstin|phone|email|address|bill to|ship to|buyer|consignee|original|duplicate/i;
  for(const ln of lines.slice(0,18)){ if(ln.length>=4&&ln.length<=70&&!blacklist.test(ln)&&/[A-Za-z]{3}/.test(ln)&&!/^[\d\W]+$/.test(ln)) return ln; }
  return 'Unknown Supplier';
}
function parseTotals(text){
  const pick=(re)=>{const m=text.match(re);return m?num(m[1]):0};
  return {
    discount:pick(/(?:discount|disc\.?)[^\d]{0,12}([\d,]+(?:\.\d{1,2})?)/i),
    cgst:pick(/\bcgst\b[^\d]{0,18}([\d,]+(?:\.\d{1,2})?)/i),
    sgst:pick(/\bsgst\b[^\d]{0,18}([\d,]+(?:\.\d{1,2})?)/i),
    igst:pick(/\bigst\b[^\d]{0,18}([\d,]+(?:\.\d{1,2})?)/i),
    final:pick(/(?:grand\s*total|invoice\s*total|net\s*(?:amount|total)|total\s*amount|amount\s*payable)[^\d]{0,18}(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i)
  };
}
function parseItems(text){
  const lines=text.split(/\r?\n/).map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean); const out=[];
  for(const ln of lines){
    if(/total|cgst|sgst|igst|taxable|discount|invoice|gstin|hsn summary/i.test(ln)) continue;
    const m=ln.match(/^(.{3,65}?)\s+(\d+(?:\.\d+)?)\s+(PCS|NOS|NO|KG|MTR|METER|SET|BOX|PKT|EA)?\s*([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d{1,2})?)$/i);
    if(m){ out.push({description:m[1].trim(),qty:num(m[2]),unit:(m[3]||'PCS').toUpperCase(),rate:num(m[4]),amount:num(m[5]),discount:0,gstRate:0}); }
  }
  if(!out.length) out.push({description:'Unrecognized item — edit this',qty:1,unit:'PCS',rate:0,amount:0,discount:0,gstRate:0});
  return out;
}
function invoiceFromText(text, source, page){
  const gstins=parseGSTINs(text); const totals=parseTotals(text); const items=parseItems(text);
  return { id:crypto.randomUUID(),source,page,supplier:parseSupplier(text),supplierGstin:gstins[0]||'',invoiceNo:parseInvoiceNo(text),date:parseDate(text),items,discount:totals.discount,cgst:totals.cgst,sgst:totals.sgst,igst:totals.igst,roundOff:0,finalAmount:totals.final,rawText:text };
}

$('scanBtn').onclick=async()=>{
  if(!state.files.length){status('Please select PDF or image invoice files first.','error');return;}
  $('progress').hidden=false;$('progress').value=0;state.invoices=[];
  try{
    for(const f of state.files){
      if(f.type==='application/pdf'||f.name.toLowerCase().endsWith('.pdf')){ const pages=await pdfToTexts(f); pages.forEach((t,i)=>state.invoices.push(invoiceFromText(t,f.name,i+1))); }
      else { status(`OCR: ${f.name}`); state.invoices.push(invoiceFromText(await imageToText(f),f.name,1)); }
    }
    autoMatchKnown(); renderAll(); status(`Finished. Found ${state.invoices.length} invoice page(s). Review the fields and mappings.`, 'ok');
  }catch(e){console.error(e);status(e.message||String(e),'error');}
  finally{$('progress').hidden=true;}
};

function supplierKey(inv){ return inv.supplierGstin ? 'gst:'+gstNorm(inv.supplierGstin) : 'name:'+keyNorm(inv.supplier); }
function productKey(inv,item){ return `${supplierKey(inv)}|${keyNorm(item.description)}`; }
function autoMatchKnown(){
  for(const inv of state.invoices){
    const k=supplierKey(inv); if(!state.supplierMap[k]){
      const exact=state.supplierLedgers.find(x=>keyNorm(x)===keyNorm(inv.supplier)); if(exact)state.supplierMap[k]=exact;
    }
    for(const it of inv.items){const pk=productKey(inv,it);if(!state.productMap[pk]){const exact=state.stockItems.find(x=>keyNorm(x)===keyNorm(it.description));if(exact)state.productMap[pk]=exact;}}
  } persist();
}

function optionHtml(list,selected,blank='-- Select --'){return `<option value="">${blank}</option>`+list.map(x=>`<option ${x===selected?'selected':''} value="${esc(x)}">${esc(x)}</option>`).join('');}
function uniqueSuppliers(){const map=new Map();state.invoices.forEach(inv=>{const k=supplierKey(inv);if(!map.has(k))map.set(k,{key:k,name:inv.supplier,gstin:inv.supplierGstin,count:0});map.get(k).count++;});return [...map.values()];}
function uniqueProducts(){const map=new Map();state.invoices.forEach(inv=>inv.items.forEach(it=>{const k=productKey(inv,it);if(!map.has(k))map.set(k,{key:k,supplier:inv.supplier,description:it.description});}));return [...map.values()];}

function renderSuppliers(){const box=$('supplierMappings'), rows=uniqueSuppliers();if(!rows.length){box.className='empty';box.textContent='Scan invoices to detect suppliers.';return;}box.className='';box.innerHTML=rows.map(r=>`<div class="mapping-row"><div><strong>${esc(r.name)}</strong><br><small>${esc(r.gstin||'GSTIN not detected')} • ${r.count} invoice(s)</small></div><label>Tally supplier ledger<select data-supplier-key="${esc(r.key)}">${optionHtml(state.supplierLedgers,state.supplierMap[r.key])}</select></label><label>Invoice supplier GSTIN<input value="${esc(r.gstin)}" readonly></label><button data-new-ledger="1">+ Ledger</button></div>`).join('');
  box.querySelectorAll('select[data-supplier-key]').forEach(s=>s.onchange=()=>{state.supplierMap[s.dataset.supplierKey]=s.value;persist();});
  box.querySelectorAll('[data-new-ledger]').forEach(b=>b.onclick=$('addSupplierLedgerBtn').onclick);
}
function renderProducts(){const box=$('productMappings'),rows=uniqueProducts();if(!rows.length){box.className='empty';box.textContent='Products will appear after scanning.';return;}box.className='';box.innerHTML=rows.map(r=>`<div class="mapping-row"><div><strong>${esc(r.description)}</strong><br><small>Supplier: ${esc(r.supplier)}</small></div><label>Tally Stock Item<select data-product-key="${esc(r.key)}">${optionHtml(state.stockItems,state.productMap[r.key])}</select></label><div></div><button data-new-item="1">+ Item</button></div>`).join('');
  box.querySelectorAll('select[data-product-key]').forEach(s=>s.onchange=()=>{state.productMap[s.dataset.productKey]=s.value;persist();});
  box.querySelectorAll('[data-new-item]').forEach(b=>b.onclick=$('addStockItemBtn').onclick);
}
function inputField(label,field,value,type='text'){return `<label>${label}<input data-field="${field}" type="${type}" value="${esc(value)}"></label>`;}
function renderInvoices(){const box=$('invoiceReview');if(!state.invoices.length){box.className='empty';box.textContent='No invoices scanned yet.';return;}box.className='';box.innerHTML=state.invoices.map((inv,ix)=>{
 const expected=inv.items.reduce((s,it)=>s+num(it.amount),0)-num(inv.discount)+num(inv.cgst)+num(inv.sgst)+num(inv.igst)+num(inv.roundOff); const diff=Math.abs(expected-num(inv.finalAmount));
 return `<div class="invoice-card" data-inv="${ix}"><h3>${esc(inv.source)} • Page ${inv.page}</h3><div class="invoice-fields">${inputField('Supplier','supplier',inv.supplier)}${inputField('GSTIN','supplierGstin',inv.supplierGstin)}${inputField('Invoice No.','invoiceNo',inv.invoiceNo)}${inputField('Invoice Date','date',inv.date)}</div><table class="items-table"><thead><tr><th>Supplier Product</th><th>Qty</th><th>Unit</th><th>Rate</th><th>Line Amount</th><th>GST %</th></tr></thead><tbody>${inv.items.map((it,ii)=>`<tr data-item="${ii}"><td><input data-ifield="description" value="${esc(it.description)}"></td><td><input data-ifield="qty" value="${esc(it.qty)}"></td><td><input data-ifield="unit" value="${esc(it.unit)}"></td><td><input data-ifield="rate" value="${esc(it.rate)}"></td><td><input data-ifield="amount" value="${esc(it.amount)}"></td><td><input data-ifield="gstRate" value="${esc(it.gstRate)}"></td></tr>`).join('')}</tbody></table><div class="totals">${inputField('Discount','discount',inv.discount,'number')}${inputField('CGST','cgst',inv.cgst,'number')}${inputField('SGST','sgst',inv.sgst,'number')}${inputField('IGST','igst',inv.igst,'number')}${inputField('Round Off','roundOff',inv.roundOff,'number')}${inputField('Final Amount','finalAmount',inv.finalAmount,'number')}</div>${diff>.5?`<div class="warning">⚠ Calculated total ${money(expected)} differs from invoice final amount ${money(inv.finalAmount)}.</div>`:`<div class="okline">✓ Totals reconcile within ₹0.50.</div>`}</div>`;
 }).join('');
 box.querySelectorAll('.invoice-card').forEach(card=>{const inv=state.invoices[+card.dataset.inv];card.querySelectorAll('[data-field]').forEach(inp=>inp.onchange=()=>{inv[inp.dataset.field]=inp.type==='number'?num(inp.value):inp.value;autoMatchKnown();renderAll();});card.querySelectorAll('tr[data-item]').forEach(row=>{const it=inv.items[+row.dataset.item];row.querySelectorAll('[data-ifield]').forEach(inp=>inp.onchange=()=>{const f=inp.dataset.ifield;it[f]=['qty','rate','amount','gstRate'].includes(f)?num(inp.value):inp.value;autoMatchKnown();renderAll();});});});
}
function renderAll(){renderSuppliers();renderProducts();renderInvoices();}

function dateTally(s){const m=String(s).match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);if(!m)return '';let y=m[3];if(y.length===2)y='20'+y;return `${y}${m[2].padStart(2,'0')}${m[1].padStart(2,'0')}`;}
function validateMappings(){const missing=[];for(const inv of state.invoices){if(!state.supplierMap[supplierKey(inv)])missing.push(`Supplier: ${inv.supplier}`);for(const it of inv.items)if(!state.productMap[productKey(inv,it)])missing.push(`Product: ${it.description}`);}return [...new Set(missing)];}
function tallyXml(){
  const company=$('companyName').value.trim(); if(!company)throw new Error('Enter the exact Tally Company Name.'); if(!state.invoices.length)throw new Error('No invoices available.'); const missing=validateMappings();if(missing.length)throw new Error('Complete these mappings first:\n'+missing.slice(0,8).join('\n'));
  const vouchers=state.invoices.map(inv=>{
    const supplier=state.supplierMap[supplierKey(inv)], d=dateTally(inv.date)||new Date().toISOString().slice(0,10).replaceAll('-','');
    const invLines=inv.items.map(it=>{const stock=state.productMap[productKey(inv,it)],amt=num(it.amount)||num(it.qty)*num(it.rate);return `<ALLINVENTORYENTRIES.LIST><STOCKITEMNAME>${xesc(stock)}</STOCKITEMNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><RATE>${money(it.rate)}/${xesc(it.unit||'PCS')}</RATE><AMOUNT>-${money(amt)}</AMOUNT><ACTUALQTY>${num(it.qty)} ${xesc(it.unit||'PCS')}</ACTUALQTY><BILLEDQTY>${num(it.qty)} ${xesc(it.unit||'PCS')}</BILLEDQTY><ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${xesc($('purchaseLedger').value||'Purchase')}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${money(amt)}</AMOUNT></ACCOUNTINGALLOCATIONS.LIST></ALLINVENTORYENTRIES.LIST>`}).join('');
    const tax=(name,amt)=>num(amt)?`<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xesc(name)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-${money(amt)}</AMOUNT></ALLLEDGERENTRIES.LIST>`:'';
    const supplierAmt=num(inv.finalAmount)||inv.items.reduce((s,it)=>s+(num(it.amount)||num(it.qty)*num(it.rate)),0)-num(inv.discount)+num(inv.cgst)+num(inv.sgst)+num(inv.igst)+num(inv.roundOff);
    return `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Invoice Voucher View"><DATE>${d}</DATE><VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME><REFERENCE>${xesc(inv.invoiceNo)}</REFERENCE><PARTYLEDGERNAME>${xesc(supplier)}</PARTYLEDGERNAME><PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW><ISINVOICE>Yes</ISINVOICE><ALLLEDGERENTRIES.LIST><LEDGERNAME>${xesc(supplier)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>${money(supplierAmt)}</AMOUNT></ALLLEDGERENTRIES.LIST>${invLines}${tax($('cgstLedger').value,inv.cgst)}${tax($('sgstLedger').value,inv.sgst)}${tax($('igstLedger').value,inv.igst)}${tax($('roundOffLedger').value,inv.roundOff)}</VOUCHER></TALLYMESSAGE>`;
  }).join('');
  return `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${xesc(company)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>${vouchers}</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
}
function download(name,text,type='text/plain'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
$('xmlBtn').onclick=()=>{try{const xml=tallyXml();$('xmlPreview').value=xml;download(`tally-purchase-${new Date().toISOString().slice(0,10)}.xml`,xml,'application/xml');status('Tally Purchase XML generated. Review/import it into Tally.','ok');}catch(e){status(e.message,'error');alert(e.message);}};
$('exportMappingsBtn').onclick=()=>download('tally-mappings.json',JSON.stringify({supplierLedgers:state.supplierLedgers,stockItems:state.stockItems,supplierMap:state.supplierMap,productMap:state.productMap},null,2),'application/json');
$('importMappings').onchange=async e=>{try{const j=JSON.parse(await e.target.files[0].text());Object.assign(state,j);persist();renderAll();status('Mappings imported.','ok');}catch{status('Invalid mapping JSON file.','error')}};

if(location.protocol!=='file:' && 'serviceWorker' in navigator){navigator.serviceWorker.register('./sw.js').catch(()=>{});$('modeBadge').textContent='PWA Mode';}
renderAll();