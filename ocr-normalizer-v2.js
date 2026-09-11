(function(){
  if(!window.Tesseract||typeof window.Tesseract.recognize!=='function') return;
  const originalRecognize=window.Tesseract.recognize.bind(window.Tesseract);
  const gstPattern=/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;
  const cleanLine=s=>String(s||'').replace(/[|¦]/g,' ').replace(/\s+/g,' ').trim();
  const linesOf=text=>String(text||'').split(/\r?\n/).map(cleanLine).filter(Boolean);
  const n=v=>Number(String(v||'').replace(/,/g,'').replace(/[^0-9.-]/g,''))||0;
  const nums=line=>(String(line).match(/-?\s*[\d,]+(?:\.\d{1,2})?/g)||[]).map(n);
  const lastNum=line=>{const a=nums(line);return a.length?a[a.length-1]:0};

  function fixDigit(c){return ({O:'0',Q:'0',D:'0',I:'1',L:'1',S:'5',B:'8',G:'6'}[c]||c)}
  function fixLetter(c){return ({'0':'O','1':'I','5':'S','8':'B','6':'G'}[c]||c)}
  function normalizeGSTCandidate(raw){
    let s=String(raw||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(s.length!==15) return '';
    const chars=[...s];
    [0,1,7,8,9,10].forEach(i=>chars[i]=fixDigit(chars[i]));
    [2,3,4,5,6,11].forEach(i=>chars[i]=fixLetter(chars[i]));
    chars[13]='Z';
    s=chars.join('');
    return gstPattern.test(s)?s:'';
  }

  function findSupplierGSTIN(text){
    const supplierPart=String(text||'').split(/\b(?:Buyer|Bill\s*to|Consignee)\b/i)[0];
    const lines=linesOf(supplierPart);
    for(let i=0;i<lines.length;i++){
      if(!/GSTIN|GSTIN\/UIN|GST\s*No/i.test(lines[i])) continue;
      const block=lines.slice(i,Math.min(lines.length,i+4)).join(' ').toUpperCase();
      const after=block.replace(/^.*?(?:GSTIN(?:\/UIN)?|GST\s*NO)\s*[:.-]?\s*/i,'');
      const compact=after.replace(/[^A-Z0-9]/g,'');
      for(let p=0;p<=compact.length-15;p++){
        const candidate=normalizeGSTCandidate(compact.slice(p,p+15));
        if(candidate) return candidate;
      }
    }
    const compact=supplierPart.toUpperCase().replace(/[^A-Z0-9]/g,'');
    for(let p=0;p<=compact.length-15;p++){
      const candidate=normalizeGSTCandidate(compact.slice(p,p+15));
      if(candidate) return candidate;
    }
    return '';
  }

  function findInvoiceNo(text){
    const lines=linesOf(text);
    for(let i=0;i<lines.length;i++){
      if(!/(?:Invoice\s*(?:No\.?|Number|#)|Inv\.?\s*No\.?)/i.test(lines[i])) continue;
      const same=lines[i].replace(/^.*?(?:Invoice\s*(?:No\.?|Number|#)|Inv\.?\s*No\.?)\s*[:#.-]?\s*/i,' ');
      const next=lines.slice(i+1,Math.min(lines.length,i+5)).join(' ');
      const tokens=(same+' '+next).match(/[A-Z0-9][A-Z0-9\/-]{0,29}/gi)||[];
      for(const raw of tokens){
        const token=raw.replace(/^[\/-]+|[\/-]+$/g,'');
        if(!/\d/.test(token)) continue;
        if(/^\d{1,2}[\/-](?:\d{1,2}|[A-Za-z]{3,9})[\/-]\d{2,4}$/i.test(token)) continue;
        if(/^\d{10,}$/.test(token)) continue;
        if(normalizeGSTCandidate(token)) continue;
        if(token.length<=20) return token;
      }
    }
    return '';
  }

  function findSupplierName(text){
    const supplierPart=String(text||'').split(/\b(?:Buyer|Bill\s*to|Consignee)\b/i)[0];
    const lines=linesOf(supplierPart).slice(0,18);
    let best='',bestScore=-1;
    for(const raw of lines){
      const line=cleanLine(raw.split(/\b(?:Invoice\s*No\.?|Dated|Delivery\s*Note|Mode\/Terms|Reference\s*No\.?|Other\s*References)\b/i)[0]);
      if(line.length<4||line.length>70) continue;
      if(/tax\s*invoice|original|duplicate|plot\b|road\b|street\b|nagar\b|midc\b|solapur\b|maharashtra\b|state\b|contact\b|phone\b|gstin|gst\s*no|pin\b|code\b/i.test(line)) continue;
      const letters=(line.match(/[A-Za-z]/g)||[]).length;
      if(letters<4) continue;
      const words=line.match(/[A-Za-z][A-Za-z&.'-]*/g)||[];
      if(words.length<2) continue;
      const upper=(line.match(/[A-Z]/g)||[]).length;
      let score=words.length*2+(letters?upper/letters*5:0);
      if(/\b(?:TRADERS?|TEXTILES?|YARN|INDUSTRIES|ENTERPRISES?|CORPORATION|COMPANY|PVT|LTD|AND|TEX)\b/i.test(line)) score+=7;
      if(score>bestScore){bestScore=score;best=line;}
    }
    return best;
  }

  function cleanProductSerials(text){
    return String(text||'').split(/\r?\n/).map(raw=>{
      let line=raw;
      if(/[A-Za-z]/.test(line)&&/[\d,]+(?:\.\d{1,2})?/.test(line)){
        line=line.replace(/^\s*\d{1,3}\s*[\{\[\(\|]+\s*/, '');
        line=line.replace(/^\s*\d{1,3}\s+[\{\[\(\|]+\s*/, '');
      }
      return line;
    }).join('\n');
  }

  function labeledAmount(text,labelRe,abs=true){
    const lines=linesOf(text);
    for(let i=0;i<lines.length;i++){
      if(!labelRe.test(lines[i])) continue;
      for(let span=1;span<=3;span++){
        const block=lines.slice(i,Math.min(lines.length,i+span)).join(' ');
        const values=nums(block);
        if(values.length){
          const v=values[values.length-1];
          if(v!==0) return abs?Math.abs(v):v;
        }
      }
    }
    return 0;
  }

  function findFinalTotal(text){
    const lines=linesOf(text), candidates=[];
    for(let i=0;i<lines.length;i++){
      if(!/\b(?:grand\s*)?tota[l1i]\b|amount\s*payable|invoice\s*total|net\s*amount/i.test(lines[i])) continue;
      if(/tax\s*amount|taxable|cgst|sgst|igst|hsn/i.test(lines[i])) continue;
      const block=lines.slice(i,Math.min(lines.length,i+3)).join(' ');
      const v=lastNum(block);
      if(v>0) candidates.push(v);
    }
    return candidates.length?Math.max(...candidates):0;
  }

  function findGrossAmount(text){
    const lines=linesOf(text), candidates=[];
    for(let i=0;i<lines.length;i++){
      const block=lines.slice(i,Math.min(lines.length,i+3)).join(' ');
      if(!/\b(?:PCS|PC|NOS|KG|MTR|METER|SET|BOX|PKT|PACK|EA)\b/i.test(block)) continue;
      if(/description\s*of\s*goods|quantity|rate\s*per|total\s*quantity/i.test(block)) continue;
      const values=nums(block);
      if(values.length>=3){const v=values[values.length-1];if(v>0)candidates.push(v)}
    }
    return candidates.length?Math.max(...candidates):0;
  }

  function normalizeInvoiceText(text){
    const cleaned=cleanProductSerials(text);
    const supplier=findSupplierName(cleaned);
    const gstin=findSupplierGSTIN(cleaned);
    const invoiceNo=findInvoiceNo(cleaned);
    const discount=labeledAmount(cleaned,/sales\s*discount|\bdiscount\b|\bdisc\.?\b/i,true);
    const cgst=labeledAmount(cleaned,/\bC\s*GST\b|\bCGST\b/i,true);
    const sgst=labeledAmount(cleaned,/\bS\s*GST\b|\bSGST\b|\bUTGST\b/i,true);
    const igst=labeledAmount(cleaned,/\bI\s*GST\b|\bIGST\b/i,true);
    const roundOff=labeledAmount(cleaned,/round\s*off/i,false);
    let finalTotal=findFinalTotal(cleaned);
    if(!finalTotal){
      const gross=findGrossAmount(cleaned);
      const calc=gross-discount+cgst+sgst+igst+roundOff;
      if(calc>0) finalTotal=Math.round(calc*100)/100;
    }
    const prefix=[];
    if(supplier) prefix.push(supplier);
    if(gstin) prefix.push('GSTIN/UIN: '+gstin);
    if(invoiceNo) prefix.push('Invoice No. '+invoiceNo);
    if(discount) prefix.push('Sales Discount '+discount.toFixed(2));
    if(cgst) prefix.push('CGST '+cgst.toFixed(2));
    if(sgst) prefix.push('SGST '+sgst.toFixed(2));
    if(igst) prefix.push('IGST '+igst.toFixed(2));
    if(roundOff) prefix.push('Round Off '+roundOff.toFixed(2));
    if(finalTotal) prefix.push('Total INR '+finalTotal.toFixed(2));
    return prefix.length?prefix.join('\n')+'\n'+cleaned:cleaned;
  }

  window.Tesseract.recognize=async function(){
    const result=await originalRecognize(...arguments);
    if(result&&result.data&&typeof result.data.text==='string') result.data.text=normalizeInvoiceText(result.data.text);
    return result;
  };
})();