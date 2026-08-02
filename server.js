const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const cronHandler = require('./api/cron');
const statusHandler = require('./api/status');
const testNotificationsHandler = require('./api/test-notifications');

const app = express();
const PORT = process.env.PORT || 5003;
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Express route bridges for local testing
app.get('/api/cron', cronHandler);
app.get('/api/status', statusHandler);
app.post('/api/test-notifications', testNotificationsHandler);

// Trigger local background interval for testing if run as node server.js
if (process.env.NODE_ENV !== 'production') {
  console.log('[Local Dev] Scheduling local 5-minute background check...');
  setInterval(() => {
    console.log('[Local Dev] Executing cron scan...');
    const req = {};
    const res = {
      status: () => res,
      json: (data) => console.log('[Local Dev Cron Result]:', data.success, `(Found ${data.extractedCount} links)`)
    };
    cronHandler(req, res).catch(e => console.error('[Local Dev Cron Error]:', e));
  }, 5 * 60 * 1000);
}

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(` ResultWatcher Vercel Server running at http://localhost:${PORT}`);
  console.log(` Vercel Cron Endpoint: http://localhost:${PORT}/api/cron`);
  console.log(` Monitoring Target: https://mbmiums.in/Results/ExamResultDeclare.aspx`);
  console.log(` Engine: @sparticuz/chromium + puppeteer-core (Vercel Serverless)`);
  console.log(` Notifications: Mail Hook (Nodemailer), Telegram & Discord`);
  console.log(`====================================================`);
});
