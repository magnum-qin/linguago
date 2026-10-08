const list = (value) => value == null ? [] : Array.isArray(value) ? value : [value];
const text = (value) => typeof value === 'string' ? value : value?.['#text'] || '';
const normalized = (value) => String(value || '').normalize('NFKC').trim();
const tags = (value) => list(value).map(text);

export function indexJmdictMetadata(entries) {
  const index = new Map();
  for (const entry of list(entries)) {
    const written = list(entry.k_ele).map((k) => text(k.keb));
    const readings = list(entry.r_ele);
    let inheritedPos = [];
    for (const [offset, sense] of list(entry.sense).entries()) {
      if (sense.pos) inheritedPos = tags(sense.pos);
      const glosses = list(sense.gloss).filter((g) => !g?.['@_xml:lang'] || g['@_xml:lang'] === 'eng').map(text);
      const restrictedWritten = tags(sense.stagk), restrictedReadings = tags(sense.stagr);
      const allowedWritten = written.filter((w) => !restrictedWritten.length || restrictedWritten.includes(w));
      const allowedReadings = readings.filter((r) => !restrictedReadings.length || restrictedReadings.includes(text(r.reb)));
      const terms = new Set([...allowedWritten, ...allowedReadings.map((r) => text(r.reb))]);
      for (const word of terms) {
        const matchingReadings = allowedReadings.filter((r) => {
          const restrictions = tags(r.re_restr);
          if (written.includes(word)) return r.re_nokanji == null && (!restrictions.length || restrictions.includes(word));
          return text(r.reb) === word && (!restrictedWritten.length || !restrictions.length || restrictions.some((w) => allowedWritten.includes(w)));
        });
        if (!matchingReadings.length) continue;
        const record = { entry_sequence: String(entry.ent_seq), sense_order: offset + 1,
          readings: matchingReadings.map((r) => text(r.reb)), part_of_speech: inheritedPos,
          fields: tags(sense.field), register: tags(sense.misc), dialect: tags(sense.dial), glosses };
        const key = normalized(word);
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(record);
      }
    }
  }
  return index;
}

export function matchJmdictMetadata(index, row) {
  const matches = (index.get(normalized(row.word)) || []).filter((r) => r.glosses.some((g) => normalized(g) === normalized(row.gloss_key)));
  return { status: matches.length === 1 ? 'exact' : matches.length ? 'ambiguous' : 'unmatched',
    source_sense_id: Number(row.first_sense_id ?? row.source_sense_id),
    word: row.word, gloss_key: row.gloss_key, matches };
}

export function boundJmdictMetadata(row) {
  const metadata = row.native_review_metadata;
  if (row.source_lang !== 'ja' || metadata?.status !== 'exact' || metadata.matches?.length !== 1) return null;
  if (metadata.source_sense_id !== Number(row.first_sense_id ?? row.source_sense_id) || metadata.word !== row.word || metadata.gloss_key !== row.gloss_key) return null;
  return metadata.matches[0];
}
