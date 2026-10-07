# Automatic game activity

The Windows desktop scanner classifies installed Steam products using the local
`appcache/appinfo.vdf` product type. Games and demos qualify; applications, tools,
and unknown products do not. Wallpaper Engine is explicitly excluded. No library
metadata is uploaded for classification. A small known-game fallback covers PUBG
and several common games when the Steam cache is unavailable.

Epic products require a game/demo AppType or a known title (Fortnite, Rocket League,
Fall Guys). Epic manifests without type information are otherwise skipped. This
intentionally favors missing an unknown game over showing unrelated software.

Launcher, crash reporter, anti-cheat, and helper processes are excluded. The UI
shows HH:MM:SS from the detected process creation time and updates every second.
A successful desktop scan takes precedence over linked Steam presence, including
when no qualifying game is found. Browser-only Steam presence still uses the
existing remote presence mechanism with explicit common-software exclusions.

Live match mode, remaining players, and match duration are not implemented. The
process scanner provides a game identity and process start time, not match events.
A game-specific live data provider is required before these fields can be shown
accurately. Session elapsed time must not be presented as match elapsed time.

Validation: `node --test --test-isolation=none scripts/__tests__/game-classification.test.mjs`
and `npx tsc --noEmit`. Cache tests cover Steam formats 39, 40, and 41, malformed
input, application rejection, known-game fallback, and helper process filtering.
