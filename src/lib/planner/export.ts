/**
 * Export, print and share.
 *
 * Everything happens in the browser: the plan is re-rendered as a standalone
 * SVG document, then either downloaded as-is, rasterised through a canvas for
 * PNG, or handed to the Web Share API.
 */

import { buildStandaloneSvg } from './render';
import { toLayoutFile } from './storage';
import type { PlannerState } from './types';

export interface ExportOptions {
  showLabels?: boolean;
  /** Output width in pixels for PNG. */
  width?: number;
  title?: string;
}

function safeFilename(name: string, extension: string): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'room-plan';
  return `${base}.${extension}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function buildSvgBlob(state: PlannerState, options: ExportOptions = {}): Blob {
  const svg = buildStandaloneSvg(state, {
    width: options.width ?? 1600,
    showLabels: options.showLabels,
    title: options.title,
  });
  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
}

/**
 * Rasterise the plan to PNG.
 * A data-URL source keeps the canvas untainted, so `toBlob` is allowed.
 */
export async function buildPngBlob(state: PlannerState, options: ExportOptions = {}): Promise<Blob> {
  const width = options.width ?? 2000;
  const svg = buildStandaloneSvg(state, { width, showLabels: options.showLabels, title: options.title });

  const image = new Image();
  image.decoding = 'sync';
  image.src = svgDataUrl(svg);

  await new Promise<void>((resolve, reject) => {
    if (image.complete && image.naturalWidth > 0) {
      resolve();
      return;
    }
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The plan could not be rendered as an image.'));
  });

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || width;
  canvas.height = image.naturalHeight || Math.round(width * 0.75);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser could not create the image.');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('This browser could not create the image.'));
    }, 'image/png');
  });
}

export async function exportPng(state: PlannerState, options: ExportOptions = {}): Promise<void> {
  const blob = await buildPngBlob(state, options);
  downloadBlob(blob, safeFilename(options.title ?? state.room.name, 'png'));
}

export function exportSvg(state: PlannerState, options: ExportOptions = {}): void {
  downloadBlob(buildSvgBlob(state, options), safeFilename(options.title ?? state.room.name, 'svg'));
}

export function exportJson(state: PlannerState, name: string): void {
  const file = toLayoutFile(state, name);
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  downloadBlob(blob, safeFilename(name, 'json'));
}

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/**
 * Share the plan as a PNG where the platform supports it, otherwise fall back
 * to a download. There is no server, so there is no link to share.
 */
export async function sharePlan(state: PlannerState, options: ExportOptions = {}): Promise<ShareOutcome> {
  const blob = await buildPngBlob(state, options);
  const filename = safeFilename(options.title ?? state.room.name, 'png');

  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };

  if (typeof File === 'function' && nav.share && nav.canShare) {
    const file = new File([blob], filename, { type: 'image/png' });
    const data: ShareData = {
      files: [file],
      title: state.room.name,
      text: `${state.room.name} floor plan`,
    };
    if (nav.canShare(data)) {
      try {
        await nav.share(data);
        return 'shared';
      } catch (error) {
        // AbortError means the person dismissed the sheet — not a failure.
        if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      }
    }
  }

  downloadBlob(blob, filename);
  return 'downloaded';
}

const PRINT_HOST_ID = 'rp-print-host';

/**
 * Render a clean copy of the plan into the print-only container.
 *
 * Print CSS hides the app chrome and reveals this container, so it has to be
 * filled before any print starts — including one the person triggers with
 * Ctrl+P rather than the toolbar button. Callers wire this to `beforeprint`.
 */
export function renderPrintHost(state: PlannerState, options: ExportOptions = {}): HTMLElement {
  let host = document.getElementById(PRINT_HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = PRINT_HOST_ID;
    host.className = 'rp-print-host';
    host.setAttribute('aria-hidden', 'true');
    document.body.appendChild(host);
  }
  host.innerHTML = buildStandaloneSvg(state, {
    width: 1400,
    showLabels: options.showLabels,
    title: options.title,
  });
  return host;
}

/** Render the plan into the print container and open the print dialog. */
export function printPlan(state: PlannerState, options: ExportOptions = {}): void {
  renderPrintHost(state, options);
  window.print();
}
