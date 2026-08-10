const response = await fetch('https://translation-pwa.qhzggzh-linguago.workers.dev/api/translate', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    text: '你好',
    source_lang: 'auto',
    target_lang: 'zh',
    provider: 'auto',
    model: 'qwen3.6-flash'
  })
});

const data = await response.json();
console.log(
  JSON.stringify(
    {
      status: response.status,
      original: data.original,
      type: data.type,
      provider: data.provider,
      model: data.model,
      translation: data.translation,
      examples: data.examples,
      examplesLength: Array.isArray(data.examples) ? data.examples.length : null,
      firstExample: Array.isArray(data.examples) ? data.examples[0] : null
    },
    null,
    2
  )
);
