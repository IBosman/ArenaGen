// Quick test script to verify proxy functionality

import http from 'http';

const PROXY_URL = 'http://localhost:3000';

async function testProxy() {
  console.log('🧪 Testing Proxy Server...\n');
  
  return new Promise((resolve, reject) => {
    const req = http.get(PROXY_URL, (res) => {
      console.log('✅ Status Code:', res.statusCode);
      console.log('📋 Headers:', JSON.stringify(res.headers, null, 2));
      
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log('\n📊 Response length:', data.length, 'bytes');
        
        // Check if rebranding is working
        const hasOldBrand = data.includes('HeyGen');
        const hasNewBrand = data.includes('VideoAI Pro');
        
        console.log('\n🔍 Rebranding Check:');
        console.log('  - Contains "HeyGen":', hasOldBrand ? '❌ (should be replaced)' : '✅');
        console.log('  - Contains "VideoAI Pro":', hasNewBrand ? '✅' : '❌ (should be present)');
        
        // Check for injected code
        const hasCustomScript = data.includes('custom-rebrand-script');
        const hasCustomStyles = data.includes('custom-rebrand-styles');
        
        console.log('\n💉 Injection Check:');
        console.log('  - Custom script injected:', hasCustomScript ? '✅' : '❌');
        console.log('  - Custom styles injected:', hasCustomStyles ? '✅' : '❌');
        
        if (res.statusCode === 200 && hasNewBrand && hasCustomScript) {
          console.log('\n✅ Proxy is working correctly!');
          resolve(true);
        } else {
          console.log('\n⚠️  Proxy may not be working as expected');
          resolve(false);
        }
      });
    });
    
    req.on('error', (error) => {
      console.error('❌ Error:', error.message);
      console.log('\n💡 Make sure the proxy server is running:');
      console.log('   npm run proxy');
      reject(error);
    });
    
    req.setTimeout(10000, () => {
      console.error('❌ Request timeout');
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

// Run test
testProxy().catch(console.error);
