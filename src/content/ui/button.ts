import { Platform } from '../../shared/types';

const ICONS = {
  download: `
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="3" x2="12" y2="15"></line>
      <polyline points="7 10 12 15 17 10"></polyline>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    </svg>
  `,
  spinner: `
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" opacity="0.25"></circle>
      <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" stroke-width="2"></path>
    </svg>
  `,
  checkmark: `
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  `,
  error: `
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="9"></circle>
      <line x1="15" y1="9" x2="9" y2="15"></line>
      <line x1="9" y1="9" x2="15" y2="15"></line>
    </svg>
  `
};

export type ButtonState = 'idle' | 'loading' | 'success' | 'error';

export interface CreateButtonOptions {
  platform: Platform;
  tooltipText?: string;
  onClick: (button: HTMLElement, updateState: (state: ButtonState, text?: string) => void) => void;
}

export function createDownloadButton(options: CreateButtonOptions): HTMLElement {
  const btn = document.createElement('button');
  btn.className = `soc-dl-btn soc-${options.platform}`;
  btn.setAttribute('type', 'button');
  btn.setAttribute('aria-label', options.tooltipText || 'Download media');
  btn.innerHTML = `
    ${ICONS.download}
    <span class="soc-tooltip">${options.tooltipText || 'Download High-Res'}</span>
  `;

  const tooltip = btn.querySelector('.soc-tooltip') as HTMLElement;

  const updateState = (state: ButtonState, text?: string) => {
    btn.classList.remove('soc-loading', 'soc-success', 'soc-error');
    if (state === 'loading') {
      btn.classList.add('soc-loading');
      btn.innerHTML = `${ICONS.spinner}<span class="soc-tooltip">${text || 'Downloading...'}</span>`;
      btn.style.pointerEvents = 'none';
    } else if (state === 'success') {
      btn.classList.add('soc-success');
      btn.innerHTML = `${ICONS.checkmark}<span class="soc-tooltip">${text || 'Downloaded!'}</span>`;
      btn.style.pointerEvents = 'auto';
      setTimeout(() => updateState('idle'), 2500);
    } else if (state === 'error') {
      btn.classList.add('soc-error');
      btn.innerHTML = `${ICONS.error}<span class="soc-tooltip">${text || 'Failed'}</span>`;
      btn.style.pointerEvents = 'auto';
      setTimeout(() => updateState('idle'), 3000);
    } else {
      btn.innerHTML = `${ICONS.download}<span class="soc-tooltip">${options.tooltipText || 'Download High-Res'}</span>`;
      btn.style.pointerEvents = 'auto';
    }
  };

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    options.onClick(btn, updateState);
  });

  return btn;
}
