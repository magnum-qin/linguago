fetch('http://66.154.106.3/api/dictionary/lookup?term=talharim&q=talharim&text=talharim', {
  headers: {
    Authorization:
      'Bearer 3f7eb5bb5eb1c29478d7d8c180e6c5d1deb008f3b76153748a2b3fe484b88f77nDICTIONARY_PORT=8787nDICTIONARY_HOST=0.0.0.0nDICTIONARY_DB=/root/translation-dictionary-api/data/dictionary.sqlitenSQL_WASM=/root/translation-dictionary-api/node_modules/sql.js/dist/sql-wasm.wasmnDICTIONARY_PORT=80'
  }
})
  .then((r) => r.text())
  .then(console.log);
