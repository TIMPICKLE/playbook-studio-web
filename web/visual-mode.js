// A viewing preference, never a property of a shared playbook.
export const VISUAL_MODE_KEY = 'playbook-visual-mode';
export function traditionalDevice({ userAgent = '', platform = '', maxTouchPoints = 0, mobile = false, coarse = false, noHover = false } = {}) {
  return mobile || /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk/i.test(userAgent)
    || (/Mac/i.test(platform || userAgent) && maxTouchPoints > 1)
    || (coarse && noHover);
}
export function deviceIsTraditional(win = window) {
  const nav = win.navigator;
  return traditionalDevice({ userAgent: nav.userAgent, platform: nav.platform, maxTouchPoints: nav.maxTouchPoints,
    mobile: nav.userAgentData?.mobile, coarse: !!win.matchMedia?.('(pointer: coarse)').matches,
    noHover: !!win.matchMedia?.('(hover: none)').matches });
}
export function resolveVisualMode(preferred, restricted) {
  return !restricted && preferred === 'digital' ? 'digital' : 'traditional';
}
