require('dotenv').config();
const { Pool } = require('pg');

// Test different connection configurations
async function testConnection() {
  console.log('🔍 Testing Database Connection...\n');
  
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    console.error('❌ DATABASE_URL not found in environment variables');
    console.error('Make sure .env file exists and contains DATABASE_URL');
    process.exit(1);
  }
  
  console.log('Connection String:', connectionString.replace(/:[^:@]+@/, ':****@'));
  console.log('');
  
  // Test 1: Basic connection
  console.log('Test 1: Basic Connection Test');
  const pool = new Pool({
    connectionString: connectionString,
    ssl: {
      rejectUnauthorized: false
    },
    connectionTimeoutMillis: 10000,
  });
  
  try {
    const client = await pool.connect();
    console.log('✅ Connection successful!');
    
    // Test query
    const result = await client.query('SELECT version()');
    console.log('✅ Query successful!');
    console.log('PostgreSQL Version:', result.rows[0].version.substring(0, 50) + '...');
    
    client.release();
    await pool.end();
    
    console.log('\n✅ All tests passed! Database connection is working.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Connection failed!');
    console.error('Error Code:', error.code);
    console.error('Error Message:', error.message);
    console.error('Error Details:', error);
    
    await pool.end();
    
    console.log('\n🔧 Troubleshooting suggestions:');
    console.log('1. Verify your Supabase password is correct');
    console.log('2. Check if your IP is allowed in Supabase (Database Settings → Network Restrictions)');
    console.log('3. Ensure you\'re using the Transaction pooler connection string (port 6543)');
    console.log('4. Try resetting your database password in Supabase Dashboard');
    console.log('5. Check if SSL is required (Supabase requires SSL)');
    
    process.exit(1);
  }
}

testConnection();

// Made with Bob
