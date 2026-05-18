const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Users\\LapTop\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe',
    args: ['--no-sandbox', '--ignore-certificate-errors', '--disable-web-security', '--disable-features=IsolateOrigins,site-per-process']
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  const spuListResponses = [];
  page.on('response', async (res) => {
    const u = res.url();
    if (u.includes('getSpuList') && !u.match(/\.(js|css|png|jpg|ico|gif|svg|woff)(\?.*)?$/i)) {
      try { spuListResponses.push(await res.json()); } catch(e) {}
    }
  });

  await page.goto('https://sokogate.com', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(25000); // wait for Vue mount + getSpuList calls

  // Extract all rows from responses
  let allRows = [];
  for (const resp of spuListResponses) {
    const rows = resp.data?.rows || [];
    console.log(`Response errcode=${resp.errcode}, rows=${rows.length}`);
    allRows.push(...rows);
  }
  console.log('Total SPU rows caught:', allRows.length);

  // Deduplicate by id
  const spuMap = new Map();
  for (const r of allRows) {
    if (!r.id) continue;
    if (!spuMap.has(r.id)) spuMap.set(r.id, r);
  }
  const uniqueSpus = [...spuMap.values()];
  console.log('Unique SPUs:', uniqueSpus.length);

  if (uniqueSpus.length > 0) {
    console.log('First row keys:', Object.keys(uniqueSpus[0]).join(', '));
    console.log('First row:', JSON.stringify(uniqueSpus[0]).substring(0, 400));

    // Save to temp file for inspection
    const fs = require('fs');
    fs.writeFileSync('C:\\Users\\LapTop\\AppData\\Local\\Temp\\kilo\\spu_rows.json', JSON.stringify(uniqueSpus.slice(0, 5), null, 2));
    console.log('Saved 5 SPU rows to spu_rows.json');
  } else {
    console.log('Last 3 responses:', spuListResponses.slice(-3).map(r => ({ errcode: r.errcode, errmsg: r.errmsg, hasRows: !!r.data?.rows })));
  }

  await context.close(); await browser.close();
  console.log('Done');
})();
