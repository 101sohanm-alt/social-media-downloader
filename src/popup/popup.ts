import { ExtractedMediaItem, DownloadHistoryItem, UserSettings } from '../shared/types';
import { parseTwitterMedia } from '../parsers/twitterParser';
import { parseInstagramMedia } from '../parsers/instagramParser';
import { parseRedditMedia } from '../parsers/redditParser';

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
  const subfolderInput = document.getElementById('setting-subfolder') as HTMLInputElement;
  const templateInput = document.getElementById('setting-template') as HTMLInputElement;
  const carouselToggle = document.getElementById('setting-carousel') as HTMLInputElement;
  const saveBtn = document.getElementById('btn-save-settings');
  const feedback = document.getElementById('settings-feedback');

  const res = await chrome.runtime.sendMessage({ action: 'GET_SETTINGS' });
  const settings: UserSettings = res?.settings || {
    subfolder: 'SocialDownloads',
    filenameTemplate: '{platform}_{author}_{id}_{index}',
    autoDownloadAllCarousel: true
  };

  if (subfolderInput) subfolderInput.value = settings.subfolder;
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
        subfolder: subfolderInput?.value.trim() || 'SocialDownloads',
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
