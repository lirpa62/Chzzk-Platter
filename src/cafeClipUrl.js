(function initializeClipUrlApi(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.ChzzkCafeNow = Object.assign(root.ChzzkCafeNow || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function createApi() {
  const CHZZK_MEDIA_PATTERNS = [
    {
      type: "clip",
      pattern:
        /(?:https?:\/\/)?chzzk\.naver\.com\/(?:clips|embed\/clip)\/([a-zA-Z0-9_-]+)/i,
    },
  ];

  function decodeRepeatedly(value) {
    let decoded = String(value || "");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const nextValue = decodeURIComponent(decoded);
        if (nextValue === decoded) break;
        decoded = nextValue;
      } catch {
        break;
      }
    }

    return decoded;
  }

  function extractMedia(value) {
    if (!value) return null;

    const decoded = decodeRepeatedly(value);
    for (const { type, pattern } of CHZZK_MEDIA_PATTERNS) {
      const match = decoded.match(pattern);
      if (match) return { type, id: match[1] };
    }

    return null;
  }

  function extractClipId(value) {
    const media = extractMedia(value);
    return media?.type === "clip" ? media.id : null;
  }

  function getMediaKey(media) {
    if (!media?.type || !media?.id) return "";
    return `${media.type}:${media.id}`;
  }

  function isSameMedia(left, right) {
    return getMediaKey(left) === getMediaKey(right);
  }

  function normalizeMedia(mediaOrClipId) {
    if (typeof mediaOrClipId === "string") {
      return { type: "clip", id: mediaOrClipId };
    }

    return mediaOrClipId;
  }

  function getMediaUrl(mediaOrClipId) {
    const media = normalizeMedia(mediaOrClipId);
    return `https://chzzk.naver.com/clips/${encodeURIComponent(media?.id || "")}`;
  }

  function getClipUrl(clipId) {
    return getMediaUrl({ type: "clip", id: clipId });
  }

  function getEmbedUrl(mediaOrClipId) {
    const media = normalizeMedia(mediaOrClipId);
    const params = new URLSearchParams({
      parent: "cafe.naver.com",
      extension: "ChzzkCafeNow",
      autoPlay: "false",
      muted: "false",
    });

    return `https://chzzk.naver.com/embed/clip/${encodeURIComponent(
      media?.id || "",
    )}?${params}`;
  }

  return {
    extractMedia,
    extractClipId,
    getMediaKey,
    getMediaUrl,
    getClipUrl,
    getEmbedUrl,
    isSameMedia,
  };
});
