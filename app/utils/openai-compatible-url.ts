function splitPathAndQuery(path: string) {
  const queryStart = path.indexOf("?");

  if (queryStart === -1) {
    return { pathname: path, query: "" };
  }

  return {
    pathname: path.slice(0, queryStart),
    query: path.slice(queryStart + 1),
  };
}

function cleanSegments(pathname: string) {
  return pathname.split("/").filter(Boolean);
}

function endsWithSegments(segments: string[], suffix: string[]) {
  if (suffix.length > segments.length) return false;

  return suffix.every(
    (segment, index) =>
      segments[segments.length - suffix.length + index].toLowerCase() ===
      segment.toLowerCase(),
  );
}

function largestSegmentOverlap(base: string[], next: string[]) {
  const max = Math.min(base.length, next.length);

  for (let length = max; length > 0; length -= 1) {
    const baseTail = base.slice(base.length - length);
    const nextHead = next.slice(0, length);

    if (
      baseTail.every(
        (segment, index) =>
          segment.toLowerCase() === nextHead[index].toLowerCase(),
      )
    ) {
      return length;
    }
  }

  return 0;
}

export function parseHttpEndpoint(rawBaseUrl: string) {
  const value = rawBaseUrl.trim();

  if (!value) {
    throw new Error("missing_endpoint");
  }

  if (value.startsWith("/")) {
    throw new Error("relative_endpoint");
  }

  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("invalid_protocol");
  }

  url.hash = "";
  return url;
}

export function appendOpenAICompatiblePath(
  rawBaseUrl: string,
  rawApiPath: string,
) {
  const url = parseHttpEndpoint(rawBaseUrl);
  const { pathname: apiPathname, query } = splitPathAndQuery(rawApiPath);
  const apiSegments = cleanSegments(apiPathname);
  const baseSegments = cleanSegments(url.pathname.replace(/\/+$/, ""));

  if (!apiSegments.length) {
    url.search = query ? `?${query}` : "";
    return url.toString();
  }

  const finalSegments = endsWithSegments(baseSegments, apiSegments)
    ? baseSegments
    : [
        ...baseSegments,
        ...apiSegments.slice(largestSegmentOverlap(baseSegments, apiSegments)),
      ];

  url.pathname = `/${finalSegments.join("/")}`;
  url.search = query ? `?${query}` : "";
  return url.toString();
}

export function buildOpenAICompatibleProxyTarget(
  rawBaseUrl: string,
  rawApiPath: string,
) {
  const upstreamUrl = appendOpenAICompatiblePath(rawBaseUrl, rawApiPath);
  const url = new URL(upstreamUrl);
  const { pathname: apiPathname, query } = splitPathAndQuery(rawApiPath);
  const apiSegments = cleanSegments(apiPathname);
  const upstreamSegments = cleanSegments(url.pathname);
  const baseSegments = endsWithSegments(upstreamSegments, apiSegments)
    ? upstreamSegments.slice(0, upstreamSegments.length - apiSegments.length)
    : [];

  url.pathname = baseSegments.length ? `/${baseSegments.join("/")}` : "/";
  url.search = "";

  return {
    baseUrl: url.toString().replace(/\/$/, ""),
    path: apiSegments.join("/"),
    query,
  };
}

export function buildModelListUrl(rawBaseUrl: string) {
  const url = parseHttpEndpoint(rawBaseUrl);
  let pathname = url.pathname.replace(/\/+$/, "");

  if (pathname.endsWith("/chat/completions")) {
    pathname = pathname.slice(0, -"/chat/completions".length);
  }

  url.pathname = pathname || "/";
  url.search = "";

  return appendOpenAICompatiblePath(url.toString(), "v1/models");
}
