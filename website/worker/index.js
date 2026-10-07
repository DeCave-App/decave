const WINDOWS_RELEASE_KEY = "releases/windows/DeCaveSetup.exe";
const OPERATOR_WINDOWS_RELEASE_KEY = "releases/windows/operator-waived/DeCaveSetup.exe";
const OPERATOR_ANDROID_RELEASE_KEY = "releases/android/operator-waived/DeCave-0.1.89-operator-waived.apk";
const OPERATOR_RELEASE_METADATA_KEY = "releases/operator-waived/manifest.json";
const WINDOWS_FILENAME = "DeCaveSetup.exe";
const ANDROID_FILENAME = "DeCave-0.1.89-operator-waived.apk";

function downloadHeaders(object) {
  const headers = new Headers();
  headers.set(
    "Content-Type",
    "application/vnd.microsoft.portable-executable",
  );
  headers.set(
    "Content-Disposition",
    `attachment; filename="${WINDOWS_FILENAME}"`,
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cache-Control", "public, max-age=300");
  headers.set("Accept-Ranges", "bytes");

  if (object?.httpEtag) headers.set("ETag", object.httpEtag);
  if (typeof object?.size === "number") {
    headers.set("Content-Length", String(object.size));
  }
  if (object?.uploaded instanceof Date) {
    headers.set("Last-Modified", object.uploaded.toUTCString());
  }

  return headers;
}

function unavailableResponse(request, message = "DeCave downloads are not enabled for this deployment.") {
  return new Response(request.method === "HEAD" ? null : message, {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": "86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function serveObject(request, object, filename, contentType) {
  if (!object) return new Response("DeCave release artifact is not available yet.", { status: 404, headers: { "Cache-Control": "no-store" } });
  const headers = downloadHeaders(object);
  headers.set("Content-Type", contentType);
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const mode = env.PUBLIC_RELEASE_MODE || "disabled";
    const operatorMode = mode === "operator-waived-unsigned";
    const approvedMode = mode === "approved";

    if (
      url.pathname === "/downloads/DeCaveSetup.exe" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      if (!operatorMode && !approvedMode) return unavailableResponse(request);
      const object = request.method === "HEAD"
        ? await env.RELEASES.head(operatorMode ? OPERATOR_WINDOWS_RELEASE_KEY : WINDOWS_RELEASE_KEY)
        : await env.RELEASES.get(operatorMode ? OPERATOR_WINDOWS_RELEASE_KEY : WINDOWS_RELEASE_KEY);
      const response = await serveObject(request, object, WINDOWS_FILENAME, "application/vnd.microsoft.portable-executable");
      if (operatorMode) response.headers.set("X-DeCave-Release-Mode", "operator-waived-unsigned");
      return response;
    }

    if (
      operatorMode &&
      url.pathname === "/downloads/DeCave-0.1.89-operator-waived.apk" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const object = request.method === "HEAD"
        ? await env.RELEASES.head(OPERATOR_ANDROID_RELEASE_KEY)
        : await env.RELEASES.get(OPERATOR_ANDROID_RELEASE_KEY);
      return serveObject(request, object, ANDROID_FILENAME, "application/vnd.android.package-archive");
    }

    if (
      operatorMode &&
      url.pathname === "/downloads/operator-release.json" &&
      (request.method === "GET" || request.method === "HEAD")
    ) {
      const object = request.method === "HEAD"
        ? await env.RELEASES.head(OPERATOR_RELEASE_METADATA_KEY)
        : await env.RELEASES.get(OPERATOR_RELEASE_METADATA_KEY);
      if (!object) return new Response("DeCave release metadata is not available yet.", { status: 404, headers: { "Cache-Control": "no-store" } });
      const headers = new Headers(downloadHeaders(object));
      headers.set("Content-Type", "application/json; charset=utf-8");
      headers.delete("Content-Disposition");
      return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
    }

    return env.ASSETS.fetch(request);
  },
};
