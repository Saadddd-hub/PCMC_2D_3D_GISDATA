const { chromium } = require('@playwright/test');

async function runAudit() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-webgl', '--use-gl=angle', '--ignore-gpu-blocklist']
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();

  // Track network requests & responses
  const requests = [];
  const responses = {};
  
  page.on('request', req => {
    requests.push({ url: req.url(), time: Date.now() });
  });

  page.on('response', resp => {
    responses[resp.url()] = { time: Date.now(), status: resp.status() };
  });

  // Track long tasks and frame rates
  await page.addInitScript(() => {
    window.__longTasks = [];
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__longTasks.push({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration
          });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch (e) {
      console.warn('Long tasks observer error:', e);
    }

    // FPS counter utility
    window.__fpsData = [];
    let lastTime = performance.now();
    let frameCount = 0;
    window.__startFps = () => {
      window.__fpsData = [];
      frameCount = 0;
      lastTime = performance.now();
      function count() {
        if (!window.__measureFps) return;
        const now = performance.now();
        const delta = now - lastTime;
        if (delta >= 500) {
          const fps = (frameCount * 1000) / delta;
          window.__fpsData.push(fps);
          frameCount = 0;
          lastTime = now;
        }
        frameCount++;
        requestAnimationFrame(count);
      }
      window.__measureFps = true;
      requestAnimationFrame(count);
    };
    window.__stopFps = () => {
      window.__measureFps = false;
      const valid = window.__fpsData.filter(f => f > 0);
      return valid.length ? (valid.reduce((a, b) => a + b, 0) / valid.length) : 0;
    };
  });

  console.log('Navigating to http://localhost:3000...');
  const tStart = Date.now();
  await page.goto('http://localhost:3000', { waitUntil: 'load' });

  // 1. Time to first map canvas paint
  await page.waitForSelector('canvas', { timeout: 30000 });
  const tCanvas = Date.now() - tStart;
  console.log(`First map canvas paint: ${tCanvas} ms`);

  // 2. Time until ward polygons loaded / visible
  // Check responses map for /api/wards
  let wardsRespTime = null;
  const wardsWaitStart = Date.now();
  while (!wardsRespTime && (Date.now() - wardsWaitStart < 20000)) {
    for (const url in responses) {
      if (url.includes('/api/wards') && !url.includes('/api/wards/')) {
        wardsRespTime = responses[url].time - tStart;
        break;
      }
    }
    if (!wardsRespTime) await page.waitForTimeout(100);
  }
  console.log(`Wards API response: ${wardsRespTime} ms`);

  // 3. Time until analytics panel has data
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return text.includes('66') && (text.includes('176.') || text.includes('Wards'));
  }, { timeout: 20000 });
  const tAnalytics = Date.now() - tStart;
  console.log(`Analytics panel has data: ${tAnalytics} ms`);

  // Wait for initial tiles to settle
  await page.waitForTimeout(2000);

  // 4. Measure 2D panning FPS
  console.log('Measuring 2D panning FPS...');
  await page.evaluate(() => window.__startFps());
  const canvasBox = await page.$eval('canvas', el => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

  for (let i = 0; i < 15; i++) {
    await page.mouse.move(canvasBox.x, canvasBox.y);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 80, canvasBox.y + 40, { steps: 5 });
    await page.mouse.move(canvasBox.x - 80, canvasBox.y - 40, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(60);
  }
  const fps2D = await page.evaluate(() => window.__stopFps());
  console.log(`2D Panning FPS: ${fps2D.toFixed(1)}`);

  // 5. Measure 3D toggle & 3D panning FPS
  console.log('Toggling 3D mode...');
  const btn3D = await page.waitForSelector('#btn-toggle-3d, button:has-text("3D")');
  await btn3D.click();
  await page.waitForTimeout(1200);

  console.log('Measuring 3D panning FPS...');
  await page.evaluate(() => window.__startFps());
  for (let i = 0; i < 15; i++) {
    await page.mouse.move(canvasBox.x, canvasBox.y);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 80, canvasBox.y + 40, { steps: 5 });
    await page.mouse.move(canvasBox.x - 80, canvasBox.y - 40, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(60);
  }
  const fps3D = await page.evaluate(() => window.__stopFps());
  console.log(`3D Panning FPS: ${fps3D.toFixed(1)}`);

  // 6. Zoom to 13+ and measure time for buildings to appear
  console.log('Zooming to 13+ for buildings...');
  const tZoomStart = Date.now();
  await page.mouse.move(canvasBox.x, canvasBox.y);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -350);
    await page.waitForTimeout(150);
  }

  // Wait for building layer request to complete
  let bldgsLoadedTime = null;
  const bldgWaitStart = Date.now();
  while (!bldgsLoadedTime && (Date.now() - bldgWaitStart < 15000)) {
    for (const url in responses) {
      if (url.includes('/api/layers/buildings') && responses[url].time >= tZoomStart) {
        bldgsLoadedTime = responses[url].time - tZoomStart;
        break;
      }
    }
    if (!bldgsLoadedTime) await page.waitForTimeout(100);
  }
  console.log(`Time for buildings to appear after zoom 13+: ${bldgsLoadedTime} ms`);

  // 7. Measure requests fired during 5-second pan/zoom
  console.log('Measuring requests fired during 5-second pan/zoom...');
  const reqStartCount = requests.length;
  const panStart = Date.now();
  while (Date.now() - panStart < 5000) {
    await page.mouse.move(canvasBox.x, canvasBox.y);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + 40, canvasBox.y + 25, { steps: 3 });
    await page.mouse.move(canvasBox.x - 40, canvasBox.y - 25, { steps: 3 });
    await page.mouse.up();
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(80);
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(100);
  }
  const reqFired = requests.length - reqStartCount;
  console.log(`Requests fired during 5s pan/zoom: ${reqFired}`);

  // 8. Long tasks > 50ms
  const longTasks = await page.evaluate(() => window.__longTasks || []);
  const longTasksOver50 = longTasks.filter(t => t.duration >= 50);
  console.log(`Total long tasks (>50ms): ${longTasksOver50.length}`);
  const maxLongTask = longTasksOver50.length > 0 ? Math.max(...longTasksOver50.map(t => t.duration)) : 0;
  console.log(`Max long task duration: ${maxLongTask.toFixed(1)} ms`);

  await browser.close();

  return {
    timeToFirstMapPaintMs: tCanvas,
    timeUntilWardPolygonsVisibleMs: wardsRespTime,
    timeUntilAnalyticsHasDataMs: tAnalytics,
    timeForBuildingsAfterZoom13Ms: bldgsLoadedTime,
    requestsFired5sPanZoom: reqFired,
    longTasksOver50msCount: longTasksOver50.length,
    maxLongTaskMs: Number(maxLongTask.toFixed(1)),
    fps2DPanning: Number(fps2D.toFixed(1)),
    fps3DPanning: Number(fps3D.toFixed(1))
  };
}

runAudit()
  .then(res => {
    console.log('\n=== AUDIT RESULTS ===\n', JSON.stringify(res, null, 2));
  })
  .catch(err => {
    console.error('Audit failed:', err);
    process.exit(1);
  });
