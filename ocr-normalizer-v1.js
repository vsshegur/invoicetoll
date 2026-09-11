(function(){
  if(!window.Tesseract||typeof window.Tesseract.recognize!=='function') return;
  const originalRecognize=window.Tesseract.recognize.bind(window.Tesseract);
  const gstPattern=/\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]/;
  const cleanLine=s=>String(s||'').replace(/[|¦]/g,' ').replace(/\s+/g,' ').trim();
  const linesOf=text=>String(text||'').split(/\r?\n/).map(cleanLine).filter(Boolean);

  function findSupplierGSTIN(text){
    const supplierPart=String(text||'').split(/\b(?:Buyer|Bill\s*to|Consignee)\b/i)[0];
    const lines=linesOf(supplierPart);
    for(let i=0;i<lines.length;i++){
      if(!/GSTIN|GSTIN\/UIN|GST\s*No/i.test(lines[i])) continue;
      const block=lines.slice(i,Math.min(lines.length,i+3)).join(' ').toUpperCase();
      const after=block.replace(/^.*?(?:GSTIN(?:\/UIN)?|GST\s*NO)\s*[:.-]?\s*/i,'');
      const compact=after.replace(/[^A-Z0-9]/g,'');
      for(let p=0;p<=compact.length-15;p++){
        const candidate=compact.slice(p,p+15);
        if(gstPattern.test(candidate)) return candidate;
      }
    }
    const compact=supplierPart.toUpperCase().replace(/[^A-Z0-9]/g,'');
    for(let p=0;p<=compact.length-15;p++){
      const candidate=compact.slice(p,p+15);
      if(gstPattern.test(candidate)) return candidate;
    }
    return '';
  }

  function findInvoiceNo(text){
    const lines=linesOf(text);
    for(let i=0;i<lines.length;i++){
      if(!/(?:Invoice\s*(?:No\.?|Number|#)|Inv\.?\s*No\.?)/i.test(lines[i])) continue;
      const windowText=lines.slice(i,Math.min(lines.length,i+4)).join(' ')
        .replace(/.*?(?:Invoice\s*(?:No\.?|Number|#)|Inv\.?\s*No\.?)\s*[:#.-]?\s*/i,' ');
      const tokens=windowText.match(/[A-Z0-9][A-Z0-9\/-]{0,29}/gi)||[];
      for(const tokenRaw of tokens){
        const token=tokenRaw.replace(/^[\/-]+|[\/-]+$/g,'');
        if(!/\d/.test(token)) continue;
        if(/^\d{1,2}[\/-](?:\d{1,2}|[A-Za-z]{3,9})[\/-]\d{2,4}$/i.test(token)) continue;
        if(/^\d{10,}$/.test(token)) continue;
        if(gstPattern.test(token.toUpperCase())) continue;
        if(token.length<=20) return token;
      }
    }
    return '';
  }

  function findSupplierName(text){
    const supplierPart=String(text||'').split(/\b(?:Buyer|Bill\s*to|Consignee)\b/i)[0];
    const lines=linesOf(supplierPart).slice(0,16);
    let best='',bestScore=-1;
    for(const line of lines){
      if(line.length<4||line.length>70) continue;
      if(/tax\s*invoice|original|duplicate|invoice\s*no|dated|delivery|reference|mode\/terms|plot\b|road\b|street\b|nagar\b|midc\b|solapur\b|maharashtra\b|state\b|contact\b|phone\b|gstin|gst\s*no|pin\b|code\b/i.test(line)) continue;
      const letters=(line.match(/[A-Za-z]/g)||[]).length;
      if(letters<4) continue;
      const words=line.match(/[A-Za-z][A-Za-z&.'-]*/g)||[];
      if(words.length<2) continue;
      const upper=(line.match(/[A-Z]/g)||[]).length;
      let score=words.length*2+(letters?upper/letters*5:0);
      if(/\b(?:TRADERS?|TEXTILES?|YARN|INDUSTRIES|ENTERPRISES?|CORPORATION|COMPANY|PVT|LTD|AND|&|TEX)\b/i.test(line)) score+=5;
      if(score>bestScore){bestScore=score;best=line;}
    }
    return best;
  }

  function normalizeInvoiceText(text){
    const supplier=findSupplierName(text);
    const gstin=findSupplierGSTIN(text);
    const invoiceNo=findInvoiceNo(text);
    const prefix=[];
    if(supplier) prefix.push(supplier);
    if(gstin) prefix.push('GSTIN/UIN: '+gstin);
    if(invoiceNo) prefix.push('Invoice No. '+invoiceNo);
    return prefix.length?prefix.join('\n')+'\n'+text:text;
  }

  window.Tesseract.recognize=async function(){
    const result=await originalRecognize(...arguments);
    if(result&&result.data&&typeof result.data.text==='string') result.data.text=normalizeInvoiceText(result.data.text);
    return result;
  };
})();