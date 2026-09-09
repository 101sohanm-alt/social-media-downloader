import { ExtractedMediaItem } from '../../shared/types';

export interface OpenPickerOptions {
  items: ExtractedMediaItem[];
  onDownload: (selected: ExtractedMediaItem[]) => void | Promise<void>;
  onClose?: () => void;
}

let activeCleanup: (() => void) | null = null;

/** Programmatically close the currently open picker, if any. */
export function closePickerModal(): void {
  if (activeCleanup) {
    const cleanup = activeCleanup;
    activeCleanup = null;
    cleanup();
  }
}

function tileLabel(item: ExtractedMediaItem, position: number): string {
  const num = item.index ?? position + 1;
  const kind = item.type === 'video' ? 'video' : item.type === 'gif' ? 'GIF' : 'photo';
  return `${kind} ${num}`;
}

export function openPickerModal(options: OpenPickerOptions): void {
  const { items, onDownload, onClose } = options;
  if (!items || items.length === 0) return;

  // Single instance: replace any picker that is already open.
  closePickerModal();

  const selected = new Set<number>(items.map((_, i) => i));

  const backdrop = document.createElement('div');
  backdrop.className = 'soc-picker-backdrop';
  backdrop.setAttribute('data-testid', 'soc-picker-backdrop');

  const dialog = document.createElement('div');
  dialog.className = 'soc-picker';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', `Choose media to download (${items.length} items)`);

  const header = document.createElement('div');
  header.className = 'soc-picker-header';

  const title = document.createElement('span');
  title.className = 'soc-picker-title';
  title.textContent = `Download media (${items.length})`;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'soc-picker-close';
  closeBtn.setAttribute('type', 'button');
  closeBtn.setAttribute('aria-label', 'Close picker');
  closeBtn.textContent = '✕';

  header.appendChild(title);
  header.appendChild(closeBtn);

  const toolbar = document.createElement('div');
  toolbar.className = 'soc-picker-toolbar';

  const selectAllBtn = document.createElement('button');
  selectAllBtn.className = 'soc-picker-link';
  selectAllBtn.setAttribute('type', 'button');
  selectAllBtn.textContent = 'Select all';

  const clearBtn = document.createElement('button');
  clearBtn.className = 'soc-picker-link';
  clearBtn.setAttribute('type', 'button');
  clearBtn.textContent = 'Clear';

  const count = document.createElement('span');
  count.className = 'soc-picker-count';

  toolbar.appendChild(selectAllBtn);
  toolbar.appendChild(clearBtn);
  toolbar.appendChild(count);

  const grid = document.createElement('div');
  grid.className = 'soc-picker-grid';

  const tileButtons: HTMLButtonElement[] = [];

  function refresh(): void {
    count.textContent = `${selected.size} of ${items.length} selected`;
    tileButtons.forEach((tile, i) => {
      tile.classList.toggle('soc-selected', selected.has(i));
      tile.setAttribute('aria-pressed', selected.has(i) ? 'true' : 'false');
    });
    downloadSelectedBtn.disabled = selected.size === 0;
  }

  items.forEach((item, i) => {
    const tile = document.createElement('button');
    tile.className = 'soc-picker-tile soc-selected';
    tile.setAttribute('type', 'button');
    tile.setAttribute('aria-pressed', 'true');
    tile.setAttribute('aria-label', `Select ${tileLabel(item, i)}`);

    // Numbered placeholder is always rendered underneath, so a tile exists
    // even when the thumbnail is missing or fails to load.
    const placeholder = document.createElement('span');
    placeholder.className = 'soc-picker-thumb-fallback';
    placeholder.textContent = String(item.index ?? i + 1);
    tile.appendChild(placeholder);

    const thumb = item.thumbnailUrl || (item.type === 'image' ? item.url : undefined);
    if (thumb) {
      const img = document.createElement('img');
      img.className = 'soc-picker-thumb';
      img.alt = '';
      img.loading = 'lazy';
      img.src = thumb;
      img.addEventListener('error', () => img.remove());
      tile.appendChild(img);
    }

    if (item.type === 'video') {
      const badge = document.createElement('span');
      badge.className = 'soc-picker-badge';
      badge.textContent = '▶';
      tile.appendChild(badge);
    }

    const check = document.createElement('span');
    check.className = 'soc-picker-check';
    check.textContent = '✓';
    tile.appendChild(check);

    tile.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (selected.has(i)) {
        selected.delete(i);
      } else {
        selected.add(i);
      }
      refresh();
    });

    tileButtons.push(tile);
    grid.appendChild(tile);
  });

  const footer = document.createElement('div');
  footer.className = 'soc-picker-footer';

  const downloadSelectedBtn = document.createElement('button');
  downloadSelectedBtn.className = 'soc-picker-btn soc-picker-primary';
  downloadSelectedBtn.setAttribute('type', 'button');
  downloadSelectedBtn.textContent = 'Download selected';

  const downloadAllBtn = document.createElement('button');
  downloadAllBtn.className = 'soc-picker-btn';
  downloadAllBtn.setAttribute('type', 'button');
  downloadAllBtn.textContent = 'Download all';

  footer.appendChild(downloadSelectedBtn);
  footer.appendChild(downloadAllBtn);

  dialog.appendChild(header);
  dialog.appendChild(toolbar);
  dialog.appendChild(grid);
  dialog.appendChild(footer);
  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  let closed = false;
  function close(notify = true): void {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeyDown, true);
    backdrop.remove();
    if (activeCleanup === cleanup) activeCleanup = null;
    if (notify) onClose?.();
  }
  function cleanup(): void {
    close(false);
  }
  activeCleanup = cleanup;

  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  }
  document.addEventListener('keydown', onKeyDown, true);

  // Clicks inside the dialog must not leak to the host page
  // (e.g. Instagram timeline navigation).
  dialog.addEventListener('click', (e) => e.stopPropagation());
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });

  selectAllBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    items.forEach((_, i) => selected.add(i));
    refresh();
  });
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    selected.clear();
    refresh();
  });

  downloadSelectedBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const chosen = items.filter((_, i) => selected.has(i));
    if (chosen.length === 0) return;
    close(false);
    void onDownload(chosen);
  });
  downloadAllBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    close(false);
    void onDownload([...items]);
  });

  refresh();
}
