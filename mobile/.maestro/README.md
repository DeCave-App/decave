# Mobile UI tests (Maestro)

End-to-end checks for the regressions we've hit: composer hidden by the keyboard,
short DM bubbles splitting, lost drafts, and the floating voice bar.

## Setup (once)

Install Maestro: https://maestro.mobile.dev (see their docs for the install command).

## Running

1. Install a build on a simulator or device and **sign in by hand**. Sign-in uses
   Turnstile, which tests don't (and shouldn't) bypass; the flows reuse that session.
2. From `mobile/`:

```
maestro test .maestro -e FRIEND="<friend username>" -e HUB="<hub name>" -e VOICE_ROOM="<voice room>"
```

Use a test account and test Hub; the DM flow sends a real "ok" message.
