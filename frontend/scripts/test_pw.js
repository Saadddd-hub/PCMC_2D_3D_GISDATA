const { chromium } = require('@playwright/test');
console.log('Chromium available:', typeof chromium.launch);
