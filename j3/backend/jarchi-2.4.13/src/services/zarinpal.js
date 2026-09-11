
import {config} from "../config.js";
import {query} from "../db/db.js";
import {createInvoice,activateInvoice} from "./billing.js";
import { getEntitlements } from "./entitlements.js";

const urls={
  request:config.zarinpal.sandbox?"https://sandbox.zarinpal.com/pg/v4/payment/request.json":"https://api.zarinpal.com/pg/v4/payment/request.json",
  verify:config.zarinpal.sandbox?"https://sandbox.zarinpal.com/pg/v4/payment/verify.json":"https://api.zarinpal.com/pg/v4/payment/verify.json",
  start:config.zarinpal.sandbox?"https://sandbox.zarinpal.com/pg/StartPay/":"https://www.zarinpal.com/pg/StartPay/"
};
const amount=(t)=>config.zarinpal.amountUnit==="TOMAN"?Number(t)*10:Number(t);

export async function requestZarinPal(userId,planId){
  if(!config.zarinpal.enabled||!config.zarinpal.merchantId)throw new Error("ZarinPal is not configured");
  const inv=await createInvoice(userId,planId,"zarinpal");
  const r=await fetch(urls.request,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
    merchant_id:config.zarinpal.merchantId,amount:amount(inv.amount_toman),description:`Jarchi ${inv.public_id}`,
    callback_url:config.zarinpal.callbackUrl
  })});
  const d=await r.json();
  if(!r.ok||Number(d?.data?.code)!==100)throw new Error(d?.errors?.message||d?.data?.message||"ZarinPal request failed");
  const authority=String(d.data.authority), checkout=`${urls.start}${authority}`;
  await query("UPDATE invoices SET gateway='zarinpal',gateway_authority=$2,checkout_url=$3 WHERE public_id=$1",[inv.public_id,authority,checkout]);
  return {invoice:{...inv,gateway:"zarinpal",gateway_authority:authority,checkout_url:checkout},checkout_url:checkout};
}

export async function callbackZarinPal(authority,status){
  const inv=(await query("SELECT * FROM invoices WHERE gateway='zarinpal' AND gateway_authority=$1 LIMIT 1",[authority])).rows[0];
  if(!inv)throw new Error("Invoice not found");
  if(String(status).toUpperCase()!=="OK"){
    await query("UPDATE invoices SET status='failed' WHERE id=$1 AND status='pending'",[inv.id]);
    return {ok:false};
  }
  const r=await fetch(urls.verify,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
    merchant_id:config.zarinpal.merchantId,amount:amount(inv.amount_toman),authority:String(authority)
  })});
  const d=await r.json(),code=Number(d?.data?.code);
  if(!(code===100||code===101))throw new Error(d?.errors?.message||d?.data?.message||"ZarinPal verify failed");
  const activated = await activateInvoice(inv.public_id,String(d?.data?.ref_id||authority),{gateway:"zarinpal",authority,code});
  return {ok:true,...activated,entitlements:await getEntitlements(inv.user_id)};
}
