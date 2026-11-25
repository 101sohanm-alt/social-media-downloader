import { ExtractedMediaItem, DownloadHistoryItem, UserSettings } from '../shared/types';
import { parseTwitterMedia } from '../parsers/twitterParser';
import { parseInstagramMedia } from '../parsers/instagramParser';
import { parseRedditMedia } from '../parsers/redditParser';
import { chooseFolder, getFolder, pingHost, setFolder } from '../background/nativeHost';

// Tab switching
const tabs = document.querySelectorAll<HTMLButtonElement>('.nav-tab');
const panes = document.querySelectorAll<HTMLElement>('.tab-pane');

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    panes.forEach((p) => p.classList.remove('active'));

    tab.classList.add('active');
    const target = tab.getAttribute('data-tab');
    if (target) {
      document.getElementById(target)?.classList.add('active');
    }
  });
});

// Platform detection
async function detectActiveTab() {
  const badge = document.getElementById('platform-badge');
  const badgeText = document.getElementById('platform-text');
  if (!badge || !badgeText) return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url || '';

    badge.className = 'platform-badge';
    if (url.includes('x.com') || url.includes('twitter.com')) {
      badge.classList.add('platform-twitter');
      badgeText.textContent = 'X (Twitter)';
    } else if (url.includes('instagram.com')) {
      badge.classList.add('platform-instagram');
      badgeText.textContent = 'Instagram';
    } else if (url.includes('reddit.com')) {
      badge.classList.add('platform-reddit');
      badgeText.textContent = 'Reddit';
    } else {
      badge.classList.add('platform-inactive');
      badgeText.textContent = 'Ready';
    }
  } catch {
    badgeText.textContent = 'Ready';
  }
}

// Settings management
async function initSettings() {
  const templateInput = document.getElementById('setting-template') as HTMLInputElement;
  const carouselToggle = document.getElementById('setting-carousel') as HTMLInputElement;
  const saveBtn = document.getElementById('btn-save-settings');
  const feedback = document.getElementById('settings-feedback');

  const res = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
  const settings: UserSettings = res?.settings || {
    subfolder: 'SocialDownloads',
    nativeFolder: null,
    filenameTemplate: '{platform}_{author}_{id}_{index}',
    autoDownloadAllCarousel: true
  };

  if (templateInput) templateInput.value = settings.filenameTemplate;
  if (carouselToggle) carouselToggle.checked = settings.autoDownloadAllCarousel;

  // Token chip buttons
  document.querySelectorAll<HTMLButtonElement>('.token-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const token = chip.getAttribute('data-token');
      if (token && templateInput) {
        templateInput.value += `_${token}`;
      }
    });
  });

  saveBtn?.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({
      action: 'SAVE_SETTINGS',
      settings: {
        filenameTemplate: templateInput?.value.trim() || '{platform}_{author}_{id}_{index}',
        autoDownloadAllCarousel: carouselToggle?.checked ?? true
      }
    });

    if (feedback) {
      feedback.textContent = 'Settings saved successfully!';
      setTimeout(() => {
        feedback.textContent = '';
      }, 2500);
    }
  });

  initFolderControl(settings);
}

// ---------------------------------------------------------------------------
// Native folder control
// ---------------------------------------------------------------------------

type HostState = 'checking' | 'connected' | 'missing' | 'denied';

function setHostState(state: HostState, detail?: string) {
  const status = document.getElementById('host-status');
  const text = document.getElementById('host-status-text');
  if (status) status.dataset.state = state;
  if (text) {
    if (state === 'checking') text.textContent = 'Checking native host…';
    else if (state === 'connected') text.textContent = detail || 'Native host connected';
    else if (state === 'denied') {
      text.textContent =
        detail || 'Native host blocked by Chrome policy. Downloads use ~/Downloads instead.';
    } else {
      text.textContent =
        detail ||
        'Native host not installed — using ~/Downloads. Install Omni Media Host to choose a folder.';
    }
  }
}

