# ResultWatcher - MBM University Exam Result Portal Monitor & Alarm

ResultWatcher is a standalone background monitoring service and dashboard for [MBM University's Result Portal](https://mbmiums.in). It automatically checks the portal at configured intervals (e.g., every 5 minutes), maintains a snapshot of declared results, and alerts you instantly with audio-visual alarms whenever a new result is published.

## Features

- **Automated Polling**: Checks `mbmiums.in` every 1, 3, 5, 10, or 15 minutes.
- **Web Audio Alarm Chime**: Plays a repeating audio alarm sequence when a new result link is detected.
- **Visual Alert Modal & Banner**: High-visibility flashing banner with one-click silence and clear controls.
- **Browser Desktop Notifications**: HTML5 Desktop push notifications when a new result drops.
- **Filtering Options**: Filter by Exam Type (Normal vs Revaluation) or search keywords.
- **Snapshot Persistence**: Saves detected baseline links to `snapshot.json` to prevent duplicate alerts.
- **Standalone Server**: Runs independently on port `5003` without affecting `ResultJano` (port `5002`).

## Quick Start

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the application:
   ```bash
   npm start
   ```

3. Open your browser and navigate to:
   ```
   http://localhost:5003
   ```
