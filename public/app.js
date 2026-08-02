// ResultWatcher Vercel Client Application Engine
document.addEventListener('DOMContentLoaded', () => {

  let audioContext = null;
  let alarmIntervalId = null;
  let isSoundSilenced = false;
  let currentState = null;

  // DOM Elements
  const smtpHost = document.getElementById('smtp-host');
  const smtpPort = document.getElementById('smtp-port');
  const smtpUser = document.getElementById('smtp-user');
  const smtpPass = document.getElementById('smtp-pass');
  const notificationEmail = document.getElementById('notification-email');
  const telegramToken = document.getElementById('telegram-token');
  const telegramChatId = document.getElementById('telegram-chat-id');
  const discordWebhook = document.getElementById('discord-webhook');

  const btnTestNotifications = document.getElementById('btn-test-notifications');
  const btnSaveHooks = document.getElementById('btn-save-hooks');
  const btnRunCronNow = document.getElementById('btn-run-cron-now');
  const btnTestSound = document.getElementById('btn-test-sound');
  const btnSilenceAlarm = document.getElementById('btn-silence-alarm');
  const btnClearAlarm = document.getElementById('btn-clear-alarm');
  const alarmBanner = document.getElementById('alarm-banner');
  const alarmDetailsText = document.getElementById('alarm-details-text');

  const statKnownCount = document.getElementById('stat-known-count');
  const statAlertsCount = document.getElementById('stat-alerts-count');
  const resultsTableBody = document.getElementById('results-table-body');
  const logsConsole = document.getElementById('logs-console');
  const tableSearchInput = document.getElementById('table-search-input');

  // Load saved credentials from LocalStorage
  function loadHookCredentials() {
    smtpHost.value = localStorage.getItem('rw_smtp_host') || '';
    smtpPort.value = localStorage.getItem('rw_smtp_port') || '587';
    smtpUser.value = localStorage.getItem('rw_smtp_user') || '';
    smtpPass.value = localStorage.getItem('rw_smtp_pass') || '';
    notificationEmail.value = localStorage.getItem('rw_notification_email') || '';
    telegramToken.value = localStorage.getItem('rw_telegram_token') || '';
    telegramChatId.value = localStorage.getItem('rw_telegram_chat_id') || '';
    discordWebhook.value = localStorage.getItem('rw_discord_webhook') || '';
  }

  // Save credentials to LocalStorage
  function saveHookCredentials() {
    localStorage.setItem('rw_smtp_host', smtpHost.value.trim());
    localStorage.setItem('rw_smtp_port', smtpPort.value.trim());
    localStorage.setItem('rw_smtp_user', smtpUser.value.trim());
    localStorage.setItem('rw_smtp_pass', smtpPass.value.trim());
    localStorage.setItem('rw_notification_email', notificationEmail.value.trim());
    localStorage.setItem('rw_telegram_token', telegramToken.value.trim());
    localStorage.setItem('rw_telegram_chat_id', telegramChatId.value.trim());
    localStorage.setItem('rw_discord_webhook', discordWebhook.value.trim());
    addLog('Hook credentials saved locally in browser.', 'success');
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
      renderUI(data);
    } catch (err) {
      console.warn('Status fetch error:', err.message);
    }
  }

  function renderUI(data) {
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

    renderResultsTable(data.knownResultsList || []);
  }

  function renderResultsTable(items) {
    const term = tableSearchInput ? tableSearchInput.value.toLowerCase().trim() : '';
    let filtered = items;
    if (term) {
      filtered = items.filter(i => i.title.toLowerCase().includes(term));
    }

    if (filtered.length === 0) {
      resultsTableBody.innerHTML = `<tr><td colspan="3" class="text-center text-muted">No published result links found.</td></tr>`;
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

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[m]);
  }

  // Event Handlers
  btnSaveHooks.addEventListener('click', saveHookCredentials);

  btnTestNotifications.addEventListener('click', async () => {
    saveHookCredentials();
    btnTestNotifications.disabled = true;
    btnTestNotifications.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Sending Test Alerts...';

    const payload = {
      smtpHost: smtpHost.value.trim(),
      smtpPort: smtpPort.value.trim(),
      smtpUser: smtpUser.value.trim(),
      smtpPass: smtpPass.value.trim(),
      notificationEmail: notificationEmail.value.trim(),
      telegramBotToken: telegramToken.value.trim(),
      telegramChatId: telegramChatId.value.trim(),
      discordWebhookUrl: discordWebhook.value.trim()
    };

    try {
      const res = await fetch('/api/test-notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.success) {
        addLog('Test notification execution completed!', 'success');
        if (data.results) {
          if (data.results.mail?.success) addLog('✉️ Mail Hook test email delivered!', 'success');
          if (data.results.telegram?.success) addLog('💬 Telegram Bot message delivered!', 'success');
          if (data.results.discord?.success) addLog('🎮 Discord Webhook embed delivered!', 'success');
        }
      } else {
        addLog(`Test alert error: ${data.error}`, 'error');
      }
    } catch (e) {
      addLog(`Test request failed: ${e.message}`, 'error');
    } finally {
      btnTestNotifications.disabled = false;
      btnTestNotifications.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Send Test Email & Webhook Alerts';
    }
  });

  btnRunCronNow.addEventListener('click', async () => {
    btnRunCronNow.disabled = true;
    btnRunCronNow.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Executing Vercel Cron Scan...';
    addLog('Manual Vercel Cron trigger initiated...', 'info');

    try {
      const res = await fetch('/api/cron');
      const data = await res.json();
      if (data.success) {
        addLog(`Vercel Cron scan completed! Extracted ${data.extractedCount} links.`, 'success');
        if (data.newResultsFound > 0) {
          addLog(`🚨 ${data.newResultsFound} NEW RESULT(S) DETECTED! Alerts dispatched.`, 'alert');
        }
        fetchStatus();
      } else {
        addLog(`Vercel Cron error: ${data.error}`, 'error');
      }
    } catch (e) {
      addLog(`Vercel Cron trigger error: ${e.message}`, 'error');
    } finally {
      setTimeout(() => {
        btnRunCronNow.disabled = false;
        btnRunCronNow.innerHTML = '<i class="fa-solid fa-play"></i> Trigger Vercel Cron Scan Now';
      }, 2000);
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

  btnClearAlarm.addEventListener('click', () => {
    isSoundSilenced = true;
    alarmBanner.classList.add('hidden');
    if (alarmIntervalId) {
      clearInterval(alarmIntervalId);
      alarmIntervalId = null;
    }
  });

  if (tableSearchInput) {
    tableSearchInput.addEventListener('input', () => {
      if (currentState) renderResultsTable(currentState.knownResultsList || []);
    });
  }

  // Init
  loadHookCredentials();
  fetchStatus();
  setInterval(fetchStatus, 5000);
});