function renderFolder(folder: string | null) {
  const display = document.getElementById('folder-display');
  const path = document.getElementById('folder-path');
  const hint = document.getElementById('folder-hint');
  const clearBtn = document.getElementById('btn-clear-folder') as HTMLButtonElement | null;

  const hasFolder = !!(folder && folder.trim());

  if (display) {
    display.dataset.empty = hasFolder ? 'false' : 'true';
    display.title = hasFolder ? (folder as string) : 'No folder chosen';
  }
  if (path) path.textContent = hasFolder ? (folder as string) : 'No folder chosen — using ~/Downloads';
  if (hint) {
    hint.textContent = hasFolder
      ? 'The native host writes files straight into this folder.'
      : 'Downloads go to ~/Downloads via the browser.';
  }
  if (clearBtn) clearBtn.disabled = !hasFolder;
}

async function persistFolder(folder: string | null) {
  await chrome.runtime.sendMessage({
    action: 'SAVE_SETTINGS',
    settings: { nativeFolder: folder }
  });
  renderFolder(folder);
}

function initFolderControl(settings: UserSettings) {
  const chooseBtn = document.getElementById('btn-choose-folder') as HTMLButtonElement | null;
  const clearBtn = document.getElementById('btn-clear-folder') as HTMLButtonElement | null;

  renderFolder(settings.nativeFolder ?? null);

  // Ping on open, then make sure the host still knows the saved folder. The
  // host is stateless between calls and may have forgotten it (fresh process,
  // reinstall); the extension's copy is authoritative. A cleared folder is
  // never re-adopted from the host — otherwise "Clear" would undo itself.
  (async () => {
    const ping = await pingHost();
    if (!ping.ok) {
      setHostState(ping.code === 'forbidden' ? 'denied' : 'missing');
      return;
    }

    setHostState(
      'connected',
      `Native host connected · v${ping.value.version} (${ping.value.platform})`
    );

    const saved = settings.nativeFolder ?? null;
    if (!saved) return;

    const fresh = await getFolder();
    if (fresh.ok && fresh.value.path === saved) return;

    const applied = await setFolder(saved);
    if (!applied.ok && (applied.code === 'unavailable' || applied.code === 'forbidden')) {
      setHostState(applied.code === 'forbidden' ? 'denied' : 'missing');
    }
  })();

  chooseBtn?.addEventListener('click', async () => {
    if (chooseBtn.disabled) return;
    const previousLabel = chooseBtn.textContent;
    chooseBtn.disabled = true;
    chooseBtn.setAttribute('aria-busy', 'true');
    chooseBtn.textContent = 'Opening…';

    const restoreButton = () => {
      chooseBtn.disabled = false;
      chooseBtn.removeAttribute('aria-busy');
      chooseBtn.textContent = previousLabel || 'Choose Folder…';
    };

    // The host shows a modal picker whose life is outside this popup: closing
    // the popup does not dismiss it, and the reply may arrive after a reopen.
    // So the button is NOT restored on cancellation — a fresh popup starts
    // enabled, and keeping it disabled here prevents a second native picker
    // stacking on the still-open one.
    const result = await chooseFolder('Choose where Omni Media saves your downloads');

    if (!result.ok) {
      if (result.code === 'cancelled') return;
      restoreButton();
      if (result.code === 'unavailable' || result.code === 'forbidden') {
        setHostState(result.code === 'forbidden' ? 'denied' : 'missing');
        return;
      }
      setHostState('connected', `Could not choose folder: ${result.message}`);
      return;
    }

    // Tell the host first so the JS setting never points at a folder the
    // host has forgotten.
    const applied = await setFolder(result.value.path);
    if (!applied.ok) {
      restoreButton();
      setHostState('connected', `Folder was not applied: ${applied.message}`);
      return;
    }

    await persistFolder(applied.value.path);
    setHostState('connected', `Folder set: ${applied.value.path}`);
    restoreButton();
  });

  clearBtn?.addEventListener('click', async () => {
    clearBtn.disabled = true;
    // No host call: the host is stateless and the download path only ever
    // re-asserts a folder from the saved setting, so clearing here is enough.
    await persistFolder(null);
    setHostState('connected', 'No folder chosen — using ~/Downloads');
  });
}

