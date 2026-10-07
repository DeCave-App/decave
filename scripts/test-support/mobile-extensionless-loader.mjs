// Resolve the mobile app's extensionless relative imports (Metro style) to .ts
// files, so Node tests can import mobile modules that don't touch React Native.
export async function resolve(specifier, context, nextResolve) {
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    try {
      return await nextResolve(`${specifier}.ts`, context);
    } catch {}
  }
  return nextResolve(specifier, context);
}
