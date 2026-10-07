export function parseReleaseVersion(value) {
  const match = typeof value === "string" ? value.match(/^(\d+)\.(\d+)\.(\d+)$/) : null;
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function nextReleaseVersion(currentVersion, publishedVersions = []) {
  const current = parseReleaseVersion(currentVersion);
  if (!current) throw new Error(`Cannot auto-increment non-semver version: ${currentVersion}`);

  const base = [current, ...publishedVersions.map(parseReleaseVersion).filter(Boolean)].reduce((latest, candidate) =>
    compareVersions(candidate, latest) > 0 ? candidate : latest,
  );
  return `${base[0]}.${base[1]}.${base[2] + 1}`;
}