// History management
async function initHistory() {
  const listEl = document.getElementById('history-list');
  const countEl = document.getElementById('history-count');
  const clearBtn = document.getElementById('btn-clear-history');

  async function loadHistory() {
    if (!listEl) return;
    const res = await chrome.runtime.sendMessage({ action: 'GET_HISTORY' });
    const history: DownloadHistoryItem[] = res?.history || [];

    if (countEl) countEl.textContent = `${history.length} item(s)`;

    if (history.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No downloads yet</div>';
      return;
    }

    listEl.innerHTML = history
      .map(
        (item) => `
      <div class="history-card">
        <div class="history-details">
          <span class="history-name" title="${item.filename}">${item.filename}</span>
          <span class="history-meta">${item.platform.toUpperCase()} • ${new Date(item.timestamp).toLocaleTimeString()}</span>
        </div>
        <span class="history-status status-${item.status}">${item.status}</span>
      </div>
    `
      )
      .join('');
  }

  clearBtn?.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'CLEAR_HISTORY' });
    await loadHistory();
  });

  document.getElementById('tab-btn-history')?.addEventListener('click', () => {
    loadHistory();
  });

  await loadHistory();
}

// Direct URL tester
function initDirectUrlTester() {
  const urlInput = document.getElementById('input-url') as HTMLInputElement;
  const fetchBtn = document.getElementById('btn-fetch-url');
  const statusEl = document.getElementById('fetch-status');

  fetchBtn?.addEventListener('click', async () => {
    const rawUrl = urlInput?.value.trim();
    if (!rawUrl || !statusEl) return;

    statusEl.className = 'fetch-status';
    statusEl.textContent = 'Fetching post data...';

    try {
      let items: ExtractedMediaItem[] = [];

      // Reddit URL
      if (rawUrl.includes('reddit.com')) {
        const jsonUrl = `${rawUrl.split('?')[0].replace(/\/$/, '')}.json`;
        const res = await fetch(jsonUrl, { headers: { Accept: 'application/json' } });
        const data = await res.json();
        items = parseRedditMedia(data);
      }
      // Direct image or fallback
      else if (rawUrl.match(/\.(jpg|jpeg|png|webp|mp4)(\?.*)?$/i)) {
        const ext = rawUrl.split('.').pop()?.split('?')[0]?.toLowerCase() || 'jpg';
        items = [
          {
            id: String(Date.now()),
            platform: 'twitter',
            type: ext === 'mp4' ? 'video' : 'image',
            author: 'direct_url',
            url: rawUrl,
            ext: `.${ext}`
          }
        ];
      }

      if (items.length > 0) {
        statusEl.className = 'fetch-status success';
        statusEl.textContent = `Found ${items.length} item(s)! Starting download...`;
        await chrome.runtime.sendMessage({ action: 'DOWNLOAD_MEDIA', items });
      } else {
        statusEl.className = 'fetch-status error';
        statusEl.textContent = 'Could not extract media directly from URL.';
      }
    } catch (err: any) {
      statusEl.className = 'fetch-status error';
      statusEl.textContent = `Error: ${err.message || 'Fetch failed'}`;
    }
  });
}

// Page Grab Trigger
function initPageGrabTrigger() {
  const grabBtn = document.getElementById('btn-page-grab');
  grabBtn?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_PAGE_GRAB' }, (res) => {
      if (chrome.runtime.lastError) {
        alert('Could not trigger grab on this page. Navigate to an Instagram, X, or Reddit post.');
      }
    });
  });
}

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  detectActiveTab();
  initSettings();
  initHistory();
  initDirectUrlTester();
  initPageGrabTrigger();
});
