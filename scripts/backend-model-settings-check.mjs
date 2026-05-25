const base = process.env.LINGUAGO_CHECK_BASE_URL || "http://127.0.0.1:8787";
const shouldWrite = process.env.LINGUAGO_CHECK_WRITE_SETTINGS === "1";
const payload = {
  provider: "auto",
  model: "qwen3.6-flash"
};

let postStatus = null;
let posted = null;

if (shouldWrite) {
  const post = await fetch(`${base}/api/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  postStatus = post.status;
  posted = await post.json();
}

const get = await fetch(`${base}/api/settings`);
const loaded = await get.json();

const health = await fetch(`${base}/api/health`);
const healthPayload = await health.json();

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
  base,
  wroteSettings: shouldWrite,
  postStatus,
  posted,
  getStatus: get.status,
  loaded,
  healthStatus: health.status,
  health: {
    ok: healthPayload.ok,
    kv: healthPayload.kv,
    dictionary: healthPayload.dictionary,
    providers: healthPayload.providers
  },
  translateStatus: translate.status,
  translateModel: translated.model,
  translateProvider: translated.provider,
  errorCode: translated.error_code
}, null, 2));
