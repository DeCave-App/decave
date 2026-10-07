# macOS release notarization

The macOS desktop build notarizes each DMG through Apple's `notarytool` and staples the accepted ticket before the release upload step. The release environment must have the Apple signing credentials available in a keychain profile and set `APPLE_KEYCHAIN_PROFILE` to that profile's name.

Create the profile interactively on the signing Mac or release runner:

```sh
xcrun notarytool store-credentials decave-release --apple-id <Apple-ID> --team-id <Team-ID>
```

`notarytool` prompts for the app-specific password and stores the credentials in the keychain. Do not pass the password as a command-line argument. Ensure the keychain containing the profile is unlocked and available to the build process.

On the signing Mac, update the checkout to the pushed release fixes and install the locked dependencies:

```sh
git fetch origin main
git switch main
git pull --ff-only origin main
npm ci

# Confirm a Developer ID Application identity is available in the keychain.
security find-identity -v -p codesigning

# Select a version newer than the package and both published platform feeds.
npm run release:next

export APPLE_KEYCHAIN_PROFILE=decave-release
npm run desktop:build:mac
npm run release:upload:mac
```

The release build creates signed arm64 and x64 DMGs and update archives, notarizes and staples each DMG, then uploads the versioned files before publishing the update manifest. The upload script validates the stapled tickets before publishing. Ensure Wrangler is authenticated for the account that owns the release R2 bucket.

On Windows PowerShell, use `$env:APPLE_KEYCHAIN_PROFILE = "decave-release"` before running those npm commands. See [Apple's notarization-tool migration note](https://developer.apple.com/documentation/technotes/tn3147-migrating-to-the-latest-notarization-tool) for the supported keychain-profile workflow.
