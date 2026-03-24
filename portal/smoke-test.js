const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/schedule',
  method: 'GET',
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Status Code:', res.statusCode);
    if (data.includes('MobileNav')) console.log('Found MobileNav in source');
    if (data.includes('Next Payment')) console.log('Found Next Payment in source');
    if (data.includes('bottom-0')) console.log('Found fixed bottom nav styling');
    process.exit(0);
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
  process.exit(1);
});

req.end();
