# Banner fallback and simpler reading controls — 2026-10-13

Game cards retain a consistent artwork area. If the modern Steam header fails, the image tries the legacy Akamai header and then the modern library hero. Retries are bounded to two alternatives; repeated error events do not restart the chain. All requests remain browser-side static Steam assets, without new backend/store lookups. When no image is available, a styled title/initials placeholder remains instead of a blank card.

Achievement reading alternatives move into a collapsed Reading options menu. Automatic remains the default for connected game cards; direct Steam-session verification and Community reading remain available for recovery and compatibility checks. Refresh and Close stay immediately visible. The menu closes when a reading begins. Compatibility/sort/search controls use a compact desktop grid and responsive mobile layout. Games with no pending achievements display a concise completion message instead of zero-filled diagnostic counts.

No activation or persistence logic changes. Regression tests cover the finite image fallback chain, placeholder, menu default state, direct-mode selection and existing activation/reading flows.
