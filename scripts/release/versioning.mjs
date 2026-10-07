// The next release version: one patch past the newest of the current package
// version and the versions already published to the Windows and macOS update
// feeds, so a release never reuses a version either platform has shipped.

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function parse(version) {
  const match = typeof version === "string" ? SEMVER.exec(version.trim()) : null;
  return match ? match.slice(1).map(Number) : null;
}

function compare(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

/**
 * @param {string} currentVersion package.json version
 * @param {Array<string | null | undefined>} publishedVersions feed versions; invalid or missing ones are ignored
 */
export function nextReleaseVersion(currentVersion, publishedVersions = []) {
  const current = parse(currentVersion);
  if (!current) throw new Error(`Refusing to release from a non-semver version: ${currentVersion}`);
  let newest = current;
  for (const version of publishedVersions) {
    const parsed = parse(version);
    if (parsed && compare(parsed, newest) > 0) newest = parsed;
  }
  return `${newest[0]}.${newest[1]}.${newest[2] + 1}`;
}
