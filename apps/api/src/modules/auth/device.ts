// Store only coarse labels, never the raw User-Agent, IP location, or a fingerprint.
export function deviceLabel(agent?: string): string | null {
  if (!agent || agent.length > 2048) return null;
  const browser = /Edg(?:A|iOS)?\//.test(agent)
    ? 'Edge'
    : /OPR\/|Opera\//.test(agent)
      ? 'Opera'
      : /Firefox\/|FxiOS\//.test(agent)
        ? 'Firefox'
        : /Chrome\/|CriOS\//.test(agent)
          ? 'Chrome'
          : /Version\/.*Safari\//.test(agent)
            ? 'Safari'
            : null;
  const system = /Android/.test(agent)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(agent)
      ? 'iOS'
      : /Windows/.test(agent)
        ? 'Windows'
        : /Macintosh|Mac OS X/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : null;
  return browser ? `${browser}${system ? ` on ${system}` : ''}` : null;
}
