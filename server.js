const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const axios = require('axios');
const cheerio = require('cheerio');
require('dotenv').config();

const { sendTwilioSms, sendTestTwilioSms, DEFAULT_FROM, DEFAULT_TO } = require('./utils/twilio');

const app = express();
const PORT = process.env.PORT || 5003;
const CONFIG_FILE = path.join(__dirname, 'watcher_config.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Watcher Persistent State
let watcherState = {
  isPaused: false,
  intervalMinutes: 5,
  timerId: null,
  lastCheckTime: null,
  nextCheckTime: null,
  isScanning: false,
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    fromNumber: process.env.TWILIO_FROM_NUMBER || DEFAULT_FROM,
    toNumber: process.env.TWILIO_TO_NUMBER || DEFAULT_TO
  },
  knownResults: {},
  activeAlerts: [],
  logs: []
};

function addLog(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  const entry = { timestamp, message, type };
  watcherState.logs.unshift(entry);
  if (watcherState.logs.length > 100) watcherState.logs.pop();
  console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
}

// Load Persistent State from File
function loadPersistentState() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      watcherState.isPaused = data.isPaused ?? false;
      watcherState.intervalMinutes = data.intervalMinutes || 5;
      watcherState.knownResults = data.knownResults || {};
      watcherState.activeAlerts = data.activeAlerts || [];
      if (data.twilio) {
        watcherState.twilio = { ...watcherState.twilio, ...data.twilio };
      }
      addLog(`Loaded state: ${Object.keys(watcherState.knownResults).length} known results. Watcher is ${watcherState.isPaused ? 'PAUSED' : 'RUNNING'}.`, 'info');
    } else {
      addLog('Initialized new watcher state.', 'info');
    }
  } catch (err) {
    addLog(`Error loading persistent state: ${err.message}`, 'error');
  }
}

