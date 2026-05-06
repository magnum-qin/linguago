const base = "https://translation-pwa.qhzggzh-linguago.workers.dev";
const payload = {
  provider: "auto",
  model: "qwen3.6-flash-2026-04-16"
};

const post = await fetch(`${base}/api/settings`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload)
});
const posted = await post.json();

const get = await fetch(`${base}/api/settings`);
const loaded = await get.json();

const translate = await fetch(`${base}/api/translate`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    text: "hello",
    source_lang: "auto",
    target_lang: "zh",
    provider: "auto"
  })
});
const translated = await translate.json();

console.log(JSON.stringify({
  postStatus: post.status,
  posted,
  getStatus: get.status,
  loaded,
  translateStatus: translate.status,
  translateModel: translated.model,
  translateProvider: translated.provider
}, null, 2));
