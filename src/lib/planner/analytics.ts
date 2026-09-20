/**
 * A thin analytics seam.
 *
 * No analytics provider is wired up. `trackEvent` forwards to `gtag` or
 * `dataLayer` if a provider is ever added, and otherwise does nothing. Events
 * carry only coarse, non-identifying counts and enum values — never room names,
 * dimensions a person typed, or anything that could identify a visitor.
 */

export type AnalyticsEvent =
  | 'room_created'
  | 'template_selected'
  | 'furniture_added'
  | 'furniture_moved'
  | 'furniture_rotated'
  | 'furniture_resized'
  | 'furniture_deleted'
  | 'furniture_duplicated'
  | 'door_added'
  | 'window_added'
  | 'layout_saved'
  | 'layout_opened'
  | 'layout_exported'
  | 'layout_imported'
  | 'layout_printed'
  | 'layout_shared'
  | 'fit_check_used'
  | 'measure_used'
  | 'clearance_checked';

export type EventProps = Record<string, string | number | boolean>;

declare global {
  interface Window {
    gtag?: (command: string, eventName: string, params?: Record<string, unknown>) => void;
    dataLayer?: unknown[];
    __roomPlannerEvents?: Array<{ event: AnalyticsEvent; props: EventProps; at: number }>;
  }
}

/** Keys we will never forward, even if a caller passes them by mistake. */
const BLOCKED_KEYS = new Set(['name', 'roomName', 'email', 'label', 'title', 'query']);

function scrub(props: EventProps): EventProps {
  const out: EventProps = {};
  for (const [key, value] of Object.entries(props)) {
    if (BLOCKED_KEYS.has(key)) continue;
    if (typeof value === 'string') {
      // Only short enum-like strings pass through.
      if (value.length > 40) continue;
      out[key] = value;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue;
      out[key] = Math.round(value * 100) / 100;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function trackEvent(event: AnalyticsEvent, props: EventProps = {}): void {
  if (typeof window === 'undefined') return;
  const payload = scrub(props);

  try {
    // Keep a short in-memory trail so the behaviour is inspectable in dev tools.
    const trail = (window.__roomPlannerEvents ??= []);
    trail.push({ event, props: payload, at: Date.now() });
    if (trail.length > 100) trail.shift();

    if (typeof window.gtag === 'function') {
      window.gtag('event', event, payload);
    } else if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event, ...payload });
    }
  } catch {
    // Analytics must never break the planner.
  }
}
