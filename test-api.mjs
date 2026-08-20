const token = process.env.DICTIONARY_API_TOKEN;
if (!token) {
  throw new Error('DICTIONARY_API_TOKEN is required');
}

const baseUrl = process.env.DICTIONARY_API_URL || 'http://66.154.106.3';
fetch(`${baseUrl}/api/dictionary/lookup?term=talharim&q=talharim&text=talharim`, {
  headers: {
    Authorization: `Bearer ${token}`
  }
})
  .then((r) => r.text())
  .then(console.log);
