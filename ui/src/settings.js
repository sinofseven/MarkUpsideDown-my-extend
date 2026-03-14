const { invoke } = window.__TAURI__.core;

const STORAGE_KEY_WORKER_URL = "markupsidedown:workerUrl";
const STORAGE_KEY_SETUP_DONE = "markupsidedown:setupDone";

export function getWorkerUrl() {
  return localStorage.getItem(STORAGE_KEY_WORKER_URL) || "";
}

export function setWorkerUrl(url) {
  if (url) {
    localStorage.setItem(STORAGE_KEY_WORKER_URL, url.replace(/\/+$/, ""));
  } else {
    localStorage.removeItem(STORAGE_KEY_WORKER_URL);
  }
}

export function isSetupDone() {
  return localStorage.getItem(STORAGE_KEY_SETUP_DONE) === "1";
}

function markSetupDone() {
  localStorage.setItem(STORAGE_KEY_SETUP_DONE, "1");
}

let currentTestStatus = null; // cached last test result

function featureRows(status) {
  const hasWorker = Boolean(status && status.reachable);
  const hasConvert = Boolean(status && status.convert_available);
  const hasRender = Boolean(status && status.render_available);

  return [
    { name: "Open / Save / Export PDF", ok: true, hint: "Always available" },
    { name: "Fetch URL (standard)", ok: true, hint: "Always available" },
    { name: "Table Editor / Copy Rich Text", ok: true, hint: "Always available" },
    {
      name: "Import documents",
      ok: hasConvert,
      hint: hasConvert ? "Ready" : "Needs Worker URL",
    },
    {
      name: "Fetch URL (Render JS)",
      ok: hasRender,
      hint: hasRender ? "Ready" : hasWorker ? "Needs Worker secrets" : "Needs Worker URL + secrets",
    },
  ];
}

function renderFeatureList(container, status) {
  const rows = featureRows(status);
  container.innerHTML = rows
    .map(
      (r) => `
    <div class="feature-row ${r.ok ? "feature-ok" : "feature-needs"}">
      <span class="feature-icon">${r.ok ? "✓" : "●"}</span>
      <span class="feature-name">${r.name}</span>
      <span class="feature-hint">${r.hint}</span>
    </div>`
    )
    .join("");
}

export function showSettings({ onSave } = {}) {
  document.getElementById("settings-panel")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "settings-panel";
  overlay.className = "dialog-overlay";

  const workerUrl = getWorkerUrl();

  overlay.innerHTML = `
    <div class="settings-box">
      <div class="settings-header">
        <span class="settings-title">Settings</span>
        <button id="settings-close" class="settings-close-btn" title="Close">&times;</button>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Cloudflare Worker</div>
        <div class="settings-description">
          Powers document import and JS-rendered page fetching — the core of MarkUpsideDown.
        </div>
        <div class="settings-deploy">
          <span class="settings-deploy-label">Deploy:</span>
          <code>cd worker && wrangler deploy</code>
        </div>
        <div class="settings-worker-input-row">
          <input
            type="url"
            id="settings-worker-url"
            placeholder="https://markupsidedown-converter.YOUR_SUBDOMAIN.workers.dev"
            value="${workerUrl}"
          />
          <button id="settings-test-btn">Test</button>
        </div>
        <div id="settings-test-result" class="settings-test-result"></div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Feature Status</div>
        <div id="settings-feature-list" class="settings-feature-list"></div>
      </div>

      <div class="settings-section settings-secrets-help" id="settings-secrets-help" style="display:none">
        <div class="settings-section-title">Missing: Worker Secrets</div>
        <div class="settings-description">
          The <code>/render</code> endpoint needs two secrets. Run these once after deploy:
        </div>
        <pre class="settings-code">cd worker
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put CLOUDFLARE_API_TOKEN</pre>
      </div>

      <div class="settings-actions">
        <button id="settings-clear" class="settings-clear-btn">Clear URL</button>
        <span class="spacer"></span>
        <button id="settings-cancel">Cancel</button>
        <button id="settings-save" class="primary">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const urlInput = document.getElementById("settings-worker-url");
  const testBtn = document.getElementById("settings-test-btn");
  const testResult = document.getElementById("settings-test-result");
  const featureList = document.getElementById("settings-feature-list");
  const secretsHelp = document.getElementById("settings-secrets-help");

  // Initial feature list
  renderFeatureList(featureList, currentTestStatus);
  if (currentTestStatus?.reachable && !currentTestStatus?.render_available) {
    secretsHelp.style.display = "";
  }

  urlInput.focus();

  // Test connection
  testBtn.addEventListener("click", async () => {
    const url = urlInput.value.trim();
    if (!url) {
      testResult.className = "settings-test-result test-error";
      testResult.textContent = "Enter a Worker URL first";
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = "Testing…";
    testResult.className = "settings-test-result test-pending";
    testResult.textContent = "Connecting…";

    try {
      const status = await invoke("test_worker_url", { workerUrl: url.replace(/\/+$/, "") });
      currentTestStatus = status;

      if (!status.reachable) {
        testResult.className = "settings-test-result test-error";
        testResult.textContent = status.error || "Cannot reach Worker";
      } else if (status.render_available) {
        testResult.className = "settings-test-result test-ok";
        testResult.textContent = "Fully configured — all features available";
      } else if (status.convert_available) {
        testResult.className = "settings-test-result test-warn";
        testResult.textContent = "Connected — Import works, but Render JS needs secrets";
      } else {
        testResult.className = "settings-test-result test-warn";
        testResult.textContent = "Reachable but returned unexpected response";
      }

      renderFeatureList(featureList, status);
      secretsHelp.style.display =
        status.reachable && !status.render_available ? "" : "none";
    } catch (e) {
      testResult.className = "settings-test-result test-error";
      testResult.textContent = `Error: ${e}`;
      currentTestStatus = null;
      renderFeatureList(featureList, null);
      secretsHelp.style.display = "none";
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = "Test";
    }
  });

  // Close actions
  const close = () => overlay.remove();
  const saveAndClose = () => {
    const url = urlInput.value.trim();
    setWorkerUrl(url);
    markSetupDone();
    close();
    if (onSave) onSave(url);
  };

  document.getElementById("settings-close").addEventListener("click", close);
  document.getElementById("settings-cancel").addEventListener("click", close);
  document.getElementById("settings-save").addEventListener("click", saveAndClose);

  document.getElementById("settings-clear").addEventListener("click", () => {
    urlInput.value = "";
    currentTestStatus = null;
    testResult.className = "settings-test-result";
    testResult.textContent = "";
    renderFeatureList(featureList, null);
    secretsHelp.style.display = "none";
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  // Auto-test if URL already exists
  if (workerUrl) {
    testBtn.click();
  }
}

// Returns the worker URL, or shows settings panel if not configured.
// Returns a Promise that resolves to the URL or null.
export function ensureWorkerUrl() {
  const url = getWorkerUrl();
  if (url) return Promise.resolve(url);

  return new Promise((resolve) => {
    showSettings({
      onSave: (savedUrl) => resolve(savedUrl || null),
    });
  });
}

// Show settings on first launch
export function checkFirstRun() {
  if (!isSetupDone() && !getWorkerUrl()) {
    showSettings();
  }
}
