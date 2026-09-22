// Decode pixels locally. Barcode images are never submitted as freshness evidence.
export function findBarcodeDelivery(code, deliveries, today,{allowMissing=false}={}) {
  const normalized=String(code??'').trim();
  if(!/^\d{8,14}$/.test(normalized))throw Error('바코드 숫자 8~14자리를 확인해 주세요.');
  const matches=deliveries.filter(d=>d.productCode===normalized&&d.arrivalDate===today);
  if(!matches.length){if(allowMissing)return null;throw Error('오늘 입고목록에 없습니다. 바코드를 직접 입력하면 상품정보를 추가해 검수할 수 있습니다.');}
  if(matches.length>1)throw Error('같은 상품의 입고 건이 여러 개입니다. 입고목록에서 해당 건을 선택해 주세요.');
  return matches[0];
}

export function createBarcodeReader() {
  const zxing=globalThis.ZXing;
  if(!zxing)throw Error('바코드 인식 기능을 불러오지 못했습니다. 다시 시도하거나 바코드를 직접 입력해 주세요.');
  const hints=new Map([[zxing.DecodeHintType.POSSIBLE_FORMATS,[zxing.BarcodeFormat.EAN_13,zxing.BarcodeFormat.EAN_8,zxing.BarcodeFormat.CODE_128,zxing.BarcodeFormat.UPC_A]]]);
  return new zxing.BrowserMultiFormatReader(hints);
}

export function validateDefectQuantity(value, actualQuantity) {
  const quantity=Number(value);
  if(String(value??'').trim()===''||!Number.isSafeInteger(quantity)||quantity<1||quantity>actualQuantity)
    throw Error('부적합 수량을 1부터 실입고 '+actualQuantity+'개 사이의 정수로 입력해 주세요.');
  return quantity;
}
