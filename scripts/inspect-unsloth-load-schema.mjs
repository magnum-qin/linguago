import './lib/load-local-env.mjs';

const endpoint = process.argv[2] || 'http://100.99.99.99:11445';
const token = process.env.UNSLOTH_API_KEY;
if (!token) throw new Error('Missing UNSLOTH_API_KEY');

const response = await fetch(`${endpoint}/openapi.json`, {
  headers: { authorization: `Bearer ${token}` }
});
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const document = await response.json();
const operation = document.paths?.['/v1/load']?.post;
const reference = operation?.requestBody?.content?.['application/json']?.schema?.$ref;
const schemaName = reference?.split('/').pop();
console.log(
  JSON.stringify(
    {
      schema_name: schemaName || null,
      schema: schemaName ? document.components?.schemas?.[schemaName] : null
    },
    null,
    2
  )
);
