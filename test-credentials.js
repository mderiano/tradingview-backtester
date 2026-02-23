#!/usr/bin/env node
/**
 * Test script to debug TradingView credential issues
 * 
 * Usage: 
 *   node test-credentials.js <session> <signature>
 * 
 * Or set environment variables:
 *   SESSION=xxx SIGNATURE=xxx node test-credentials.js
 */

const https = require('https');

// Get credentials from args or environment
const session = process.argv[2] || process.env.SESSION;
const signature = process.argv[3] || process.env.SIGNATURE;

if (!session) {
    console.log('❌ Missing session! Usage: node test-credentials.js <session> <signature>');
    console.log('   Or set SESSION and SIGNATURE environment variables');
    process.exit(1);
}

console.log('🔍 Testing TradingView credentials...');
console.log(`   Session: ${session.substring(0, 10)}...${session.substring(session.length - 5)}`);
console.log(`   Signature: ${signature ? signature.substring(0, 10) + '...' : 'NONE'}`);
console.log('');

function testGetUser(location = 'https://www.tradingview.com/') {
    return new Promise((resolve, reject) => {
        const cookieHeader = `sessionid=${session}${signature ? `;sessionid_sign=${signature};` : ''}`;
        
        console.log(`📡 Requesting: ${location}`);
        console.log(`   Cookie: ${cookieHeader.substring(0, 50)}...`);
        
        https.get(location, {
            headers: { 
                cookie: cookieHeader,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
        }, (res) => {
            console.log(`   Status: ${res.statusCode}`);
            console.log(`   Headers: ${JSON.stringify(res.headers).substring(0, 200)}...`);
            
            // Check for redirect
            if (res.headers.location) {
                console.log(`   ➡️  Redirecting to: ${res.headers.location}`);
            }
            
            let rs = '';
            res.on('data', (d) => { rs += d; });
            res.on('end', async () => {
                console.log(`   Response size: ${rs.length} bytes`);
                
                // Check for auth_token
                const hasAuthToken = rs.includes('auth_token');
                console.log(`   Contains auth_token: ${hasAuthToken}`);
                
                // Try to extract auth_token
                const authTokenMatch = /"auth_token":"(.*?)"/.exec(rs);
                if (authTokenMatch) {
                    console.log(`   ✅ auth_token found: ${authTokenMatch[1].substring(0, 20)}...`);
                }
                
                // Check for username
                const usernameMatch = /"username":"(.*?)"/.exec(rs);
                if (usernameMatch) {
                    console.log(`   ✅ username found: ${usernameMatch[1]}`);
                }
                
                // Look for error indicators
                if (rs.includes('login') && rs.includes('sign')) {
                    console.log(`   ⚠️  Response seems to be a login page (not authenticated)`);
                }
                
                // Check for different page patterns
                if (rs.includes('"is_pro":true') || rs.includes('"is_pro":false')) {
                    console.log(`   ✅ User data found in page`);
                }
                
                // Check for window.__initialUserData or similar
                const initDataMatch = /window\.__initialUserData\s*=\s*(\{.*?\});/s.exec(rs);
                if (initDataMatch) {
                    console.log(`   ✅ Found window.__initialUserData`);
                }
                
                // Look for other auth patterns TradingView might use
                const patterns = [
                    { name: 'session_hash', regex: /"session_hash":"(.*?)"/ },
                    { name: 'private_channel', regex: /"private_channel":"(.*?)"/ },
                    { name: 'id', regex: /"id":([0-9]{1,10}),/ },
                    { name: 'user object', regex: /"user":\s*\{/ },
                ];
                
                console.log('\n   🔎 Checking for auth patterns:');
                patterns.forEach(p => {
                    const match = p.regex.exec(rs);
                    console.log(`      ${p.name}: ${match ? '✅ Found' : '❌ Not found'}`);
                });
                
                // If redirect, follow it
                if (res.headers.location && location !== res.headers.location) {
                    console.log('\n   Following redirect...\n');
                    try {
                        await testGetUser(res.headers.location);
                    } catch (e) {
                        reject(e);
                    }
                } else if (!hasAuthToken) {
                    // Save response for debugging
                    const fs = require('fs');
                    const debugFile = '/tmp/tv-response.html';
                    fs.writeFileSync(debugFile, rs);
                    console.log(`\n   📝 Response saved to ${debugFile} for debugging`);
                    
                    // Show a snippet of the response
                    console.log('\n   📄 Response snippet (first 500 chars):');
                    console.log('   ' + rs.substring(0, 500).replace(/\n/g, '\n   '));
                }
                
                resolve({ hasAuthToken, response: rs });
            });

            res.on('error', (e) => {
                console.log(`   ❌ Response error: ${e.message}`);
                reject(e);
            });
        }).on('error', (e) => {
            console.log(`   ❌ Request error: ${e.message}`);
            reject(e);
        }).end();
    });
}

// Run the test
testGetUser()
    .then(result => {
        console.log('\n========================================');
        if (result.hasAuthToken) {
            console.log('✅ Credentials appear to be VALID');
        } else {
            console.log('❌ Credentials appear to be INVALID or EXPIRED');
            console.log('\nPossible solutions:');
            console.log('1. Re-sync credentials from Chrome Extension');
            console.log('2. Log out and log back into TradingView');
            console.log('3. Clear TradingView cookies and re-authenticate');
            console.log('4. TradingView may have changed their page structure');
        }
    })
    .catch(err => {
        console.error(`\n❌ Test failed: ${err.message}`);
    });
