export interface QueryPluginInfo {
  name?: string;
  version?: string;
  valid: boolean;
}

interface NativePluginListResponse {
  plugincount?: unknown;
  plugins?: unknown;
}

/**
 * Rising World uses this exact transformation for webserver-handler prefixes.
 * Punctuation is deliberately retained; only ASCII spaces become hyphens.
 */
export function nativePluginRouteId(name: string): string {
  return name.toLowerCase().replaceAll(' ', '-');
}

/**
 * The game endpoint occasionally emits literal newlines inside JSON strings.
 * Repair only that defect, then let the strict JSON parser reject every other
 * malformed payload.
 */
export function parseNativePluginList(raw: string): QueryPluginInfo[] | undefined {
  const parsed = parseJsonWithEscapedStringNewlines(raw);
  if (!parsed || typeof parsed !== 'object') return undefined;
  const plugins = (parsed as NativePluginListResponse).plugins;
  if (!Array.isArray(plugins)) return undefined;

  return plugins.flatMap((plugin): QueryPluginInfo[] => {
    if (!plugin || typeof plugin !== 'object') return [];
    const name = nonBlankString((plugin as Record<string, unknown>).name);
    if (!name) return [];
    const manifest = nonBlankString((plugin as Record<string, unknown>).version);
    return [{
      name,
      version: manifestVersion(manifest),
      valid: true,
    }];
  });
}

function parseJsonWithEscapedStringNewlines(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(escapeLiteralStringNewlines(raw));
    } catch {
      return undefined;
    }
  }
}

function escapeLiteralStringNewlines(raw: string): string {
  let inString = false;
  let escaped = false;
  let result = '';
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (inString && (character === '\n' || character === '\r')) {
      if (character === '\r' && raw[index + 1] === '\n') index += 1;
      result += '\\n';
      continue;
    }
    result += character;
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '"') {
      inString = !inString;
    }
  }
  return result;
}

function manifestVersion(value: string | undefined): string | undefined {
  if (!value) return undefined;
  // The game currently puts the complete plugin manifest into `version`; its
  // generated lines are comment-prefixed, for example `* Version: 0.23.14`.
  const match = value.match(/(?:^|\n)\s*(?:\*\s*)?Version\s*:\s*([^\s]+)/i);
  return match?.[1];
}

function nonBlankString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
