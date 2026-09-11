
import {query} from "../db/db.js";
export async function getPreference(userId,siteId,platform){
  const r=await query("SELECT enabled,field_keys FROM publication_preferences WHERE user_id=$1 AND site_id=$2 AND platform=$3",[userId,siteId,platform]);
  if(!r.rowCount)return null;
  return {enabled:r.rows[0].enabled,field_keys:Array.isArray(r.rows[0].field_keys)?r.rows[0].field_keys:[]};
}
export async function savePreference(userId,siteId,platform,enabled,keys){
  return (await query(`INSERT INTO publication_preferences(user_id,site_id,platform,enabled,field_keys)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(user_id,site_id,platform) DO UPDATE SET enabled=EXCLUDED.enabled,field_keys=EXCLUDED.field_keys,updated_at=NOW()
    RETURNING *`,[userId,siteId,platform,Boolean(enabled),JSON.stringify(Array.isArray(keys)?keys:[])])).rows[0];
}
