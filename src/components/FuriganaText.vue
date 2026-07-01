<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  text: string;
  highlight?: string | string[];
}>();

// Parse text like "漢[かん]字[じ]" into array of parts
// e.g. [{ text: "漢", ruby: "かん" }, { text: "字", ruby: "じ" }]
// If no ruby, just { text: "word" }
const parsedSegments = computed(() => {
  if (!props.text) return [];
  
  // Regex to match kanji with ruby: {Kanji|ruby} or Kanji[ruby]
  const regex = /\{([^|{}]+)\|([^|{}]+)\}|([^\s\[\]{}]+)\[([^\]]+)\]/g;
  const segments = [];
  let lastIndex = 0;
  
  let match;
  while ((match = regex.exec(props.text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      segments.push({
        text: props.text.substring(lastIndex, match.index)
      });
    }
    
    let baseText = match[1] || match[3];
    let rubyText = match[2] || match[4];

    // If base text consists entirely of Japanese Kana (Hiragana/Katakana/Choonpu),
    // ignore the ruby annotation, as the user only wants Kanji annotated.
    if (/^[\u3040-\u309F\u30A0-\u30FF\uFF66-\uFF9Dー]+$/.test(baseText)) {
      rubyText = null;
    }

    // Add the matched ruby pair
    segments.push({
      text: baseText,
      ruby: rubyText
    });
    
    lastIndex = regex.lastIndex;
  }
  
  // Add remaining text
  if (lastIndex < props.text.length) {
    segments.push({
      text: props.text.substring(lastIndex)
    });
  }
  
  return segments.length > 0 ? segments : [{ text: props.text }];
});

const highlightTerms = computed(() => {
  const raw = Array.isArray(props.highlight) ? props.highlight : [props.highlight || ''];
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const item of raw) {
    const value = String(item || '').trim();
    if (!value) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(value);
  }

  return terms.sort((a, b) => b.length - a.length);
});

const isLatinBoundary = (value: string, index: number) => {
  if (index < 0 || index >= value.length) return true;
  return !/[\p{L}\p{N}_]/u.test(value[index]);
};

const isLatinTerm = (term: string) => /^[\p{Script=Latin}\p{N}_'’-]+$/u.test(term);

const matchesAt = (str: string, lower: string, index: number, term: string) => {
  const lowerTerm = term.toLocaleLowerCase();
  if (!lower.startsWith(lowerTerm, index)) return false;

  if (isLatinTerm(term)) {
    return isLatinBoundary(str, index - 1) && isLatinBoundary(str, index + term.length);
  }

  return true;
};

const highlightParts = (str: string) => {
  if (!highlightTerms.value.length) return [{ text: str, isHighlight: false }];

  const parts: Array<{ text: string; isHighlight: boolean }> = [];
  const lower = str.toLocaleLowerCase();
  let index = 0;

  while (index < str.length) {
    const matched = highlightTerms.value.find((term) => matchesAt(str, lower, index, term));
    if (matched) {
      parts.push({ text: str.slice(index, index + matched.length), isHighlight: true });
      index += matched.length;
      continue;
    }

    const nextMatchIndex = findNextMatchIndex(str, lower, index + 1);
    const end = nextMatchIndex === -1 ? str.length : nextMatchIndex;
    parts.push({ text: str.slice(index, end), isHighlight: false });
    index = end;
  }

  return parts.filter((part) => part.text !== '');
};

const findNextMatchIndex = (str: string, lower: string, start: number) => {
  for (let index = start; index < str.length; index += 1) {
    if (highlightTerms.value.some((term) => matchesAt(str, lower, index, term))) {
      return index;
    }
  }

  return -1;
};
</script>

<template>
  <span class="inline-flex flex-wrap items-baseline">
    <template v-for="(segment, idx) in parsedSegments" :key="idx">
      <ruby v-if="segment.ruby" class="ruby-text">
        <template v-for="(node, nidx) in highlightParts(segment.text)" :key="nidx">
          <span :class="node.isHighlight ? 'text-m3-primary font-bold' : ''">{{ node.text }}</span>
        </template>
        <rp>(</rp><rt class="text-[0.6em] text-m3-on-surface-variant/80 font-medium tracking-wide select-none px-[0.25em]">{{ segment.ruby }}</rt><rp>)</rp>
      </ruby>
      <span v-else>
        <template v-for="(node, nidx) in highlightParts(segment.text)" :key="nidx">
          <span :class="node.isHighlight ? 'text-m3-primary font-bold' : ''">{{ node.text }}</span>
        </template>
      </span>
    </template>
  </span>
</template>

<style scoped>
.ruby-text {
  ruby-align: center;
}
rt {
  line-height: 1;
  transform: translateY(-0.1em);
  padding-bottom: 0.2em;
}
</style>
