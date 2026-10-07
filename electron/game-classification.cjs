// Steam's local appinfo cache distinguishes games from software and tools.
// Unknown/malformed metadata fails closed; scanning never needs a network request.
function steamAppTypes(buffer) {
  const result = new Map();
  try {
    const magic = buffer.readUInt32LE(0);
    if (![0x07564427, 0x07564428, 0x07564429].includes(magic)) return result;
    const indexed = magic === 0x07564429;
    let offset = indexed ? 16 : 8;
    const strings = [];
    function cstring(cursor, end) {
      const next = buffer.indexOf(0, cursor);
      if (next < cursor || next >= end) throw new Error("Invalid string");
      return [buffer.toString("utf8", cursor, next), next + 1];
    }
    if (indexed) {
      let cursor = Number(buffer.readBigUInt64LE(8));
      const count = buffer.readUInt32LE(cursor);
      cursor += 4;
      if (count > 1000000) return result;
      for (let i = 0; i < count; i++) {
        const entry = cstring(cursor, buffer.length);
        strings.push(entry[0]);
        cursor = entry[1];
      }
    }
    while (offset + 8 <= buffer.length) {
      const id = buffer.readUInt32LE(offset);
      if (!id) break;
      const end = offset + 8 + buffer.readUInt32LE(offset + 4);
      let cursor = offset + (magic === 0x07564427 ? 48 : 68);
      if (end > buffer.length || end <= cursor) break;
      const stack = [];
      let appType;
      while (cursor < end) {
        const type = buffer[cursor++];
        if (type === 8) {
          stack.pop();
          continue;
        }
        let key;
        if (indexed) {
          key = strings[buffer.readUInt32LE(cursor)];
          cursor += 4;
        } else {
          [key, cursor] = cstring(cursor, end);
        }
        if (type === 0) {
          stack.push(key);
          continue;
        }
        if (type === 1) {
          let value;
          [value, cursor] = cstring(cursor, end);
          if (key === "type" && stack.join("/") === "appinfo/common") appType = value.toLowerCase();
        } else if ([2, 3, 4, 6].includes(type)) cursor += 4;
        else if (type === 7 || type === 10) cursor += 8;
        else throw new Error("Unsupported VDF field");
        if (cursor > end) throw new Error("Truncated VDF");
      }
      if (appType) result.set(String(id), appType);
      offset = end;
    }
  } catch {
    /* A locked or partially written cache must not classify software as games. */
  }
  return result;
}

function isGameProduct(source, id, name, type) {
  if (/wallpaper|^blender$|^obs studio$|^unreal engine/i.test(name) || (source === "steam" && id === "431960"))
    return false;
  if (type) return ["game", "demo"].includes(String(type).toLowerCase());
  // Known games remain available when the launcher cache is unavailable.
  if (source === "steam")
    return ["578080", "730", "570", "1172470", "1091500", "1245620", "271590", "440"].includes(id);
  return /^(Fortnite|Rocket League|Fall Guys)$/i.test(name);
}

function isGameProcess(name) {
  return !/wallpaper|launcher|crash|report|helper|overlay|anticheat|easyanticheat|battleye|(?:^|[_.-])(?:setup|uninstall|updater|service)(?:[_.-]|$)|^execpubg\.|^tslgame_be\./i.test(
    name,
  );
}

module.exports = { steamAppTypes, isGameProduct, isGameProcess };
