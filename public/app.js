// ResultWatcher Client Application Engine
document.addEventListener('DOMContentLoaded', () => {

  let audioContext = null;
  let alarmIntervalId = null;
  let isSoundSilenced = false;
  let currentState = null;

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
  const statTimerStatus = document.getElementById('stat-timer-status');
  const statAlertsCount = document.getElementById('stat-alerts-count');
  const resultsTableBody = document.getElementById('results-table-body');
  const logsConsole = document.getElementById('logs-console');
  const tableSearchInput = document.getElementById('table-search-input');

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
      const res = await fetch('/api/watcher/status');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      currentState = data;
      renderUI(data);
    } catch (err) {
      console.warn('Status fetch error:', err.message);
    }
  }

  function renderUI(data) {
    // 1. Pause / Resume Button & Status Badge
    if (data.isPaused) {
      statusBadge.className = 'status-badge status-offline';
      statusText.textContent = 'Watcher PAUSED';
      btnPauseResume.className = 'btn btn-lg btn-danger btn-block';
      btnPauseResume.innerHTML = '<i class="fa-solid fa-play"></i> RESUME AUTO WATCHER';
      statTimerStatus.textContent = 'PAUSED';
      statTimerStatus.className = 'stat-value text-amber';
    } else {
      statusBadge.className = 'status-badge status-online';
      statusText.textContent = data.isScanning ? 'Scanning Portal...' : '5-Min Auto Watcher Running';
      btnPauseResume.className = 'btn btn-lg btn-success btn-block';
      btnPauseResume.innerHTML = '<i class="fa-solid fa-pause"></i> PAUSE AUTO WATCHER';
      statTimerStatus.textContent = '5 Mins';
      statTimerStatus.className = 'stat-value text-green';
    }

    // 2. Twilio Config Sync
    if (data.twilio) {
      if (document.activeElement !== twilioSid) twilioSid.value = data.twilio.accountSid || '';
      if (document.activeElement !== twilioFrom) twilioFrom.value = data.twilio.fromNumber || '';
      if (document.activeElement !== twilioTo) twilioTo.value = data.twilio.toNumber || '';
    }

    // 3. Stats & Alerts
    statKnownCount.textContent = data.knownCount || 0;
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

    // 4. Logs & Table
    renderResultsTable(data.knownResultsList || []);
    renderLogs(data.logs || []);
  }

  function renderResultsTable(items) {
    const term = tableSearchInput ? tableSearchInput.value.toLowerCase().trim() : '';
    let raw = items || [];
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
  btnPauseResume.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/watcher/toggle-pause', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        addLog(`Auto-watcher ${data.isPaused ? 'PAUSED ⏸️' : 'RESUMED 🟢'}`, 'success');
        fetchStatus();
      }
    } catch (e) {
      addLog(`Failed to toggle pause: ${e.message}`, 'error');
    }
  });

  btnCheckNow.addEventListener('click', async () => {
    btnCheckNow.disabled = true;
    btnCheckNow.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Checking Portal...';
    try {
      await fetch('/api/watcher/check-now', { method: 'POST' });
      setTimeout(fetchStatus, 2000);
    } catch (e) {
      addLog(`Manual check error: ${e.message}`, 'error');
    } finally {
      setTimeout(() => {
        btnCheckNow.disabled = false;
        btnCheckNow.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Check Portal Right Now';
      }, 2500);
    }
  });

  btnSaveTwilio.addEventListener('click', async () => {
    const payload = {
      accountSid: twilioSid.value.trim(),
      authToken: twilioToken.value.trim(),
      fromNumber: twilioFrom.value.trim(),
      toNumber: twilioTo.value.trim()
    };
    try {
      const res = await fetch('/api/watcher/twilio-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        addLog('Twilio SMS configuration saved.', 'success');
      }
    } catch (e) {
      addLog(`Failed to save Twilio config: ${e.message}`, 'error');
    }
  });

  btnSendTestSms.addEventListener('click', async () => {
    btnSendTestSms.disabled = true;
    btnSendTestSms.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending Test SMS...';
    
    const payload = {
      accountSid: twilioSid.value.trim(),
      authToken: twilioToken.value.trim(),
      fromNumber: twilioFrom.value.trim(),
      toNumber: twilioTo.value.trim()
    };

    try {
      const res = await fetch('/api/watcher/test-twilio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        addLog(`📱 Test SMS sent to ${twilioTo.value}! (SID: ${data.sid})`, 'success');
      } else {
        addLog(`Twilio SMS test error: ${data.error}`, 'error');
      }
    } catch (e) {
      addLog(`Test SMS request failed: ${e.message}`, 'error');
    } finally {
      btnSendTestSms.disabled = false;
      btnSendTestSms.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Test Twilio SMS';
      fetchStatus();
    }
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
    try {
      await fetch('/api/watcher/clear-alerts', { method: 'POST' });
      fetchStatus();
    } catch (e) {}
  });

  if (tableSearchInput) {
    tableSearchInput.addEventListener('input', () => {
      if (currentState) renderResultsTable(currentState.knownResultsList || []);
    });
  }

  // Init
  fetchStatus();
  setInterval(fetchStatus, 4000);
});
