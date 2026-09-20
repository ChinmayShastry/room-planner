/**
 * One consistent icon set, inlined at build time.
 *
 * All icons are drawn on a 24x24 grid with a 1.6 stroke and round caps, so they
 * sit together without any of them looking heavier than the rest. Keeping them
 * here (rather than an icon font or sprite) avoids an extra network request and
 * lets the markup inherit `currentColor`.
 */

export const ICON_PATHS = {
  undo: '<path d="M4 9h11a5 5 0 0 1 0 10h-6"/><path d="M8 5 4 9l4 4"/>',
  redo: '<path d="M20 9H9a5 5 0 0 0 0 10h6"/><path d="m16 5 4 4-4 4"/>',
  'zoom-in': '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M11 8v6M8 11h6"/>',
  'zoom-out': '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M8 11h6"/>',
  fit: '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
  grid: '<path d="M4 4h16v16H4z"/><path d="M4 9.33h16M4 14.67h16M9.33 4v16M14.67 4v16"/>',
  magnet: '<path d="M6 4v8a6 6 0 0 0 12 0V4"/><path d="M6 4h4v8a2 2 0 0 0 4 0V4h4"/>',
  ruler:
    '<path d="m3.5 15.5 12-12a1.5 1.5 0 0 1 2.1 0l2.9 2.9a1.5 1.5 0 0 1 0 2.1l-12 12a1.5 1.5 0 0 1-2.1 0l-2.9-2.9a1.5 1.5 0 0 1 0-2.1Z"/><path d="m8 11 2 2M11 8l2 2M14 5l2 2"/>',
  trash: '<path d="M4 6.5h16M10 6.5V4h4v2.5M6.5 6.5 7.5 20h9l1-13.5M10 10v6M14 10v6"/>',
  'rotate-cw': '<path d="M20 11a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>',
  'rotate-ccw': '<path d="M4 11a8 8 0 1 0 2.3-5.6"/><path d="M4 4v5h5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14"/>',
  print:
    '<path d="M7 9V4h10v5"/><path d="M5 9h14a2 2 0 0 1 2 2v5h-4v4H7v-4H3v-5a2 2 0 0 1 2-2Z"/><path d="M7 16h10"/>',
  share: '<path d="M12 4v11M8.5 7.5 12 4l3.5 3.5"/><path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/>',
  door: '<path d="M5 20h14M7 20V4h10v16"/><circle cx="14" cy="12" r="1" fill="currentColor" stroke="none"/>',
  window: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M12 5v14M4 12h16"/>',
  sofa: '<path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><path d="M3 11h18v6H3z"/><path d="M6 17v2M18 17v2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  info: '<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4M12 17h.01"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  upload: '<path d="M12 20V9M7.5 13.5 12 9l4.5 4.5M5 5h14"/>',
  template: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 9v11"/>',
  home: '<path d="m3 11 9-7 9 7"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5h4v5"/>',
  calculator:
    '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 16h.01M12 16h.01M15.5 16h.01"/>',
  keyboard:
    '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M8 14h8"/>',
  'arrow-right': '<path d="M5 12h13M13 6.5 18.5 12 13 17.5"/>',
  'bring-forward':
    '<rect x="4" y="4" width="10" height="10" rx="1.5"/><path d="M10 17v1.5A1.5 1.5 0 0 0 11.5 20h7A1.5 1.5 0 0 0 20 18.5v-7A1.5 1.5 0 0 0 18.5 10H17"/>',
  'send-backward':
    '<rect x="10" y="10" width="10" height="10" rx="1.5"/><path d="M14 7V5.5A1.5 1.5 0 0 0 12.5 4h-7A1.5 1.5 0 0 0 4 5.5v7A1.5 1.5 0 0 0 5.5 14H7"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;
