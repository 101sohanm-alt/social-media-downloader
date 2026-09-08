import { ExtractedMediaItem } from '../../shared/types';

export interface SelectionModalOptions {
  items: ExtractedMediaItem[];
  postTitle?: string;
  onDownload: (selectedItems: ExtractedMediaItem[]) => void;
  onClose?: () => void;
  onCancel?: () => void;
}

export interface SelectionModalHandle {
  close: () => void;
  element: HTMLElement;
}

const CLOSE_SVG = `
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
`;

export function openSelectionModal(options: SelectionModalOptions): SelectionModalHandle {
  const { items, postTitle, onDownload, onClose, onCancel } = options;

  // Track selection set (selected item indices)
  const selectedIndices = new Set<number>(items.map((_, i) => i));

  // Backdrop overlay
  const backdrop = document.createElement('div');
  backdrop.className = 'soc-modal-backdrop';

  // Dialog container
  const dialog = document.createElement('div');
  dialog.className = 'soc-selection-modal soc-modal-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');

  // Header
  const header = document.createElement('div');
  header.className = 'soc-modal-header';

  const titleRow = document.createElement('div');
  titleRow.className = 'soc-modal-title-row';

  const title = document.createElement('h3');
  title.className = 'soc-modal-title';
  title.textContent = postTitle || 'Select Media to Download';

  const subtitle = document.createElement('p');
  subtitle.className = 'soc-modal-subtitle';

  titleRow.appendChild(title);
  titleRow.appendChild(subtitle);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'soc-modal-close soc-modal-close-btn';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close dialog');
  closeBtn.innerHTML = CLOSE_SVG;

  header.appendChild(titleRow);
  header.appendChild(closeBtn);

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'soc-modal-toolbar';

  const selectAllBtn = document.createElement('button');
  selectAllBtn.className = 'soc-btn-secondary soc-btn-select-all soc-modal-select-all';
  selectAllBtn.type = 'button';
  selectAllBtn.textContent = 'Select All';

  const deselectAllBtn = document.createElement('button');
  deselectAllBtn.className = 'soc-btn-secondary soc-btn-deselect-all soc-modal-deselect-all';
  deselectAllBtn.type = 'button';
  deselectAllBtn.textContent = 'Deselect All';

  const countDisplay = document.createElement('span');
  countDisplay.className = 'soc-selection-count';

  toolbar.appendChild(selectAllBtn);
  toolbar.appendChild(deselectAllBtn);
  toolbar.appendChild(countDisplay);

  // Grid
  const grid = document.createElement('div');
  grid.className = 'soc-modal-grid';

  const cardElements: HTMLElement[] = [];
  const checkboxElements: HTMLInputElement[] = [];

  items.forEach((item, index) => {
    const card = document.createElement('div');
    card.className = 'soc-card soc-modal-card is-selected soc-card-selected';
    card.setAttribute('tabindex', '0');

    // Thumbnail wrapper
    const thumbWrapper = document.createElement('div');
    thumbWrapper.className = 'soc-card-thumb-wrapper';

    const thumbUrl = item.thumbnailUrl || item.url;
    const img = document.createElement('img');
    img.className = 'soc-card-thumb soc-modal-thumb';
    img.src = thumbUrl;
    img.loading = 'lazy';
    img.alt = `Media item ${item.index || index + 1}`;

    const typeUpper = (item.type || 'image').toUpperCase();

    img.onerror = () => {
      img.style.display = 'none';
      const placeholder = document.createElement('div');
      placeholder.className = 'soc-thumb-placeholder';
      placeholder.textContent = typeUpper;
      thumbWrapper.appendChild(placeholder);
    };

    thumbWrapper.appendChild(img);

    // Real HTML Checkbox input
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'soc-card-checkbox';
    checkbox.checked = true;

    // Index badge
    const indexBadge = document.createElement('span');
    indexBadge.className = 'soc-badge soc-badge-index';
    indexBadge.textContent = `#${item.index || index + 1}`;

    // Type tag
    const typeTag = document.createElement('span');
    typeTag.className = `soc-badge soc-badge-type soc-type-${item.type}`;
    typeTag.textContent = typeUpper;

    // Dimension tag
    if (item.width && item.height) {
      const dimTag = document.createElement('span');
      dimTag.className = 'soc-badge soc-badge-dim';
      dimTag.textContent = `${item.width}×${item.height}`;
      thumbWrapper.appendChild(dimTag);
    }

    thumbWrapper.appendChild(checkbox);
    thumbWrapper.appendChild(indexBadge);
    thumbWrapper.appendChild(typeTag);

    card.appendChild(thumbWrapper);

    const toggle = (forceState?: boolean) => {
      const willBeSelected = forceState !== undefined ? forceState : !selectedIndices.has(index);
      if (willBeSelected) {
        selectedIndices.add(index);
        card.classList.add('is-selected', 'soc-card-selected');
        checkbox.checked = true;
      } else {
        selectedIndices.delete(index);
        card.classList.remove('is-selected', 'soc-card-selected');
        checkbox.checked = false;
      }
      updateUI();
    };

    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle(checkbox.checked);
    });

    card.addEventListener('click', (e) => {
      e.stopPropagation();
      toggle();
    });

    cardElements.push(card);
    checkboxElements.push(checkbox);
    grid.appendChild(card);
  });

  // Footer
  const footer = document.createElement('div');
  footer.className = 'soc-modal-footer';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'soc-btn-secondary soc-modal-cancel-btn';
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';

  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'soc-btn-primary soc-btn-download soc-modal-download-btn';
  downloadBtn.type = 'button';

  footer.appendChild(cancelBtn);
  footer.appendChild(downloadBtn);

  dialog.appendChild(header);
  dialog.appendChild(toolbar);
  dialog.appendChild(grid);
  dialog.appendChild(footer);
  backdrop.appendChild(dialog);

  function updateUI() {
    const count = selectedIndices.size;
    subtitle.textContent = `${count} of ${items.length} items selected`;
    countDisplay.textContent = `${count} selected`;
    downloadBtn.textContent = `Download Selected (${count})`;
    downloadBtn.disabled = count === 0;
  }

  function handleSelectAll() {
    items.forEach((_, i) => selectedIndices.add(i));
    cardElements.forEach((c) => c.classList.add('is-selected', 'soc-card-selected'));
    checkboxElements.forEach((cb) => (cb.checked = true));
    updateUI();
  }

  function handleDeselectAll() {
    selectedIndices.clear();
    cardElements.forEach((c) => c.classList.remove('is-selected', 'soc-card-selected'));
    checkboxElements.forEach((cb) => (cb.checked = false));
    updateUI();
  }

  function close() {
    window.removeEventListener('keydown', handleKeyDown);
    backdrop.remove();
    onClose?.();
    onCancel?.();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  selectAllBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleSelectAll();
  });

  deselectAllBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleDeselectAll();
  });

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });

  cancelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    close();
  });

  downloadBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (selectedIndices.size === 0) return;
    const selectedItems = Array.from(selectedIndices)
      .sort((a, b) => a - b)
      .map((i) => items[i]);
    // Close without triggering cancel
    window.removeEventListener('keydown', handleKeyDown);
    backdrop.remove();
    onDownload(selectedItems);
  });

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      close();
    }
  });

  dialog.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  window.addEventListener('keydown', handleKeyDown);

  updateUI();
  document.body.appendChild(backdrop);

  return { close, element: backdrop };
}
