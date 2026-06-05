<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  text: string;
  highlight?: string;
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

const highlightParts = (str: string) => {
  if (!props.highlight || props.highlight.trim() === '') return [{ text: str, isHighlight: false }];
  const query = props.highlight.trim();
  const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  const parts = str.split(regex);
  return parts.map(part => ({
    text: part,
    isHighlight: part.toLowerCase() === query.toLowerCase()
  })).filter(p => p.text !== '');
};
</script>

<template>
  <span class="inline-flex flex-wrap items-baseline">
    <template v-for="(segment, idx) in parsedSegments" :key="idx">
      <ruby v-if="segment.ruby" class="ruby-text">
        <template v-for="(node, nidx) in highlightParts(segment.text)" :key="nidx">
          <span :class="node.isHighlight ? 'text-m3-primary font-bold' : ''">{{ node.text }}</span>
        </template>
        <rp>(</rp><rt class="text-[0.6em] text-m3-on-surface-variant/80 font-medium tracking-normal select-none">{{ segment.ruby }}</rt><rp>)</rp>
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
