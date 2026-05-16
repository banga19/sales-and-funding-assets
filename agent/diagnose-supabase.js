const { Pool } = require('pg');

console.log('🔍 Supabase Connection Diagnostics\n');

const connectionString = process.env.DATABASE_URL || 
  'postgresql://postgres.vgkwwnjzxnensaxjxmxk:OCAkXttBzLomJOGQ@aws-0-us-east-1.pooler.supabase.com:6543/postgres';

console.log('Testing different connection configurations...\n');

// Test 1: Transaction Pooler with SSL
async function test1() {
  console.log('Test 1: Transaction Pooler (port 6543) with SSL');
  const pool = new Pool({
    connectionString: connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });
  
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT version()');
    console.log('✅ SUCCESS!');
    console.log('PostgreSQL Version:', result.rows[0].version.substring(0, 50) + '...\n');
    client.release();
    await pool.end();
    return true;
  } catch (error) {
    console.log('❌ FAILED');
    console.log('Error:', error.message);
    console.log('Code:', error.code, '\n');
    await pool.end();
    return false;
  }
}

// Test 2: Session Pooler (port 5432)
async function test2() {
  console.log('Test 2: Session Pooler (port 5432) with SSL');
  const altConnection = connectionString.replace(':6543/', ':5432/');
  const pool = new Pool({
    connectionString: altConnection,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });
  
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT version()');
    console.log('✅ SUCCESS!');
    console.log('PostgreSQL Version:', result.rows[0].version.substring(0, 50) + '...\n');
    client.release();
    await pool.end();
    return true;
  } catch (error) {
    console.log('❌ FAILED');
    console.log('Error:', error.message);
    console.log('Code:', error.code, '\n');
    await pool.end();
    return false;
  }
}

// Test 3: Direct Connection
async function test3() {
  console.log('Test 3: Direct Connection (db.*.supabase.co:5432)');
  const directConnection = connectionString
    .replace('postgres.vgkwwnjzxnensaxjxmxk', 'postgres')
    .replace('aws-0-us-east-1.pooler.supabase.com', 'db.vgkwwnjzxnensaxjxmxk.supabase.co')
    .replace(':6543/', ':5432/');
  
  const pool = new Pool({
    connectionString: directConnection,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });
  
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT version()');
    console.log('✅ SUCCESS!');
    console.log('PostgreSQL Version:', result.rows[0].version.substring(0, 50) + '...\n');
    client.release();
    await pool.end();
    return true;
  } catch (error) {
    console.log('❌ FAILED');
    console.log('Error:', error.message);
    console.log('Code:', error.code, '\n');
    await pool.end();
    return false;
  }
}

// Run all tests
async function runDiagnostics() {
  const test1Result = await test1();
  if (test1Result) {
    console.log('✅ Your current connection string works! Update .env if needed.');
    process.exit(0);
  }
  
  const test2Result = await test2();
  if (test2Result) {
    console.log('✅ Session pooler works! Update your .env to use port 5432:');
    console.log('DATABASE_URL=' + connectionString.replace(':6543/', ':5432/'));
    process.exit(0);
  }
  
  const test3Result = await test3();
  if (test3Result) {
    console.log('✅ Direct connection works! Update your .env to:');
    const directConnection = connectionString
      .replace('postgres.vgkwwnjzxnensaxjxmxk', 'postgres')
      .replace('aws-0-us-east-1.pooler.supabase.com', 'db.vgkwwnjzxnensaxjxmxk.supabase.co')
      .replace(':6543/', ':5432/');
    console.log('DATABASE_URL=' + directConnection);
    process.exit(0);
  }
  
  console.log('\n❌ All connection methods failed!');
  console.log('\n🔧 Next Steps:');
  console.log('1. Verify your Supabase project reference: vgkwwnjzxnensaxjxmxk');
  console.log('2. Go to Supabase Dashboard → Settings → Database');
  console.log('3. Copy the EXACT connection string from there');
  console.log('4. Make sure you\'re using the password you just reset');
  console.log('5. Check if there are IP restrictions in Supabase');
  console.log('6. Verify your project is in us-east-1 region');
  process.exit(1);
}

runDiagnostics();

// Made with Bob
