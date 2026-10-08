import assert from 'node:assert/strict';
import {
  definitionContractLanguageLooksRight,
  validateDefinitionContract,
  validateSourceReviewEnvelope,
  sourceReviewSystemPrompt
} from './lib/source-review-contract.mjs';

assert.match(sourceReviewSystemPrompt(), /Judge only whether the proposed sense is real/);
assert.match(sourceReviewSystemPrompt(true), /Judge both exact source-language meaning and modern everyday sense priority/);
assert.doesNotMatch(sourceReviewSystemPrompt(true), /Judge only whether/);
assert.match(sourceReviewSystemPrompt(true), /manual_review/);

const terms = {
  en: 'physiological',
  'pt-BR': 'fisiológico',
  zh: '生理的',
  ja: '生理的'
};

assert.deepEqual(
  validateDefinitionContract(
    {
      en: 'Relating to the normal functions of living organisms.',
      'pt-BR': 'Relacionado às funções normais dos organismos vivos.',
      zh: '与生物体正常生命活动有关的。',
      ja: '生物の正常な生命活動に関する。'
    },
    terms
  ),
  []
);

const emptyErrors = validateDefinitionContract(
  { en: '', 'pt-BR': '', zh: '', ja: '' },
  terms
);
for (const lang of ['en', 'pt-BR', 'zh', 'ja']) {
  assert(emptyErrors.includes(`invalid_definition_contract_${lang}`));
}

const leakageErrors = validateDefinitionContract(
  {
    en: 'Relating to normal biological functions.',
    'pt-BR': 'Relacionado às funções biológicas normais.',
    zh: 'physiological function',
    ja: 'physiological function'
  },
  terms
);
assert(leakageErrors.includes('definition_contract_language_zh'));
assert(leakageErrors.includes('definition_contract_language_ja'));

assert.equal(
  definitionContractLanguageLooksRight(
    'relating to the theory and methodology of interpretation, especially of literary texts',
    'pt-BR'
  ),
  false
);
assert.equal(
  definitionContractLanguageLooksRight(
    'Teoria e metodologia da interpretação, especialmente de textos literários.',
    'pt-BR'
  ),
  true
);
assert.equal(
  definitionContractLanguageLooksRight(
    'Teoria e metodologia da interpretação, especialmente de textos literários.',
    'en'
  ),
  false
);

const copiedTermErrors = validateDefinitionContract(
  {
    en: 'physiological',
    'pt-BR': 'fisiológico',
    zh: '生理的',
    ja: '生理的'
  },
  terms
);
for (const lang of ['en', 'pt-BR', 'zh', 'ja']) {
  assert(copiedTermErrors.includes(`thin_definition_contract_${lang}`));
}

assert.deepEqual(
  validateSourceReviewEnvelope({
    decision: 'reject',
    confidence: 0.98,
    english_anchor: null,
    preferred_terms: { en: null, 'pt-BR': null, zh: null, ja: null },
    definition_contract: { en: null, 'pt-BR': null, zh: null, ja: null },
    reason: 'The source sense is a proper name.',
    evidence: ['Dictionary evidence identifies a surname.'],
    risk_flags: null
  }),
  []
);

assert(
  validateSourceReviewEnvelope({
    decision: 'accept',
    confidence: 0.98,
    english_anchor: null,
    preferred_terms: { en: null, 'pt-BR': null, zh: null, ja: null },
    reason: 'Accepted.',
    evidence: ['Evidence.'],
    risk_flags: []
  }).includes('invalid_english_anchor')
);

console.log('source-review contract tests passed');
