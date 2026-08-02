// ResultWatcher Client Application Engine
document.addEventListener('DOMContentLoaded', () => {

  let audioContext = null;
  let alarmIntervalId = null;
  let isSoundSilenced = false;
  let currentState = null;
  let countdownSeconds = 300; // 5 Minutes

  // DOM Elements
  const btnPauseResume = document.getElementById('btn-pause-resume');
  const btnCheckNow = document.getElementById('btn-check-now');
  const btnSendTestSms = document.getElementById('btn-send-test-sms');
  const btnTestSound = document.getElementById('btn-test-sound');
  const btnSilenceAlarm = document.getElementById('btn-silence-alarm');
  const btnClearAlarm = document.getElementById('btn-clear-alarm');
  const alarmBanner = document.getElementById('alarm-banner');
  const alarmDetailsText = document.getElementById('alarm-details-text');

  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const statKnownCount = document.getElementById('stat-known-count');
  const statTimerCountdown = document.getElementById('stat-timer-countdown');
  const statAlertsCount = document.getElementById('stat-alerts-count');
  const resultsTableBody = document.getElementById('results-table-body');
  const logsConsole = document.getElementById('logs-console');
  const tableSearchInput = document.getElementById('table-search-input');

  // Live 5-Minute Countdown Timer Loop
  setInterval(() => {
    countdownSeconds--;
    if (countdownSeconds <= 0) {
      countdownSeconds = 300;
      addLog('5-Minute Timer triggered auto-scan...', 'info');
      triggerScan();
    }

    const mins = String(Math.floor(countdownSeconds / 60)).padStart(2, '0');
    const secs = String(countdownSeconds % 60).padStart(2, '0');
    if (statTimerCountdown && statTimerCountdown.textContent !== 'PAUSED') {
      statTimerCountdown.textContent = `${mins}:${secs}`;
    }
  }, 1000);

  // LocalStorage Caching for Extracted Result Links
  function getCachedResults() {
    try {
      const cached = localStorage.getItem('rw_cached_results');
      if (cached) return JSON.parse(cached);
    } catch (e) {}
    return [];
  }

  function saveCachedResults(list) {
    if (list && list.length > 0) {
      try {
        localStorage.setItem('rw_cached_results', JSON.stringify(list));
      } catch (e) {}
    }
  }

  // Web Audio Alarm Synthesizer
  function initAudioContext() {
    if (!audioContext) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioCtx();
    }
  }

  function playChimeNote(freq, duration = 0.25, delay = 0) {
    try {
      initAudioContext();
      if (audioContext.state === 'suspended') audioContext.resume();

      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioContext.currentTime + delay);
      gain.gain.setValueAtTime(0.3, audioContext.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + delay + duration);

      osc.connect(gain);
      gain.connect(audioContext.destination);

      osc.start(audioContext.currentTime + delay);
      osc.stop(audioContext.currentTime + delay + duration);
    } catch (e) {}
  }

  function playAlarmSequence() {
    if (isSoundSilenced) return;
    playChimeNote(659.25, 0.2, 0);     // E5
    playChimeNote(783.99, 0.2, 0.15);  // G5
    playChimeNote(987.77, 0.2, 0.30);  // B5
    playChimeNote(1318.51, 0.4, 0.45); // E6
  }

  // Add Log Entry
  function addLog(msg, type = 'info') {
    const time = new Date().toLocaleTimeString();
    let logClass = 'log-info';
    if (type === 'alert') logClass = 'log-alert';
    else if (type === 'success') logClass = 'log-success';
    else if (type === 'warning') logClass = 'log-warning';
    else if (type === 'error') logClass = 'log-error';

    const div = document.createElement('div');
    div.className = `log-entry ${logClass}`;
    div.textContent = `[${time}] ${msg}`;
    logsConsole.insertBefore(div, logsConsole.firstChild);
  }

  // Trigger Scan Function
  async function triggerScan() {
    try {
      let res = await fetch('/api/cron');
      if (!res.ok) {
        res = await fetch('/api/watcher/check-now', { method: 'POST' });
      }
      const data = await res.json();
      if (data.success) {
        addLog(`Scan completed! Extracted ${data.extractedCount || data.knownCount || 0} links.`, 'success');
        if (data.knownResultsList && data.knownResultsList.length > 0) {
          saveCachedResults(data.knownResultsList);
          renderResultsTable(data.knownResultsList);
          statKnownCount.textContent = data.knownResultsList.length;
        }
        if (data.logs) renderLogs(data.logs);
      } else {
        addLog(`Scan error: ${data.error || data.message}`, 'error');
      }
    } catch (e) {
      addLog(`Scan error: ${e.message}`, 'error');
    }
  }

  // Fetch status from server
  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      currentState = data;

      if (data.knownResultsList && data.knownResultsList.length > 0) {
        saveCachedResults(data.knownResultsList);
      }

      renderUI(data);
    } catch (err) {
      console.warn('Status fetch error:', err.message);
      renderUI({ knownCount: getCachedResults().length });
    }
  }

  function renderUI(data) {
    if (data.isPaused) {
      if (statusBadge) {
        statusBadge.className = 'status-badge status-offline';
        statusText.textContent = 'Watcher PAUSED';
      }
      if (btnPauseResume) {
        btnPauseResume.className = 'btn btn-lg btn-danger btn-block';
        btnPauseResume.innerHTML = '<i class="fa-solid fa-play"></i> RESUME AUTO WATCHER';
      }
      if (statTimerCountdown) {
        statTimerCountdown.textContent = 'PAUSED';
        statTimerCountdown.className = 'stat-value text-amber';
      }
    } else {
      if (statusBadge) {
        statusBadge.className = 'status-badge status-online';
        statusText.textContent = data.isScanning ? 'Scanning Portal...' : 'Auto Watcher Active';
      }
      if (btnPauseResume) {
        btnPauseResume.className = 'btn btn-lg btn-success btn-block';
        btnPauseResume.innerHTML = '<i class="fa-solid fa-pause"></i> PAUSE AUTO WATCHER';
      }
      if (statTimerCountdown && statTimerCountdown.textContent === 'PAUSED') {
        statTimerCountdown.className = 'stat-value text-green';
      }
    }

    const items = (data.knownResultsList && data.knownResultsList.length > 0) ? data.knownResultsList : getCachedResults();
    if (statKnownCount) statKnownCount.textContent = items.length || 0;
    if (statAlertsCount) statAlertsCount.textContent = data.activeAlerts ? data.activeAlerts.length : 0;

    if (data.activeAlerts && data.activeAlerts.length > 0) {
      if (alarmBanner) alarmBanner.classList.remove('hidden');
      if (alarmDetailsText) alarmDetailsText.textContent = `Latest result: "${data.activeAlerts[0].title}"`;
      if (!alarmIntervalId) {
        playAlarmSequence();
        alarmIntervalId = setInterval(playAlarmSequence, 3000);
      }
    } else {
      if (alarmBanner) alarmBanner.classList.add('hidden');
      if (alarmIntervalId) {
        clearInterval(alarmIntervalId);
        alarmIntervalId = null;
      }
    }

    renderResultsTable(items);
    if (data.logs) renderLogs(data.logs);
  }

  function renderResultsTable(items) {
    const term = tableSearchInput ? tableSearchInput.value.toLowerCase().trim() : '';
    let raw = (items && items.length > 0) ? items : getCachedResults();
    let filtered = raw.map(i => ({
      title: i.title || i.text || 'Result Link',
      href: i.href || '#'
    }));

    if (term) {
      filtered = filtered.filter(i => (i.title || '').toLowerCase().includes(term));
    }

    if (filtered.length === 0) {
      resultsTableBody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">No published result links loaded. Click "Check Portal Right Now" above.</td></tr>`;
      return;
    }

    resultsTableBody.innerHTML = filtered.map(item => `
      <tr>
        <td><strong>${escapeHtml(item.title)}</strong></td>
        <td><span class="badge-exam badge-normal">Normal</span></td>
        <td>
          <a href="${escapeHtml(item.href)}" target="_blank" class="btn btn-xs btn-secondary">
            Open <i class="fa-solid fa-up-right-from-square"></i>
          </a>
        </td>
      </tr>
    `).join('');
  }

  function renderLogs(logs) {
    if (!logs || logs.length === 0) return;
    logsConsole.innerHTML = logs.map(l => {
      let logClass = 'log-info';
      if (l.type === 'alert') logClass = 'log-alert';
      else if (l.type === 'warning') logClass = 'log-warning';
      else if (l.type === 'error') logClass = 'log-error';
      else if (l.type === 'success') logClass = 'log-success';

      return `<div class="log-entry ${logClass}">[${l.timestamp}] ${escapeHtml(l.message)}</div>`;
    }).join('');
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
  }

  // Event Handlers
  if (btnSendTestSms) {
    btnSendTestSms.addEventListener('click', async () => {
      btnSendTestSms.disabled = true;
      btnSendTestSms.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending Test SMS...';
      addLog('Sending test Twilio SMS alert...', 'info');

      try {
        let res = await fetch('/api/test-notifications', { method: 'POST' });
        if (!res.ok) {
          res = await fetch('/api/watcher/test-twilio', { method: 'POST' });
        }
        const data = await res.json();
        if (data.success) {
          addLog(`📱 Test SMS sent to +916367468738! (SID: ${data.sid})`, 'success');
        } else {
          addLog(`Twilio SMS test error: ${data.error || data.message}`, 'error');
        }
      } catch (e) {
        addLog(`Test SMS request failed: ${e.message}`, 'error');
      } finally {
        btnSendTestSms.disabled = false;
        btnSendTestSms.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Test Twilio SMS';
      }
    });
  }

  if (btnCheckNow) {
    btnCheckNow.addEventListener('click', async () => {
      btnCheckNow.disabled = true;
      btnCheckNow.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanning Portal...';
      addLog('Manual scan triggered by user...', 'info');

      await triggerScan();

      countdownSeconds = 300; // Reset countdown
      setTimeout(() => {
        btnCheckNow.disabled = false;
        btnCheckNow.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Check Portal Right Now';
      }, 2000);
    });
  }

  if (btnPauseResume) {
    btnPauseResume.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/watcher/toggle-pause', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          addLog(`Auto-watcher ${data.isPaused ? 'PAUSED ⏸️' : 'RESUMED 🟢'}`, 'success');
          fetchStatus();
        }
      } catch (e) {}
    });
  }

  if (btnTestSound) {
    btnTestSound.addEventListener('click', () => {
      isSoundSilenced = false;
      playAlarmSequence();
    });
  }

  if (btnSilenceAlarm) {
    btnSilenceAlarm.addEventListener('click', () => {
      isSoundSilenced = true;
      if (alarmIntervalId) {
        clearInterval(alarmIntervalId);
        alarmIntervalId = null;
      }
    });
  }

  if (btnClearAlarm) {
    btnClearAlarm.addEventListener('click', async () => {
      isSoundSilenced = true;
      if (alarmBanner) alarmBanner.classList.add('hidden');
      if (alarmIntervalId) {
        clearInterval(alarmIntervalId);
        alarmIntervalId = null;
      }
    });
  }

  if (tableSearchInput) {
    tableSearchInput.addEventListener('input', () => {
      if (currentState) renderResultsTable(currentState.knownResultsList || getCachedResults());
    });
  }

  // Init
  fetchStatus();
  setInterval(fetchStatus, 4000);
});
