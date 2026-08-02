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
  const btnSaveTwilio = document.getElementById('btn-save-twilio');
  const btnTestSound = document.getElementById('btn-test-sound');
  const btnSilenceAlarm = document.getElementById('btn-silence-alarm');
  const btnClearAlarm = document.getElementById('btn-clear-alarm');
  const alarmBanner = document.getElementById('alarm-banner');
  const alarmDetailsText = document.getElementById('alarm-details-text');

  const twilioSid = document.getElementById('twilio-sid');
  const twilioToken = document.getElementById('twilio-token');
  const twilioFrom = document.getElementById('twilio-from');
  const twilioTo = document.getElementById('twilio-to');

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
      fetch('/api/cron').then(r => r.json()).then(data => {
        if (data.knownResultsList) renderResultsTable(data.knownResultsList);
      }).catch(() => {});
    }

    const mins = String(Math.floor(countdownSeconds / 60)).padStart(2, '0');
    const secs = String(countdownSeconds % 60).padStart(2, '0');
    if (statTimerCountdown) {
      statTimerCountdown.textContent = `${mins}:${secs}`;
    }
  }, 1000);

  // Load saved credentials from LocalStorage
  function loadLocalCredentials() {
    if (localStorage.getItem('rw_twilio_sid')) twilioSid.value = localStorage.getItem('rw_twilio_sid');
    if (localStorage.getItem('rw_twilio_token')) twilioToken.value = localStorage.getItem('rw_twilio_token');
    if (localStorage.getItem('rw_twilio_from')) twilioFrom.value = localStorage.getItem('rw_twilio_from');
    if (localStorage.getItem('rw_twilio_to')) twilioTo.value = localStorage.getItem('rw_twilio_to');
  }

  // Save credentials to LocalStorage
  function saveLocalCredentials() {
    localStorage.setItem('rw_twilio_sid', twilioSid.value.trim());
    localStorage.setItem('rw_twilio_token', twilioToken.value.trim());
    localStorage.setItem('rw_twilio_from', twilioFrom.value.trim());
    localStorage.setItem('rw_twilio_to', twilioTo.value.trim());
    addLog('Twilio settings saved locally in browser.', 'success');
  }

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

  // Fetch status from server
  async function fetchStatus() {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      currentState = data;

      if (data.twilio) {
        if (!twilioSid.value && data.twilio.accountSid) twilioSid.value = data.twilio.accountSid;
        if (!twilioFrom.value && data.twilio.fromNumber) twilioFrom.value = data.twilio.fromNumber;
        if (!twilioTo.value && data.twilio.toNumber) twilioTo.value = data.twilio.toNumber;
      }

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
      statusBadge.className = 'status-badge status-offline';
      statusText.textContent = 'Watcher PAUSED';
      btnPauseResume.className = 'btn btn-lg btn-danger btn-block';
      btnPauseResume.innerHTML = '<i class="fa-solid fa-play"></i> RESUME AUTO WATCHER';
      if (statTimerCountdown) {
        statTimerCountdown.textContent = 'PAUSED';
        statTimerCountdown.className = 'stat-value text-amber';
      }
    } else {
      statusBadge.className = 'status-badge status-online';
      statusText.textContent = data.isScanning ? 'Scanning Portal...' : 'Auto Watcher Active';
      btnPauseResume.className = 'btn btn-lg btn-success btn-block';
      btnPauseResume.innerHTML = '<i class="fa-solid fa-pause"></i> PAUSE AUTO WATCHER';
      if (statTimerCountdown && statTimerCountdown.textContent === 'PAUSED') {
        statTimerCountdown.className = 'stat-value text-green';
      }
    }

    const items = (data.knownResultsList && data.knownResultsList.length > 0) ? data.knownResultsList : getCachedResults();
    statKnownCount.textContent = items.length || 0;
    statAlertsCount.textContent = data.activeAlerts ? data.activeAlerts.length : 0;

    if (data.activeAlerts && data.activeAlerts.length > 0) {
      alarmBanner.classList.remove('hidden');
      alarmDetailsText.textContent = `Latest result: "${data.activeAlerts[0].title}"`;
      if (!alarmIntervalId) {
        playAlarmSequence();
        alarmIntervalId = setInterval(playAlarmSequence, 3000);
      }
    } else {
      alarmBanner.classList.add('hidden');
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
  btnSaveTwilio.addEventListener('click', () => {
    saveLocalCredentials();
    fetch('/api/watcher/twilio-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountSid: twilioSid.value.trim(),
        authToken: twilioToken.value.trim(),
        fromNumber: twilioFrom.value.trim(),
        toNumber: twilioTo.value.trim()
      })
    }).catch(() => {});
  });

  btnSendTestSms.addEventListener('click', async () => {
    saveLocalCredentials();
    btnSendTestSms.disabled = true;
    btnSendTestSms.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending Test SMS...';
    
    const payload = {
      accountSid: twilioSid.value.trim(),
      authToken: twilioToken.value.trim(),
      fromNumber: twilioFrom.value.trim(),
      toNumber: twilioTo.value.trim()
    };

    try {
      const endpoint = '/api/test-notifications';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        addLog(`📱 Test SMS sent to ${twilioTo.value}! (SID: ${data.sid})`, 'success');
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

  btnCheckNow.addEventListener('click', async () => {
    btnCheckNow.disabled = true;
    btnCheckNow.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanning Portal...';
    addLog('Manual scan triggered...', 'info');
    try {
      const res = await fetch('/api/cron');
      const data = await res.json();
      if (data.success) {
        addLog(`Scan completed! Extracted ${data.extractedCount} links.`, 'success');
        if (data.knownResultsList && data.knownResultsList.length > 0) {
          saveCachedResults(data.knownResultsList);
          renderResultsTable(data.knownResultsList);
        }
      }
    } catch (e) {
      addLog(`Scan error: ${e.message}`, 'error');
    } finally {
      countdownSeconds = 300; // Reset countdown
      setTimeout(() => {
        btnCheckNow.disabled = false;
        btnCheckNow.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Check Portal Right Now';
      }, 2000);
    }
  });

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

  btnTestSound.addEventListener('click', () => {
    isSoundSilenced = false;
    playAlarmSequence();
  });

  btnSilenceAlarm.addEventListener('click', () => {
    isSoundSilenced = true;
    if (alarmIntervalId) {
      clearInterval(alarmIntervalId);
      alarmIntervalId = null;
    }
  });

  btnClearAlarm.addEventListener('click', async () => {
    isSoundSilenced = true;
    alarmBanner.classList.add('hidden');
    if (alarmIntervalId) {
      clearInterval(alarmIntervalId);
      alarmIntervalId = null;
    }
  });

  if (tableSearchInput) {
    tableSearchInput.addEventListener('input', () => {
      if (currentState) renderResultsTable(currentState.knownResultsList || getCachedResults());
    });
  }

  // Init
  loadLocalCredentials();
  fetchStatus();
  setInterval(fetchStatus, 4000);
});