// Save Persistent State to File
function savePersistentState() {
  try {
    const data = {
      isPaused: watcherState.isPaused,
      intervalMinutes: watcherState.intervalMinutes,
      twilio: watcherState.twilio,
      knownResults: watcherState.knownResults,
      activeAlerts: watcherState.activeAlerts,
      lastSaved: new Date().toISOString()
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    addLog(`Error saving persistent state: ${err.message}`, 'error');
  }
}

// Resolve Chromium executable for Puppeteer
async function getExecutablePath() {
  if (process.platform === 'win32') {
    const winPaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (const p of winPaths) {
      if (p && fs.existsSync(p)) return p;
    }
  }
  return null;
}

// Core Scraper: Navigates to ExamResultDeclare.aspx, clicks LinkButton8, extracts branch results
async function performScan() {
  if (watcherState.isPaused) {
    addLog('Watcher is PAUSED. Scan skipped.', 'info');
    return;
  }

  if (watcherState.isScanning) {
    addLog('Scan already in progress. Skipping...', 'info');
    return;
  }

  watcherState.isScanning = true;
  watcherState.lastCheckTime = new Date().toISOString();
  const intervalMs = watcherState.intervalMinutes * 60 * 1000;
  watcherState.nextCheckTime = new Date(Date.now() + intervalMs).toISOString();

  addLog('Starting background result scan on mbmiums.in...', 'info');
  const declareUrl = 'https://mbmiums.in/Results/ExamResultDeclare.aspx';
  let rawItems = [];
  let browser = null;

  try {
    const execPath = await getExecutablePath();
    browser = await puppeteer.launch({
      headless: true,
      executablePath: execPath || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(25000);

    await page.goto(declareUrl, { waitUntil: 'networkidle2' });

    // Click (II)Odd Semester Examination Results 2025-26 (LinkButton8)
    const clickResult = await page.evaluate(() => {
      const link = document.querySelector('#LinkButton8') || 
                   Array.from(document.querySelectorAll('a')).find(a => a.textContent.includes('Odd Semester Examination Results 2025-26'));
      if (link) {
        link.click();
        return { clicked: true, text: link.textContent.trim() };
      }
      return { clicked: false };
    });

    if (clickResult.clicked) {
      addLog(`Clicked "${clickResult.text}". Waiting for UpdatePanel render...`, 'success');
      await new Promise(r => setTimeout(r, 3000));
      await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
    }

    // Extract all result links
    rawItems = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a'))
        .map(l => ({
          title: l.textContent.replace(/\s+/g, ' ').trim(),
          href: l.href || '#',
          id: l.id || null
        }))
        .filter(l => l.title.length > 3 && !l.title.toLowerCase().includes('home') && l.title.toUpperCase() !== 'BACK');
    });

    addLog(`Extracted ${rawItems.length} result links from portal.`, 'success');

  } catch (err) {
    addLog(`Scraper error: ${err.message}. Using HTTP fallback...`, 'warning');
    try {
      const res = await axios.get(declareUrl, { timeout: 10000 });
      const $ = cheerio.load(res.data);
      $('a').each((i, el) => {
        const title = $(el).text().trim();
        const href = $(el).attr('href') || '#';
        const id = $(el).attr('id') || null;
        if (title.length > 3) rawItems.push({ title, href, id });
      });
    } catch (e) {}
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  // Compare against Snapshot
  const isFirstRun = Object.keys(watcherState.knownResults).length === 0;
  const newResults = [];

  for (const item of rawItems) {
    const key = (item.id ? item.id + '_' : '') + item.title.toLowerCase();
    if (!watcherState.knownResults[key]) {
      watcherState.knownResults[key] = {
        key,
        title: item.title,
        href: item.href,
        discoveredAt: new Date().toISOString()
      };

      if (!isFirstRun) {
        newResults.push({ title: item.title, href: item.href, key });
      }
    }
  }

  if (isFirstRun) {
    addLog(`Baseline snapshot created with ${rawItems.length} published results.`, 'success');
  } else if (newResults.length > 0) {
    addLog(`🚨 ALARM TRIGGERED! ${newResults.length} NEW RESULT(S) DISCOVERED!`, 'alert');
    
    newResults.forEach(r => {
      watcherState.activeAlerts.unshift({
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 4),
        title: r.title,
        href: r.href,
        timestamp: new Date().toISOString()
      });
    });

    // Send Twilio SMS Alert
    addLog('Dispatching Twilio SMS alert...', 'info');
    await sendTwilioSms(newResults, watcherState.twilio);
  } else {
    addLog(`Scan complete. No new results detected (${rawItems.length} links checked).`, 'info');
  }

  savePersistentState();
  watcherState.isScanning = false;
}

// Start Background 5-Minute Timer Loop
function startBackgroundTimer() {
  if (watcherState.timerId) clearInterval(watcherState.timerId);
  performScan();
  const ms = watcherState.intervalMinutes * 60 * 1000;
  watcherState.timerId = setInterval(() => {
    performScan();
  }, ms);
}

// API Routes
app.get('/api/watcher/status', (req, res) => {
  const formattedList = Object.values(watcherState.knownResults);
  res.json({
    isPaused: watcherState.isPaused,
    intervalMinutes: watcherState.intervalMinutes,
    lastCheckTime: watcherState.lastCheckTime,
    nextCheckTime: watcherState.nextCheckTime,
    isScanning: watcherState.isScanning,
    knownCount: formattedList.length,
    knownResultsList: formattedList,
    activeAlerts: watcherState.activeAlerts,
    twilio: {
      accountSid: watcherState.twilio.accountSid,
      fromNumber: watcherState.twilio.fromNumber,
      toNumber: watcherState.twilio.toNumber,
      hasToken: !!watcherState.twilio.authToken
    },
    logs: watcherState.logs.slice(0, 30)
  });
});

app.post('/api/watcher/toggle-pause', (req, res) => {
  watcherState.isPaused = !watcherState.isPaused;
  savePersistentState();
  addLog(`Watcher state changed: ${watcherState.isPaused ? 'PAUSED ⏸️' : 'RUNNING 🟢'}`, 'success');
  if (!watcherState.isPaused) {
    performScan();
  }
  res.json({ success: true, isPaused: watcherState.isPaused });
});

app.post('/api/watcher/twilio-config', (req, res) => {
  const { accountSid, authToken, fromNumber, toNumber } = req.body;
  if (accountSid) watcherState.twilio.accountSid = accountSid.trim();
  if (authToken) watcherState.twilio.authToken = authToken.trim();
  if (fromNumber) watcherState.twilio.fromNumber = fromNumber.trim();
  if (toNumber) watcherState.twilio.toNumber = toNumber.trim();

  savePersistentState();
  addLog('Twilio SMS configuration updated.', 'success');
  res.json({ success: true, message: 'Twilio settings saved' });
});

app.post('/api/watcher/test-twilio', async (req, res) => {
  const { authToken } = req.body;
  if (authToken) watcherState.twilio.authToken = authToken.trim();

  addLog('Sending test Twilio SMS...', 'info');
  const result = await sendTestTwilioSms(watcherState.twilio);
  if (result.success) {
    addLog(`Test SMS delivered to ${watcherState.twilio.toNumber}! (SID: ${result.sid})`, 'success');
  } else {
    addLog(`Test SMS error: ${result.error}`, 'error');
  }
  res.json(result);
});

app.post('/api/watcher/check-now', async (req, res) => {
  addLog('Manual scan requested by user.', 'info');
  performScan();
  res.json({ success: true, message: 'Manual scan triggered' });
});

app.post('/api/watcher/clear-alerts', (req, res) => {
  watcherState.activeAlerts = [];
  savePersistentState();
  addLog('Active alerts cleared.', 'info');
  res.json({ success: true, message: 'Alerts cleared' });
});

app.get('/api/cron', async (req, res) => {
  addLog('Cron endpoint pinged.', 'info');
  await performScan();
  const list = Object.values(watcherState.knownResults);
  res.json({
    success: true,
    extractedCount: list.length,
    knownResultsList: list
  });
});

// Initialize
loadPersistentState();
startBackgroundTimer();

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` ResultWatcher Server running on http://localhost:${PORT}`);
  console.log(` Target: https://mbmiums.in/Results/ExamResultDeclare.aspx`);
  console.log(` 5-Min Background Watcher: ${watcherState.isPaused ? 'PAUSED ⏸️' : 'RUNNING 🟢'}`);
  console.log(` Twilio Target Number: ${watcherState.twilio.toNumber}`);
  console.log(`====================================================`);
});
