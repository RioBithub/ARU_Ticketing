require('dotenv').config();
const { pool, assertDatabaseReady, close, config } = require('../db');

(async()=>{
  try{
    await assertDatabaseReady();
    const [v] = await pool.query('SELECT VERSION() AS version');
    const [meta] = await pool.query("SELECT meta_value FROM app_meta WHERE meta_key='schema_version' LIMIT 1");
    console.log('MySQL connection: OK');
    console.log(`Host: ${config.host}:${config.port}`);
    console.log(`Database: ${config.database}`);
    console.log(`Server version: ${v[0].version}`);
    console.log(`Schema version: ${meta[0]?.meta_value || 'unknown'}`);
    await close();
  }catch(err){
    console.error('MySQL connection/schema test FAILED');
    console.error(err.message);
    try{await close();}catch(_){ }
    process.exit(1);
  }
})();
