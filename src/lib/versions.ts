// Central version pins. Bump here to upgrade pi / pi-web across the deployment.
//
// Vercel uses STOCK @jmfederico/pi-web (no fork), which bundles the latest pi
// via its `@earendil-works/pi-coding-agent@^0.84.1` dependency (resolves to 0.84.4).
// See docs/DESIGN.md §0.5 for the version strategy & upgrade flow.
export const PI_WEB_VERSION = '1.202608.2';

// The npm spec installed into the sandbox. Pinned (not `latest`) for reproducibility.
export const PI_WEB_INSTALL_SPEC = `@jmfederico/pi-web@${PI_WEB_VERSION}`;

// Informational — pi (coding-agent/core/ai) rides along with pi-web at 0.84.4.
export const PI_VERSION = '0.84.4';
