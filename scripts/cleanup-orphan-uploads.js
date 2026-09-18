require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool, assertDatabaseReady, close } = require('../db');

const ROOT = path.join(__dirname,'..');
const DIRS = [
  {path:path.join(ROOT,'uploads','tickets'), prefix:'/uploads/tickets/'},
  {path:path.join(ROOT,'uploads','resolutions'), prefix:'/uploads/resolutions/'}
];
const MIN_AGE_HOURS = Number(process.env.ORPHAN_MIN_AGE_HOURS || 24);

(async()=>{
  try{
    await assertDatabaseReady();
    const [rows]=await pool.query('SELECT url FROM ticket_evidence');
    const referenced=new Set(rows.map(r=>String(r.url||'')));
    const cutoff=Date.now()-MIN_AGE_HOURS*3600*1000;
    let checked=0,deleted=0,freed=0;
    for(const d of DIRS){
      if(!fs.existsSync(d.path))continue;
      for(const name of fs.readdirSync(d.path)){
        if(name==='.gitkeep')continue;
        const full=path.join(d.path,name);const st=fs.statSync(full);if(!st.isFile())continue;checked++;
        const url=d.prefix+name;
        if(!referenced.has(url)&&st.mtimeMs<cutoff){freed+=st.size;fs.unlinkSync(full);deleted++;}
      }
    }
    console.log(`Checked: ${checked} file`);
    console.log(`Deleted orphan: ${deleted} file`);
    console.log(`Freed: ${(freed/1024/1024).toFixed(2)} MB`);
    await close();
  }catch(err){console.error(err);try{await close();}catch(_){}process.exit(1);}
})();
