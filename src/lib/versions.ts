// Central version pins. Bump here to upgrade pi / pi-web across the deployment.
//
// Vercel uses STOCK @jmfederico/pi-web (no fork), which bundles the latest pi
// via its `@earendil-works/pi-coding-agent` dependency.
// See docs/DESIGN.md §0.5 for the version strategy & upgrade flow.
//
// 1.202609.0 (pi 0.85.1): validated in-sandbox via web-terminal upgrade on
// 2026-09-06; pin bumped so fresh sandboxes install the same version.
export const PI_WEB_VERSION = '1.202609.0';

// The npm spec installed into the sandbox. Pinned (not `latest`) for reproducibility.
export const PI_WEB_INSTALL_SPEC = `@jmfederico/pi-web@${PI_WEB_VERSION}`;

// Informational — pi (coding-agent/core/ai) rides along with pi-web.
export const PI_VERSION = '0.85.1';
