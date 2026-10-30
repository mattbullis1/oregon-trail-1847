/**
 * Inline SVG icons. Coded graphics only: no image files, no icon fonts.
 */
const wrap = (body, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${body}</svg>`;

export const ICONS = {
  food: wrap('<path d="M12 3c3 4 6 5 6 9a6 6 0 1 1-12 0c0-4 3-5 6-9Z" fill="currentColor"/><path d="M12 8v9" stroke="#2b1c0e" stroke-width="1.2"/>'),
  bullets: wrap('<rect x="6" y="9" width="4" height="11" rx="1" fill="currentColor"/><rect x="14" y="9" width="4" height="11" rx="1" fill="currentColor"/><path d="M8 9V6l-1-2 1 .6L9 4l1 .6L11 4l-1 2v3M16 9V6l-1-2 1 .6L17 4l1 .6L19 4l-1 2v3" fill="currentColor"/>'),
  clothing: wrap('<path d="M8 4 4 7l2 4 2-1v10h8V10l2 1 2-4-4-3-2 2h-4L8 4Z" fill="currentColor"/>'),
  supplies: wrap('<rect x="3" y="8" width="18" height="12" rx="1.5" fill="currentColor"/><path d="M3 12h18M12 8v12" stroke="#2b1c0e" stroke-width="1.2"/>'),
  cash: wrap('<circle cx="12" cy="12" r="8" fill="currentColor"/><path d="M12 7v10M9.5 9.5h3.2a1.8 1.8 0 0 1 0 3.6H9.5m0 0h3.6" stroke="#2b1c0e" stroke-width="1.4" fill="none"/>'),
  oxen: wrap('<path d="M4 13c0-3 2-5 5-5 2 0 3 .8 4 .8S15 8 17 8c2.5 0 3.5 1.6 3.5 3.4V16h-3v3h-3v-3h-5v3H7v-3H4v-3Z" fill="currentColor"/>'),
  miles: wrap('<path d="M4 18c4-8 8-8 12-14" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="6" cy="18" r="2.4" fill="currentColor"/><circle cx="18" cy="4" r="2.4" fill="currentColor"/>'),
  calendar: wrap('<rect x="4" y="5" width="16" height="15" rx="2" fill="currentColor"/><path d="M4 10h16M8 3v4M16 3v4" stroke="#2b1c0e" stroke-width="1.4"/>'),
  health: wrap('<path d="M12 20S4 15 4 9.6A4.6 4.6 0 0 1 12 6a4.6 4.6 0 0 1 8 3.6C20 15 12 20 12 20Z" fill="currentColor"/>'),
  menu: wrap('<path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),
  restart: wrap('<path d="M20 12a8 8 0 1 1-2.3-5.6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M20 4v4h-4" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>'),
  sound: wrap('<path d="M5 10v4h3l4 3V7l-4 3H5Z" fill="currentColor"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'),
  mute: wrap('<path d="M5 10v4h3l4 3V7l-4 3H5Z" fill="currentColor"/><path d="M16 10l5 5M21 10l-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  info: wrap('<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M12 10.5V17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="7.6" r="1.2" fill="currentColor"/>'),
  chevron: wrap('<path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/>'),
};

export function icon(name, className = 'icon') {
  return `<span class="${className}">${ICONS[name] || ''}</span>`;
}
